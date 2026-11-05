import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import { AppException, Errors } from '../common/errors';
import { OrgContext } from '../common/request.types';
import { pageMeta } from '../common/pagination';
import Decimal from 'decimal.js';
import {
  assertBalanced, assertDraft, assertPeriodTransition,
  canTransitionPeriod, computeFunctionalTotals, normalizeIdempotencyKey,
} from './posting';
import { convertToBase, moneyString, toDecimal } from './money';
import { seedChartOfAccounts } from './coa-seed';
import type {
  AccountCreateDto, AccountUpdateDto, FiscalYearCreateDto,
  JournalEntryCreateDto, JournalEntryUpdateDto, JournalApproveDto, JournalRejectDto,
  JournalReverseDto, TaxCodeCreateDto, TaxCodeUpdateDto,
} from '@atlas-erp/contracts';

type EntryWithLines = Prisma.JournalEntryGetPayload<{
  include: { lines: true; company: true };
}>;

/**
 * Input for a system-generated journal posting (inventory, and later
 * sales/purchasing). Unlike manual journals, system entries are created
 * directly as `posted` inside the caller's DB transaction, so the business
 * operation and its GL posting are atomic.
 */
export interface SystemJournalLine {
  account_id: string;
  debit: Decimal | string | number;
  credit: Decimal | string | number;
  description?: string;
}

export interface SystemJournalInput {
  company_id: string;
  posting_date: string; // YYYY-MM-DD
  description: string;
  journal_type: string; // e.g. 'inventory_receipt'
  source_type: string; // e.g. 'stock_movement'
  source_id: string;
  idempotency_key?: string;
  lines: SystemJournalLine[];
}

const STANDARD_TAX_CODES = [
  {
    nameAr: 'ضريبة القيمة المضافة 14% - مدخلات',
    nameEn: 'VAT 14% — Input',
    rate: '14',
    type: 'input',
    accountCode: '1230',
  },
  {
    nameAr: 'ضريبة القيمة المضافة 14% - مخرجات',
    nameEn: 'VAT 14% — Output',
    rate: '14',
    type: 'output',
    accountCode: '2120',
  },
] as const;

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- shared helpers ----------

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  private async companyInScope(ctx: OrgContext, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, organizationId: ctx.organizationId },
    });
    if (!company) throw Errors.notFound('Company');
    this.assertCompanyInScope(ctx, companyId);
    return company;
  }

  private async currencyDecimals(code: string): Promise<number> {
    const cur = await this.prisma.currency.findUnique({ where: { code } });
    if (!cur) throw Errors.notFound('Currency');
    return cur.decimals;
  }

  /**
   * Resolve an account-type reference sent as `account_type_id`: the web
   * client sends the type CODE ('ASSET' | ...); a UUID also works.
   * Code lookup first, UUID fallback (contract alignment with web).
   */
  private async resolveAccountType(ref: string) {
    const byCode = await this.prisma.accountType.findUnique({
      where: { code: ref.trim().toUpperCase() },
    });
    if (byCode) return byCode;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
      const byId = await this.prisma.accountType.findUnique({ where: { id: ref } });
      if (byId) return byId;
    }
    throw Errors.notFound('Account type');
  }

  /** Contract DTO (snake_case) for tax codes. */
  private taxCodeDto(t: {
    id: string; companyId: string; nameAr: string; nameEn: string;
    rate: unknown; type: string; taxAccountId: string | null; isActive: boolean;
    createdAt: Date; updatedAt: Date;
    taxAccount?: { id: string; code: string; nameAr: string; nameEn: string } | null;
  }) {
    return {
      id: t.id,
      company_id: t.companyId,
      name_ar: t.nameAr,
      name_en: t.nameEn,
      rate: t.rate instanceof Decimal ? t.rate.toString() : String(t.rate),
      type: t.type,
      tax_account_id: t.taxAccountId,
      tax_account: t.taxAccount ? {
        id: t.taxAccount.id, code: t.taxAccount.code,
        name_ar: t.taxAccount.nameAr, name_en: t.taxAccount.nameEn,
      } : null,
      is_active: t.isActive,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    };
  }

  /** Contract DTO (snake_case) for fiscal years / periods. */
  private fiscalYearDto(fy: {
    id: string; companyId: string; name: string;
    startDate: Date; endDate: Date; status: string;
    _count?: { periods: number };
  }) {
    return {
      id: fy.id,
      company_id: fy.companyId,
      name: fy.name,
      start_date: fy.startDate.toISOString().slice(0, 10),
      end_date: fy.endDate.toISOString().slice(0, 10),
      status: fy.status,
      periods_count: fy._count?.periods ?? undefined,
    };
  }

  private periodDto(pd: {
    id: string; fiscalYearId: string; companyId: string; name: string;
    startDate: Date; endDate: Date; status: string;
    closedById?: string | null; closedAt?: Date | null;
  }) {
    return {
      id: pd.id,
      fiscal_year_id: pd.fiscalYearId,
      company_id: pd.companyId,
      name: pd.name,
      start_date: pd.startDate.toISOString().slice(0, 10),
      end_date: pd.endDate.toISOString().slice(0, 10),
      status: pd.status,
      closed_by_id: pd.closedById ?? null,
      closed_at: pd.closedAt ? pd.closedAt.toISOString() : null,
    };
  }

  /** Contract DTO (snake_case) for accounts — the API never leaks Prisma camelCase. */
  private accountDto(a: {
    id: string; companyId: string; code: string; nameAr: string; nameEn: string;
    parentId: string | null; isPostable: boolean; isActive: boolean; description: string | null;
    createdAt: Date; updatedAt: Date;
    type: { code: string; nameAr: string; nameEn: string };
    parent?: { id: string; code: string; nameAr: string; nameEn: string } | null;
  }) {
    return {
      id: a.id,
      company_id: a.companyId,
      code: a.code,
      name_ar: a.nameAr,
      name_en: a.nameEn,
      account_type: { code: a.type.code, name_ar: a.type.nameAr, name_en: a.type.nameEn },
      parent_id: a.parentId,
      parent: a.parent ? {
        id: a.parent.id, code: a.parent.code,
        name_ar: a.parent.nameAr, name_en: a.parent.nameEn,
      } : null,
      is_postable: a.isPostable,
      is_active: a.isActive,
      description: a.description,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    };
  }

  private entryDto(entry: EntryWithLines, baseDecimals: number) {    const totals = computeFunctionalTotals(entry.lines, entry.exchangeRate, baseDecimals);
    return {
      id: entry.id,
      company_id: entry.companyId,
      period_id: entry.periodId,
      journal_type: entry.journalType,
      posting_date: entry.postingDate.toISOString().slice(0, 10),
      currency: entry.currency,
      exchange_rate: entry.exchangeRate.toString(),
      description: entry.description,
      status: entry.status,
      idempotency_key: entry.idempotencyKey,
      reversal_of_id: entry.reversalOfId,
      posted_by_id: entry.postedById,
      posted_at: entry.postedAt,
      version: entry.version,
      created_by_id: entry.createdById,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      total_debit: totals.totalDebit.toFixed(baseDecimals),
      total_credit: totals.totalCredit.toFixed(baseDecimals),
      lines: entry.lines.map((l) => ({
        id: l.id,
        account_id: l.accountId,
        debit: l.debit.toString(),
        credit: l.credit.toString(),
        description: l.description,
        cost_center: l.costCenter,
        tax_code_id: l.taxCodeId,
      })),
    };
  }

  private async getEntryInScope(ctx: OrgContext, id: string): Promise<EntryWithLines> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
    });
    if (!entry || entry.company.organizationId !== ctx.organizationId) {
      throw Errors.notFound('Journal entry');
    }
    this.assertCompanyInScope(ctx, entry.companyId);
    return entry;
  }

  // ---------- chart of accounts ----------

  async listAccounts(ctx: OrgContext, companyId: string, isActive?: boolean, isPostable?: boolean) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.prisma.account.findMany({
      where: {
        companyId,
        ...(isActive !== undefined ? { isActive } : {}),
        ...(isPostable !== undefined ? { isPostable } : {}),
      },
      include: {
        type: { select: { code: true, nameAr: true, nameEn: true } },
        parent: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.accountDto(r));
  }

  async createAccount(ctx: OrgContext, dto: AccountCreateDto, actorId: string, ip?: string) {
    const company = await this.companyInScope(ctx, dto.company_id);
    const type = await this.resolveAccountType(dto.account_type_id);
    let parent: { id: string; companyId: string } | null = null;
    if (dto.parent_id) {
      parent = await this.prisma.account.findUnique({ where: { id: dto.parent_id } });
      if (!parent) throw Errors.notFound('Parent account');
      if (parent.companyId !== company.id) throw Errors.accountCompanyMismatch();
    }
    try {
      const account = await this.prisma.account.create({
        data: {
          companyId: company.id,
          code: dto.code,
          nameAr: dto.name_ar,
          nameEn: dto.name_en,
          accountTypeId: type.id,
          parentId: parent?.id ?? null,
          isPostable: dto.is_postable,
          description: dto.description ?? null,
          createdById: actorId,
        },
        include: { type: true, parent: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'account.created',
        entityType: 'account', entityId: account.id, ip,
      });
      return this.accountDto(account);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('code');
      }
      throw e;
    }
  }

  async updateAccount(ctx: OrgContext, id: string, dto: AccountUpdateDto, actorId: string, ip?: string) {
    const account = await this.prisma.account.findUnique({ where: { id }, include: { company: true } });
    if (!account || account.company.organizationId !== ctx.organizationId) throw Errors.notFound('Account');
    this.assertCompanyInScope(ctx, account.companyId);

    let accountTypeId: string | undefined;
    if (dto.account_type_id) {
      accountTypeId = (await this.resolveAccountType(dto.account_type_id)).id;
    }
    if (dto.parent_id !== undefined) {
      if (dto.parent_id === id) {
        throw new AppException('ACCOUNT_PARENT_CYCLE', 'An account cannot be its own parent.', 'لا يمكن أن يكون الحساب أبًا لنفسه.', 422);
      }
      if (dto.parent_id) {
        const parent = await this.prisma.account.findUnique({ where: { id: dto.parent_id } });
        if (!parent) throw Errors.notFound('Parent account');
        if (parent.companyId !== account.companyId) throw Errors.accountCompanyMismatch();
        // Cycle check: walk up from the new parent; must never reach this account.
        let cursor: string | null = parent.parentId;
        const seen = new Set<string>([parent.id]);
        while (cursor) {
          if (cursor === id || seen.has(cursor)) {
            throw new AppException('ACCOUNT_PARENT_CYCLE', 'This parent would create a cycle in the account hierarchy.', 'هذا الأب سيخلق دورة في شجرة الحسابات.', 422);
          }
          seen.add(cursor);
          const next = await this.prisma.account.findUnique({ where: { id: cursor }, select: { parentId: true } });
          cursor = next?.parentId ?? null;
        }
      }
    }
    if (dto.is_postable === false && account.isPostable) {
      const lineCount = await this.prisma.journalLine.count({ where: { accountId: id } });
      if (lineCount > 0) throw Errors.accountHasPostingsUnprocessable();
    }

    try {
      const updated = await this.prisma.account.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
          ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
          ...(accountTypeId !== undefined ? { accountTypeId } : {}),
          ...(dto.parent_id !== undefined ? { parentId: dto.parent_id } : {}),
          ...(dto.is_postable !== undefined ? { isPostable: dto.is_postable } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        include: { type: true, parent: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'account.updated',
        entityType: 'account', entityId: id, ip,
      });
      return this.accountDto(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('code');
      }
      throw e;
    }
  }

  async deactivateAccount(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const account = await this.prisma.account.findUnique({ where: { id }, include: { company: true } });
    if (!account || account.company.organizationId !== ctx.organizationId) throw Errors.notFound('Account');
    this.assertCompanyInScope(ctx, account.companyId);
    const lineCount = await this.prisma.journalLine.count({ where: { accountId: id } });
    if (lineCount > 0) throw Errors.accountHasPostings();
    const updated = await this.prisma.account.update({
      where: { id },
      data: { isActive: false },
      include: {
        type: { select: { code: true, nameAr: true, nameEn: true } },
        parent: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'account.deactivated',
      entityType: 'account', entityId: id, ip,
    });
    return this.accountDto(updated);
  }

  async seedCoa(ctx: OrgContext, companyId: string, actorId: string, ip?: string) {
    await this.companyInScope(ctx, companyId);
    const result = await seedChartOfAccounts(this.prisma, companyId, actorId);
    if (!result.skipped) {
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'account.coa_seeded',
        entityType: 'company', entityId: companyId, diff: { created: result.created }, ip,
      });
    }
    return result;
  }

  // ---------- fiscal years / periods ----------

  async createFiscalYear(ctx: OrgContext, dto: FiscalYearCreateDto, actorId: string, ip?: string) {
    const company = await this.companyInScope(ctx, dto.company_id);
    const start = new Date(dto.start_date + 'T00:00:00Z');
    try {
      const year = await this.prisma.$transaction(async (tx) => {
        const fy = await tx.fiscalYear.create({
          data: {
            companyId: company.id,
            name: dto.name,
            startDate: start,
            endDate: new Date(dto.end_date + 'T00:00:00Z'),
          },
        });
        for (let m = 0; m < 12; m++) {
          const pStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
          const pEnd = new Date(Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth() + 1, 0));
          const name = `${pStart.getUTCFullYear()}-${String(pStart.getUTCMonth() + 1).padStart(2, '0')}`;
          await tx.accountingPeriod.create({
            data: {
              fiscalYearId: fy.id,
              companyId: company.id,
              name,
              startDate: pStart,
              endDate: pEnd,
              status: 'open',
            },
          });
        }
        return fy;
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'fiscal_year.created',
        entityType: 'fiscal_year', entityId: year.id, ip,
      });
      return { ...this.fiscalYearDto(year), periods_created: 12 };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('name');
      }
      throw e;
    }
  }

  async listFiscalYears(ctx: OrgContext, companyId: string) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.prisma.fiscalYear.findMany({
      where: { companyId },
      include: { _count: { select: { periods: true } } },
      orderBy: { startDate: 'desc' },
    });
    return rows.map((r) => this.fiscalYearDto(r));
  }

  async listPeriods(ctx: OrgContext, fiscalYearId: string) {
    const fy = await this.prisma.fiscalYear.findUnique({
      where: { id: fiscalYearId }, include: { company: true },
    });
    if (!fy || fy.company.organizationId !== ctx.organizationId) throw Errors.notFound('Fiscal year');
    this.assertCompanyInScope(ctx, fy.companyId);
    const rows = await this.prisma.accountingPeriod.findMany({
      where: { fiscalYearId },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((r) => this.periodDto(r));
  }

  private async periodInScope(ctx: OrgContext, id: string) {
    const period = await this.prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw Errors.notFound('Accounting period');
    // AccountingPeriod has no company relation in the schema — resolve via companyId.
    const company = await this.prisma.company.findFirst({
      where: { id: period.companyId, organizationId: ctx.organizationId },
    });
    if (!company) throw Errors.notFound('Accounting period');
    this.assertCompanyInScope(ctx, period.companyId);
    return { period, company };
  }

  async closePeriod(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const { period } = await this.periodInScope(ctx, id);
    assertPeriodTransition(period.status, 'closed');
    const updated = await this.prisma.accountingPeriod.update({
      where: { id },
      data: { status: 'closed', closedById: actorId, closedAt: new Date() },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'period.closed',
      entityType: 'accounting_period', entityId: id, ip,
    });
    await this.notifications.notifyPermissionHolders(this.prisma, ctx.organizationId, 'period', 'close', {
      type: 'period_closed',
      titleAr: `تم إقفال الفترة المحاسبية ${period.name}`,
      titleEn: `Accounting period ${period.name} closed`,
      link: `/periods`,
    }, actorId);
    return this.periodDto(updated);
  }

  async lockPeriod(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const { period } = await this.periodInScope(ctx, id);
    assertPeriodTransition(period.status, 'locked');
    const updated = await this.prisma.accountingPeriod.update({ where: { id }, data: { status: 'locked' } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'period.locked',
      entityType: 'accounting_period', entityId: id, ip,
    });
    await this.notifications.notifyPermissionHolders(this.prisma, ctx.organizationId, 'period', 'close', {
      type: 'period_locked',
      titleAr: `تم قفل الفترة المحاسبية ${period.name}`,
      titleEn: `Accounting period ${period.name} locked`,
      link: `/periods`,
    }, actorId);
    return this.periodDto(updated);
  }

  async reopenPeriod(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const { period } = await this.periodInScope(ctx, id);
    if (!canTransitionPeriod(period.status as 'open' | 'closed' | 'locked', 'open')) {
      throw Errors.periodInvalidTransition(period.status, 'open');
    }
    const updated = await this.prisma.accountingPeriod.update({
      where: { id },
      data: { status: 'open', closedById: null, closedAt: null },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'period.reopened',
      entityType: 'accounting_period', entityId: id, ip,
    });
    return this.periodDto(updated);
  }

  // ---------- journal ----------

  private async validateLineAccounts(
    companyId: string,
    lines: Array<{ account_id: string; tax_code_id?: string | null }>,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const accountIds = [...new Set(lines.map((l) => l.account_id))];
    const accounts = await db.account.findMany({ where: { id: { in: accountIds } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const codes = new Map<string, string>();
    for (const aid of accountIds) {
      const a = byId.get(aid);
      if (!a) throw Errors.notFound('Account');
      if (a.companyId !== companyId) throw Errors.accountCompanyMismatch();
      if (!a.isActive) throw Errors.glAccountInactive(a.code);
      if (!a.isPostable) throw Errors.accountNotPostable(a.code);
      codes.set(aid, a.code);
    }
    const taxIds = [...new Set(lines.map((l) => l.tax_code_id).filter(Boolean) as string[])];
    if (taxIds.length > 0) {
      const taxes = await db.taxCode.findMany({ where: { id: { in: taxIds } } });
      const tById = new Map(taxes.map((t) => [t.id, t]));
      for (const tid of taxIds) {
        const t = tById.get(tid);
        if (!t || !t.isActive) throw Errors.notFound('Tax code');
        if (t.companyId !== companyId) throw Errors.accountCompanyMismatch();
      }
    }
    return codes;
  }

  private async resolveEntryCurrency(company: { baseCurrency: string }, dto: { currency?: string; exchange_rate?: string }) {
    const currency = dto.currency ?? company.baseCurrency;
    await this.currencyDecimals(currency); // 404 when unknown
    let rate = new Decimal(1);
    if (dto.exchange_rate !== undefined) {
      rate = toDecimal(dto.exchange_rate);
      if (!rate.isFinite() || rate.lte(0)) {
        throw new AppException('EXCHANGE_RATE_INVALID', 'Exchange rate must be a positive number.', 'سعر الصرف يجب أن يكون رقمًا موجبًا.', 422);
      }
    } else if (currency !== company.baseCurrency) {
      throw new AppException('EXCHANGE_RATE_REQUIRED', 'Exchange rate is required for foreign-currency journals.', 'سعر الصرف مطلوب للقيود بالعملة الأجنبية.', 422);
    }
    return { currency, rate };
  }

  async createEntry(
    ctx: OrgContext, dto: JournalEntryCreateDto, actorId: string, ip?: string,
  ): Promise<{ entry: ReturnType<AccountingService['entryDto']>; replayed: boolean }> {
    const company = await this.companyInScope(ctx, dto.company_id);
    const { currency, rate } = await this.resolveEntryCurrency(company, dto);
    await this.validateLineAccounts(company.id, dto.lines);
    const baseDecimals = await this.currencyDecimals(company.baseCurrency);

    const idemKey = dto.idempotency_key ? normalizeIdempotencyKey(dto.idempotency_key) : null;
    if (idemKey) {
      const existing = await this.prisma.journalEntry.findUnique({
        where: { idempotencyKey: idemKey },
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
      });
      if (existing) {
        if (existing.company.organizationId !== ctx.organizationId) throw Errors.forbidden();
        return { entry: this.entryDto(existing, baseDecimals), replayed: true };
      }
    }

    const data = {
      companyId: company.id,
      journalType: 'manual',
      postingDate: new Date(dto.posting_date + 'T00:00:00Z'),
      currency,
      exchangeRate: rate,
      description: dto.description,
      status: 'draft',
      idempotencyKey: idemKey,
      createdById: actorId,
      lines: {
        create: dto.lines.map((l) => ({
          accountId: l.account_id,
          debit: toDecimal(l.debit),
          credit: toDecimal(l.credit),
          description: l.description ?? null,
          costCenter: l.cost_center ?? null,
          taxCodeId: l.tax_code_id ?? null,
        })),
      },
    };

    try {
      const entry = await this.prisma.journalEntry.create({
        data,
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'journal.created',
        entityType: 'journal_entry', entityId: entry.id, ip,
      });
      return { entry: this.entryDto(entry, baseDecimals), replayed: false };
    } catch (e) {
      // Race on the same idempotency key: return the winner's entry (no duplicate).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && idemKey) {
        const existing = await this.prisma.journalEntry.findUnique({
          where: { idempotencyKey: idemKey },
          include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
        });
        if (existing) return { entry: this.entryDto(existing, baseDecimals), replayed: true };
      }
      throw e;
    }
  }

  async listEntries(
    ctx: OrgContext,
    q: { company_id: string; status?: string; from?: string; to?: string; page: number; per_page: number },
  ) {
    const company = await this.companyInScope(ctx, q.company_id);
    const where = {
      companyId: company.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { postingDate: { gte: new Date(q.from + 'T00:00:00Z') } } : {}),
      ...(q.to ? { postingDate: { lte: new Date(q.to + 'T00:00:00Z') } } : {}),
    };
    const baseDecimals = await this.currencyDecimals(company.baseCurrency);
    const [total, entries] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
        orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return {
      data: entries.map((e) => this.entryDto(e, baseDecimals)),
      meta: pageMeta(total, q.page, q.per_page),
    };
  }

  async getEntry(ctx: OrgContext, id: string) {
    const entry = await this.getEntryInScope(ctx, id);
    const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
    return this.entryDto(entry, baseDecimals);
  }

  async updateEntry(ctx: OrgContext, id: string, dto: JournalEntryUpdateDto, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    assertDraft(entry.status);
    const company = entry.company;
    // Preserve existing currency/rate when the patch doesn't touch them.
    const effCurrency = dto.currency ?? entry.currency;
    await this.currencyDecimals(effCurrency);
    let effRate: Decimal;
    if (dto.exchange_rate !== undefined) {
      effRate = toDecimal(dto.exchange_rate);
      if (!effRate.isFinite() || effRate.lte(0)) {
        throw new AppException('EXCHANGE_RATE_INVALID', 'Exchange rate must be a positive number.', 'سعر الصرف يجب أن يكون رقمًا موجبًا.', 422);
      }
    } else if (dto.currency !== undefined && dto.currency !== company.baseCurrency) {
      throw new AppException('EXCHANGE_RATE_REQUIRED', 'Exchange rate is required for foreign-currency journals.', 'سعر الصرف مطلوب للقيود بالعملة الأجنبية.', 422);
    } else if (dto.currency !== undefined) {
      effRate = new Decimal(1);
    } else {
      effRate = toDecimal(entry.exchangeRate);
    }
    await this.validateLineAccounts(company.id, dto.lines);
    const baseDecimals = await this.currencyDecimals(company.baseCurrency);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
      return tx.journalEntry.update({
        where: { id },
        data: {
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.posting_date !== undefined ? { postingDate: new Date(dto.posting_date + 'T00:00:00Z') } : {}),
          currency: effCurrency,
          exchangeRate: effRate,
          version: { increment: 1 },
          lines: {
            create: dto.lines.map((l) => ({
              accountId: l.account_id,
              debit: toDecimal(l.debit),
              credit: toDecimal(l.credit),
              description: l.description ?? null,
              costCenter: l.cost_center ?? null,
              taxCodeId: l.tax_code_id ?? null,
            })),
          },
        },
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
      });
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.updated',
      entityType: 'journal_entry', entityId: id, ip,
    });
    return this.entryDto(updated, baseDecimals);
  }

  async deleteEntry(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    assertDraft(entry.status);
    await this.prisma.journalEntry.delete({ where: { id } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.deleted',
      entityType: 'journal_entry', entityId: id, ip,
    });
    return { ok: true };
  }

  async submitEntry(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    if (entry.status !== 'draft') throw Errors.journalNotDraft();
    const updated = await this.prisma.journalEntry.update({
      where: { id }, data: { status: 'submitted' },
      include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
    });
    const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.submitted',
      entityType: 'journal_entry', entityId: id, ip,
    });
    return this.entryDto(updated, baseDecimals);
  }

  async approveEntry(ctx: OrgContext, id: string, dto: JournalApproveDto, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    if (entry.status !== 'submitted') throw Errors.journalInvalidTransition(entry.status, 'approved');
    if (entry.company.makerCheckerJournal && entry.createdById === actorId) {
      throw Errors.makerCheckerViolation();
    }
    const updated = await this.prisma.journalEntry.update({
      where: { id }, data: { status: 'approved' },
      include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
    });
    const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.approved',
      entityType: 'journal_entry', entityId: id,
      diff: dto.comment ? { comment: dto.comment } : undefined, ip,
    });
    return this.entryDto(updated, baseDecimals);
  }

  async rejectEntry(ctx: OrgContext, id: string, dto: JournalRejectDto, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    if (entry.status !== 'submitted') throw Errors.journalInvalidTransition(entry.status, 'draft');
    const updated = await this.prisma.journalEntry.update({
      where: { id }, data: { status: 'draft' },
      include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
    });
    const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.rejected',
      entityType: 'journal_entry', entityId: id, diff: { comment: dto.comment }, ip,
    });
    return this.entryDto(updated, baseDecimals);
  }

  /**
   * Post a journal — the correctness-critical path. One transaction, in order:
   * state + version check, ≥2 lines, account validation, decimal balance check,
   * open-period resolution, then the atomic state flip with optimistic locking.
   */
  async postEntry(ctx: OrgContext, id: string, version: number, actorId: string, ip?: string) {
    const entry = await this.getEntryInScope(ctx, id);
    // (a) idempotent re-post: already posted -> return as-is, 200, no-op.
    if (entry.status === 'posted') {
      const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
      return this.entryDto(entry, baseDecimals);
    }
    if (entry.status !== 'submitted' && entry.status !== 'approved') {
      throw Errors.journalNotPostable();
    }
    if (entry.version !== version) throw Errors.concurrentModification();
    // (b) line count
    if (entry.lines.length < 2) throw Errors.journalTooFewLines();
    // (c) account validation
    await this.validateLineAccounts(entry.companyId, entry.lines.map((l) => ({
      account_id: l.accountId, tax_code_id: l.taxCodeId,
    })));
    // (d) decimal balance check in functional currency
    const baseDecimals = await this.currencyDecimals(entry.company.baseCurrency);
    assertBalanced(entry.lines, entry.exchangeRate, baseDecimals);
    // (e) period resolution
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId: entry.companyId,
        startDate: { lte: entry.postingDate },
        endDate: { gte: entry.postingDate },
      },
    });
    if (!period) throw Errors.periodNotDefined(entry.postingDate.toISOString().slice(0, 10));
    if (period.status !== 'open') throw Errors.periodClosed(period.name);

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.journalEntry.updateMany({
        where: { id: entry.id, version: entry.version, status: { in: ['submitted', 'approved'] } },
        data: {
          status: 'posted',
          periodId: period.id,
          postedById: actorId,
          postedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw Errors.concurrentModification();
      return tx.journalEntry.findUnique({
        where: { id: entry.id },
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
      });
    });
    if (!updated) throw Errors.notFound('Journal entry');
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.posted',
      entityType: 'journal_entry', entityId: id,
      diff: { period_id: period.id, version: entry.version + 1 }, ip,
    });
    return this.entryDto(updated, baseDecimals);
  }

  /**
   * Reverse a posted journal: creates a NEW posted reversal entry with
   * mirrored lines (debit<->credit); the original becomes 'reversed' and stays
   * immutable. Posted into the currently open period.
   */
  async reverseEntry(ctx: OrgContext, id: string, dto: JournalReverseDto, actorId: string, ip?: string) {
    const original = await this.getEntryInScope(ctx, id);
    if (original.status !== 'posted') throw Errors.journalNotPostable();
    const baseDecimals = await this.currencyDecimals(original.company.baseCurrency);

    const today = new Date();
    const postingDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId: original.companyId,
        startDate: { lte: postingDate },
        endDate: { gte: postingDate },
      },
    });
    if (!period) throw Errors.periodNotDefined(postingDate.toISOString().slice(0, 10));
    if (period.status !== 'open') throw Errors.periodClosed(period.name);

    const reversal = await this.prisma.$transaction(async (tx) => {
      const rev = await tx.journalEntry.create({
        data: {
          companyId: original.companyId,
          periodId: period.id,
          journalType: 'reversal',
          postingDate,
          currency: original.currency,
          exchangeRate: original.exchangeRate,
          description: dto.description ?? `Reversal of journal ${original.id}`,
          status: 'posted',
          reversalOfId: original.id,
          postedById: actorId,
          postedAt: new Date(),
          createdById: actorId,
          lines: {
            create: original.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: l.description,
              costCenter: l.costCenter,
              taxCodeId: l.taxCodeId,
            })),
          },
        },
        include: { lines: { orderBy: { createdAt: 'asc' } }, company: true },
      });
      await tx.journalEntry.update({ where: { id: original.id }, data: { status: 'reversed' } });
      return rev;
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'journal.reversed',
      entityType: 'journal_entry', entityId: id,
      diff: { reversal_id: reversal.id }, ip,
    });
    return this.entryDto(reversal, baseDecimals);
  }

  // ---------- tax codes ----------

  async listTaxCodes(ctx: OrgContext, companyId: string) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.prisma.taxCode.findMany({
      where: { companyId },
      include: { taxAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      orderBy: { nameEn: 'asc' },
    });
    return rows.map((r) => this.taxCodeDto(r));
  }

  async createTaxCode(ctx: OrgContext, dto: TaxCodeCreateDto, actorId: string, ip?: string) {
    const company = await this.companyInScope(ctx, dto.company_id);
    const rate = toDecimal(dto.rate);
    if (rate.lt(0) || rate.gt(100)) {
      throw new AppException('TAX_RATE_INVALID', 'Tax rate must be between 0 and 100.', 'نسبة الضريبة يجب أن تكون بين 0 و 100.', 422);
    }
    let taxAccountId: string | null = null;
    if (dto.tax_account_id) {
      const acc = await this.prisma.account.findUnique({ where: { id: dto.tax_account_id } });
      if (!acc) throw Errors.notFound('Account');
      if (acc.companyId !== company.id) throw Errors.accountCompanyMismatch();
      if (!acc.isActive) throw Errors.glAccountInactive(acc.code);
      taxAccountId = acc.id;
    }
    try {
      const tax = await this.prisma.taxCode.create({
        data: {
          companyId: company.id,
          nameAr: dto.name_ar,
          nameEn: dto.name_en,
          rate,
          type: dto.type,
          taxAccountId,
        },
        include: { taxAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'tax_code.created',
        entityType: 'tax_code', entityId: tax.id, ip,
      });
      return this.taxCodeDto(tax);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('name_en');
      }
      throw e;
    }
  }

  async updateTaxCode(ctx: OrgContext, id: string, dto: TaxCodeUpdateDto, actorId: string, ip?: string) {
    const tax = await this.prisma.taxCode.findUnique({ where: { id }, include: { company: true } });
    if (!tax || tax.company.organizationId !== ctx.organizationId) throw Errors.notFound('Tax code');
    this.assertCompanyInScope(ctx, tax.companyId);
    if (dto.rate !== undefined) {
      const rate = toDecimal(dto.rate);
      if (rate.lt(0) || rate.gt(100)) {
        throw new AppException('TAX_RATE_INVALID', 'Tax rate must be between 0 and 100.', 'نسبة الضريبة يجب أن تكون بين 0 و 100.', 422);
      }
    }
    let taxAccountId: string | null | undefined;
    if (dto.tax_account_id !== undefined) {
      if (dto.tax_account_id) {
        const acc = await this.prisma.account.findUnique({ where: { id: dto.tax_account_id } });
        if (!acc) throw Errors.notFound('Account');
        if (acc.companyId !== tax.companyId) throw Errors.accountCompanyMismatch();
        if (!acc.isActive) throw Errors.glAccountInactive(acc.code);
        taxAccountId = acc.id;
      } else {
        taxAccountId = null;
      }
    }
    try {
      const updated = await this.prisma.taxCode.update({
        where: { id },
        data: {
          ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
          ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
          ...(dto.rate !== undefined ? { rate: toDecimal(dto.rate) } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(taxAccountId !== undefined ? { taxAccountId } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        },
        include: { taxAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'tax_code.updated',
        entityType: 'tax_code', entityId: id, ip,
      });
      return this.taxCodeDto(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('name_en');
      }
      throw e;
    }
  }

  async deactivateTaxCode(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const tax = await this.prisma.taxCode.findUnique({ where: { id }, include: { company: true } });
    if (!tax || tax.company.organizationId !== ctx.organizationId) throw Errors.notFound('Tax code');
    this.assertCompanyInScope(ctx, tax.companyId);
    const updated = await this.prisma.taxCode.update({
      where: { id },
      data: { isActive: false },
      include: { taxAccount: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'tax_code.deactivated',
      entityType: 'tax_code', entityId: id, ip,
    });
    return this.taxCodeDto(updated);
  }

  /**
   * Idempotent standard tax codes (14% input + 14% output). Illustrative
   * defaults — rates and accounts are configurable per tax authority rules.
   */
  async seedStandardTaxCodes(ctx: OrgContext, companyId: string, actorId: string, ip?: string) {
    const company = await this.companyInScope(ctx, companyId);
    const accounts = await this.prisma.account.findMany({
      where: { companyId: company.id, code: { in: ['1230', '2120'] } },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    if (!byCode.get('1230') || !byCode.get('2120')) throw Errors.coaNotSeeded();

    const created: string[] = [];
    const skipped: string[] = [];
    for (const t of STANDARD_TAX_CODES) {
      const exists = await this.prisma.taxCode.findUnique({
        where: { companyId_nameEn: { companyId: company.id, nameEn: t.nameEn } },
      });
      if (exists) {
        skipped.push(t.nameEn);
        continue;
      }
      const tax = await this.prisma.taxCode.create({
        data: {
          companyId: company.id,
          nameAr: t.nameAr,
          nameEn: t.nameEn,
          rate: new Decimal(t.rate),
          type: t.type,
          taxAccountId: byCode.get(t.accountCode)!.id,
        },
      });
      created.push(tax.nameEn);
    }
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'tax_code.standard_seeded',
      entityType: 'company', entityId: companyId, diff: { created, skipped }, ip,
    });
    return {
      created,
      skipped,
      note: 'Standard rates are illustrative defaults — configure per tax authority rules. / النسب الافتراضية استرشادية — اضبطها وفق قواعد مصلحة الضرائب.',
    };
  }

  // ---------- reports ----------

  /**
   * Trial balance: server-side aggregation over POSTED lines in the date range,
   * converted to functional currency per line (rounded per base decimals,
   * half-up) — consistent with the posting engine, so a balanced ledger always
   * yields a balanced TB.
   */
  async trialBalance(ctx: OrgContext, companyId: string, from: string, to: string) {
    const company = await this.companyInScope(ctx, companyId);
    const baseDecimals = await this.currencyDecimals(company.baseCurrency);
    const rows = await this.prisma.$queryRaw<Array<{
      account_id: string; code: string; name_ar: string; name_en: string;
      total_debit: string; total_credit: string;
    }>>`
      SELECT a.id AS account_id, a.code, a.name_ar, a.name_en,
        COALESCE(SUM(ROUND(l.debit * e.exchange_rate, ${baseDecimals}::int)), 0)::text AS total_debit,
        COALESCE(SUM(ROUND(l.credit * e.exchange_rate, ${baseDecimals}::int)), 0)::text AS total_credit
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE e.company_id = ${companyId}::uuid
        AND e.status = 'posted'
        AND e.posting_date >= ${from}::date
        AND e.posting_date <= ${to}::date
      GROUP BY a.id, a.code, a.name_ar, a.name_en
      ORDER BY a.code
    `;
    const lines = rows.map((r) => ({
      account_id: r.account_id,
      code: r.code,
      name_ar: r.name_ar,
      name_en: r.name_en,
      total_debit: moneyString(r.total_debit, baseDecimals),
      total_credit: moneyString(r.total_credit, baseDecimals),
    }));
    const totalDebit = lines.reduce((acc, l) => acc.plus(toDecimal(l.total_debit)), new Decimal(0));
    const totalCredit = lines.reduce((acc, l) => acc.plus(toDecimal(l.total_credit)), new Decimal(0));
    return {
      company_id: companyId,
      from,
      to,
      currency: company.baseCurrency,
      lines,
      total_debit: totalDebit.toFixed(baseDecimals),
      total_credit: totalCredit.toFixed(baseDecimals),
      balanced: totalDebit.eq(totalCredit),
    };
  }

  /** Round-trip sanity: convert each line at the entry rate (used by TB parity checks). */
  lineBaseAmount(debit: Decimal, credit: Decimal, exchangeRate: Decimal, baseDecimals: number) {
    return {
      debit: convertToBase(debit, exchangeRate, baseDecimals).toFixed(baseDecimals),
      credit: convertToBase(credit, exchangeRate, baseDecimals).toFixed(baseDecimals),
    };
  }

  /**
   * Post a system-generated journal atomically inside the caller's transaction.
   *
   * The caller (e.g. InventoryService) opens `prisma.$transaction` and passes
   * the tx client; the journal row, its lines, and the audit event are all
   * written in that same transaction, so a business operation can never leave
   * half a posting behind. Idempotent on `idempotency_key`.
   *
   * System entries always post in the company's base currency (rate = 1).
   */
  async postSystemEntry(
    tx: Prisma.TransactionClient,
    ctx: OrgContext,
    input: SystemJournalInput,
    actorId: string,
    ip?: string,
  ): Promise<{ id: string; replayed: boolean }> {
    this.assertCompanyInScope(ctx, input.company_id);
    const company = await tx.company.findUniqueOrThrow({ where: { id: input.company_id } });
    if (company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    const baseDecimals = await this.currencyDecimals(company.baseCurrency);

    const idemKey = input.idempotency_key ? normalizeIdempotencyKey(input.idempotency_key) : null;
    if (idemKey) {
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      if (existing) {
        if (existing.companyId !== input.company_id) throw Errors.forbidden();
        return { id: existing.id, replayed: true };
      }
    }

    if (input.lines.length < 2) throw Errors.journalTooFewLines();
    await this.validateLineAccounts(input.company_id, input.lines, tx);
    const lines = input.lines.map((l) => ({
      account_id: l.account_id,
      debit: toDecimal(l.debit),
      credit: toDecimal(l.credit),
      tax_code_id: null as string | null,
      description: l.description ?? input.description,
    }));
    assertBalanced(lines, new Decimal(1), baseDecimals);

    const postingDate = new Date(input.posting_date + 'T00:00:00Z');
    const period = await tx.accountingPeriod.findFirst({
      where: {
        companyId: input.company_id,
        startDate: { lte: postingDate },
        endDate: { gte: postingDate },
      },
    });
    if (!period) throw Errors.periodNotDefined(input.posting_date);
    if (period.status !== 'open') throw Errors.periodClosed(period.name);

    try {
      const entry = await tx.journalEntry.create({
        data: {
          companyId: input.company_id,
          journalType: input.journal_type,
          postingDate,
          periodId: period.id,
          currency: company.baseCurrency,
          exchangeRate: new Decimal(1),
          description: input.description,
          sourceType: input.source_type,
          sourceId: input.source_id,
          status: 'posted',
          idempotencyKey: idemKey,
          createdById: actorId,
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: lines.map((l) => ({
              accountId: l.account_id,
              debit: l.debit,
              credit: l.credit,
              description: l.description ?? input.description,
            })),
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: ctx.organizationId,
          actorId,
          action: 'journal.system_posted',
          entityType: 'journal_entry',
          entityId: entry.id,
          diff: { journal_type: input.journal_type, source_type: input.source_type, source_id: input.source_id } as object,
          ip: ip ?? null,
        },
      });
      return { id: entry.id, replayed: false };
    } catch (e) {
      // Race on the same idempotency key: return the winner, never a duplicate.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && idemKey) {
        const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
        if (existing) return { id: existing.id, replayed: true };
      }
      throw e;
    }
  }
}
