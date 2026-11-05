import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { NumberingService } from '../masterdata/numbering';
import { NotificationService } from '../notifications/notifications.service';
import { OrgContext } from '../common/request.types';
import { Errors } from '../common/errors';
import { toDecimal, roundMoney, moneyString } from '../accounting/money';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Phase 8 — finance completion: bank statements + reconciliation, expense bills.
 * All money math in decimal.js; GL postings go through postSystemEntry in the
 * same transaction as the business operation (atomic).
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationService,
  ) {}

  // ================= helpers =================

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  private async audit(tx: Tx, ctx: OrgContext, actorId: string, action: string, entityType: string, entityId: string, diff?: object, ip?: string) {
    await tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId, actorId, action,
        entityType, entityId, diff: (diff ?? undefined) as object | undefined, ip: ip ?? null,
      },
    });
  }

  private async baseDecimals(tx: Tx, companyId: string): Promise<number> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const cur = await tx.currency.findUnique({ where: { code: company.baseCurrency } });
    return cur?.decimals ?? 2;
  }

  private async resolveAccount(tx: Tx, companyId: string, code: string): Promise<string> {
    const a = await tx.account.findFirst({ where: { companyId, code } });
    if (!a) throw Errors.notFound(`Account ${code}`);
    return a.id;
  }

  private async scopedBankAccount(tx: Tx, companyId: string, accountId: string) {
    const a = await tx.account.findUnique({ where: { id: accountId }, include: { type: true } });
    if (!a || a.companyId !== companyId || !a.isActive || !a.isPostable) throw Errors.notFound('Bank account');
    if (a.type.code !== 'ASSET' || !['1100', '1110'].includes(a.code)) throw Errors.notFound('Bank account');
    return a;
  }

  private async checkIdempotency(tx: Tx, ctx: OrgContext, model: 'bankStatement' | 'expenseBill', key: string | undefined | null) {
    if (!key) return null;
    const existing = await (tx as unknown as Record<string, { findUnique: (a: unknown) => Promise<{ id: string; companyId: string } | null> }>)[model]
      .findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      this.assertCompanyInScope(ctx, existing.companyId);
      return existing;
    }
    return null;
  }

  // ================= bank statements =================

  async createBankStatement(ctx: OrgContext, dto: {
    company_id: string; account_id: string; statement_date: string;
    opening_balance: string; closing_balance: string; notes?: string;
    lines: Array<{ value_date: string; description: string; reference?: string; amount: string }>;
    idempotency_key?: string | null;
  }, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      this.assertCompanyInScope(ctx, dto.company_id);
      const dup = await this.checkIdempotency(tx, ctx, 'bankStatement', dto.idempotency_key);
      if (dup) return { bank_statement: await this.bankStatementDto(tx, dup.id), replayed: true };

      const account = await this.scopedBankAccount(tx, dto.company_id, dto.account_id);
      const dec = await this.baseDecimals(tx, dto.company_id);

      const lines = dto.lines.map((l, i) => ({
        lineNo: i + 1,
        valueDate: new Date(l.value_date),
        description: l.description,
        reference: l.reference ?? null,
        amount: roundMoney(toDecimal(l.amount), dec),
      }));
      const linesTotal = lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const expected = roundMoney(toDecimal(dto.opening_balance).plus(linesTotal), dec);
      const closing = roundMoney(toDecimal(dto.closing_balance), dec);
      if (!expected.eq(closing)) throw Errors.statementNotBalanced(expected.toFixed(dec), closing.toFixed(dec));

      const number = await this.numbering.nextNumber(dto.company_id, 'bank_statement');
      const st = await tx.bankStatement.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id,
          accountId: account.id, number, status: 'draft',
          statementDate: new Date(dto.statement_date),
          openingBalance: roundMoney(toDecimal(dto.opening_balance), dec),
          closingBalance: closing,
          notes: dto.notes ?? null, createdById: actorId,
          idempotencyKey: dto.idempotency_key ?? null,
          lines: {
            create: lines.map((l) => ({
              organizationId: ctx.organizationId,
              lineNo: l.lineNo, valueDate: l.valueDate, description: l.description,
              reference: l.reference, amount: l.amount,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'finance.statement_created', 'bank_statement', st.id, { number }, ip);
      return { bank_statement: await this.bankStatementDto(tx, st.id), replayed: false };
    });
  }

  async listBankStatements(ctx: OrgContext, q: { company_id: string; account_id?: string; status?: string; page: number; per_page: number }) {
    this.assertCompanyInScope(ctx, q.company_id);
    const where = {
      companyId: q.company_id,
      ...(q.account_id ? { accountId: q.account_id } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bankStatement.count({ where }),
      this.prisma.bankStatement.findMany({
        where,
        include: { account: true, _count: { select: { lines: true } } },
        orderBy: { statementDate: 'desc' },
        skip: (q.page - 1) * q.per_page, take: q.per_page,
      }),
    ]);
    return {
      data: rows.map((s) => ({
        id: s.id, number: s.number, status: s.status,
        account_id: s.accountId, account_code: s.account.code,
        statement_date: s.statementDate.toISOString().slice(0, 10),
        opening_balance: String(s.openingBalance), closing_balance: String(s.closingBalance),
        lines_count: s._count.lines,
      })),
      meta: { page: q.page, per_page: q.per_page, total, total_pages: Math.ceil(total / q.per_page) },
    };
  }

  async getBankStatement(ctx: OrgContext, id: string) {
    const st = await tx_scoped_bank_statement(this.prisma, ctx, id);
    return this.bankStatementDto(this.prisma, st.id);
  }

  private async bankStatementDto(tx: Tx, id: string) {
    const s = await tx.bankStatement.findUniqueOrThrow({
      where: { id },
      include: { account: true, lines: { orderBy: { lineNo: 'asc' } } },
    });
    const matched = s.lines.filter((l) => l.reconciledEntryId).length;
    return {
      id: s.id, number: s.number, status: s.status,
      account_id: s.accountId, account_code: s.account.code,
      statement_date: s.statementDate.toISOString().slice(0, 10),
      opening_balance: String(s.openingBalance), closing_balance: String(s.closingBalance),
      notes: s.notes, matched_lines: matched, total_lines: s.lines.length,
      lines: s.lines.map((l) => ({
        id: l.id, line_no: l.lineNo,
        value_date: l.valueDate.toISOString().slice(0, 10),
        description: l.description, reference: l.reference,
        amount: String(l.amount),
        reconciled_entry_id: l.reconciledEntryId,
        reconciled_at: l.reconciledAt?.toISOString() ?? null,
      })),
    };
  }

  async postBankStatement(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const st = await tx_scoped_bank_statement(tx, ctx, id);
      if (st.status !== 'draft') throw Errors.invalidFinanceTransition('bank_statement', st.status, 'posted');
      await tx.bankStatement.update({ where: { id }, data: { status: 'posted' } });
      await this.audit(tx, ctx, actorId, 'finance.statement_posted', 'bank_statement', id, { number: st.number }, ip);
      return { bank_statement: await this.bankStatementDto(tx, id) };
    });
  }

  /**
   * Match a statement line to a posted journal entry, 1:1, tolerance ZERO.
   * The journal's net amount on the statement's bank account must equal the
   * statement line amount exactly (signed: +inflow / −outflow).
   */
  async matchStatementLine(ctx: OrgContext, lineId: string, journalEntryId: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.bankStatementLine.findUnique({
        where: { id: lineId }, include: { bankStatement: true },
      });
      if (!line || line.organizationId !== ctx.organizationId) throw Errors.notFound('Bank statement line');
      this.assertCompanyInScope(ctx, line.bankStatement.companyId);
      if (line.reconciledEntryId) throw Errors.alreadyMatched();

      const entry = await tx.journalEntry.findUnique({
        where: { id: journalEntryId },
        select: {
          id: true, companyId: true, status: true,
          company: { select: { organizationId: true } },
          lines: { select: { id: true, accountId: true, debit: true, credit: true } },
        },
      });
      if (!entry || entry.company.organizationId !== ctx.organizationId || entry.companyId !== line.bankStatement.companyId) {
        throw Errors.notFound('Journal entry');
      }
      if (entry.status !== 'posted') throw Errors.notFound('Journal entry');

      const acctLines = entry.lines.filter((l) => l.accountId === line.bankStatement.accountId);
      const net = acctLines.reduce((s, l) => s.plus(toDecimal(l.debit)).minus(toDecimal(l.credit)), new Decimal(0));
      const stmtAmt = toDecimal(line.amount);
      if (!net.eq(stmtAmt)) {
        const dec = await this.baseDecimals(tx, line.bankStatement.companyId);
        throw Errors.matchAmountMismatch(stmtAmt.toFixed(dec), net.toFixed(dec));
      }

      await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { reconciledEntryId: entry.id, reconciledAt: new Date(), reconciledById: actorId },
      });
      await this.audit(tx, ctx, actorId, 'finance.line_matched', 'bank_statement_line', lineId,
        { journal_entry_id: entry.id, amount: String(line.amount) }, ip);
      return { matched: true, line_id: lineId, journal_entry_id: entry.id };
    });
  }

  async unmatchStatementLine(ctx: OrgContext, lineId: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.bankStatementLine.findUnique({
        where: { id: lineId }, include: { bankStatement: true },
      });
      if (!line || line.organizationId !== ctx.organizationId) throw Errors.notFound('Bank statement line');
      this.assertCompanyInScope(ctx, line.bankStatement.companyId);
      if (!line.reconciledEntryId) throw Errors.notMatched();
      await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { reconciledEntryId: null, reconciledAt: null, reconciledById: null },
      });
      await this.audit(tx, ctx, actorId, 'finance.line_unmatched', 'bank_statement_line', lineId, {}, ip);
      return { matched: false, line_id: lineId };
    });
  }

  /**
   * Outstanding items for a statement: unmatched statement lines plus posted
   * GL lines on the bank account (within ±45 days of the statement date) that
   * are not matched to any statement line.
   */
  async outstandingItems(ctx: OrgContext, statementId: string) {
    const st = await tx_scoped_bank_statement(this.prisma, ctx, statementId);
    const dec = await this.baseDecimals(this.prisma, st.companyId);

    const unmatchedLines = await this.prisma.bankStatementLine.findMany({
      where: { bankStatementId: statementId, reconciledEntryId: null },
      orderBy: { lineNo: 'asc' },
    });

    const matchedEntryIds = await this.prisma.bankStatementLine.findMany({
      where: { bankStatement: { accountId: st.accountId }, reconciledEntryId: { not: null } },
      select: { reconciledEntryId: true },
    });
    const matchedSet = new Set(matchedEntryIds.map((m) => m.reconciledEntryId as string));

    const from = new Date(st.statementDate); from.setDate(from.getDate() - 45);
    const to = new Date(st.statementDate); to.setDate(to.getDate() + 45);
    const glLines = await this.prisma.journalLine.findMany({
      where: {
        accountId: st.accountId,
        entry: { companyId: st.companyId, status: 'posted', postingDate: { gte: from, lte: to } },
      },
      include: { entry: true },
      orderBy: { entry: { postingDate: 'asc' } },
    });
    const unmatchedGl = glLines
      .filter((l) => !matchedSet.has(l.journalEntryId))
      .map((l) => ({
        journal_entry_id: l.journalEntryId,
        posting_date: l.entry.postingDate.toISOString().slice(0, 10),
        description: l.description,
        source_type: l.entry.sourceType,
        amount: toDecimal(l.debit).minus(toDecimal(l.credit)).toFixed(dec),
      }));

    return {
      statement_id: statementId, number: st.number,
      unmatched_statement_lines: unmatchedLines.map((l) => ({
        id: l.id, line_no: l.lineNo, value_date: l.valueDate.toISOString().slice(0, 10),
        description: l.description, reference: l.reference, amount: String(l.amount),
      })),
      unmatched_gl_lines: unmatchedGl,
    };
  }

  // ================= expense bills =================

  async createExpenseBill(ctx: OrgContext, dto: {
    company_id: string; supplier_id?: string | null; bill_date: string; due_date?: string | null;
    pay_from: 'supplier' | 'bank' | 'cash'; bank_account_id?: string | null; notes?: string;
    lines: Array<{ account_id: string; description: string; quantity: string; unit_price: string; tax_rate: string }>;
    idempotency_key?: string | null;
  }, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      this.assertCompanyInScope(ctx, dto.company_id);
      const dup = await this.checkIdempotency(tx, ctx, 'expenseBill', dto.idempotency_key);
      if (dup) return { expense_bill: await this.expenseBillDto(tx, dup.id), replayed: true };

      const dec = await this.baseDecimals(tx, dto.company_id);
      let bankAccountId: string | null = null;
      if (dto.pay_from !== 'supplier') {
        if (!dto.bank_account_id) throw Errors.notFound('Bank account');
        const ba = await this.scopedBankAccount(tx, dto.company_id, dto.bank_account_id);
        bankAccountId = ba.id;
      }
      let supplierId: string | null = null;
      if (dto.supplier_id) {
        const s = await tx.supplier.findUnique({ where: { id: dto.supplier_id } });
        if (!s || s.companyId !== dto.company_id) throw Errors.notFound('Supplier');
        supplierId = s.id;
      }

      const lines = [];
      let subtotal = new Decimal(0);
      let taxTotal = new Decimal(0);
      for (const l of dto.lines) {
        const a = await tx.account.findUnique({ where: { id: l.account_id }, include: { type: true } });
        if (!a || a.companyId !== dto.company_id || !a.isActive || !a.isPostable) throw Errors.notFound('Account');
        if (a.type.code !== 'EXPENSE') throw Errors.expenseAccountNotExpense(a.code);
        const qty = toDecimal(l.quantity);
        const price = toDecimal(l.unit_price);
        const rate = toDecimal(l.tax_rate);
        const lineTotal = roundMoney(qty.mul(price), dec);
        const taxAmount = roundMoney(lineTotal.mul(rate).div(100), dec);
        subtotal = subtotal.plus(lineTotal);
        taxTotal = taxTotal.plus(taxAmount);
        lines.push({ accountId: a.id, description: l.description, quantity: qty, unitPrice: price, taxRate: rate, lineTotal, taxAmount });
      }
      subtotal = roundMoney(subtotal, dec);
      taxTotal = roundMoney(taxTotal, dec);
      const total = roundMoney(subtotal.plus(taxTotal), dec);

      const company = await tx.company.findUniqueOrThrow({ where: { id: dto.company_id } });
      const number = await this.numbering.nextNumber(dto.company_id, 'expense_bill');
      const bill = await tx.expenseBill.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id,
          supplierId, number, status: 'draft',
          billDate: new Date(dto.bill_date),
          dueDate: dto.due_date ? new Date(dto.due_date) : null,
          subtotal, taxTotal, total, outstanding: total,
          payFrom: dto.pay_from, bankAccountId,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          requestedById: actorId, createdById: actorId,
          idempotencyKey: dto.idempotency_key ?? null,
          lines: {
            create: lines.map((l) => ({
              organizationId: ctx.organizationId,
              accountId: l.accountId, description: l.description,
              quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate,
              lineTotal: l.lineTotal, taxAmount: l.taxAmount,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'finance.expense_created', 'expense_bill', bill.id, { number, total: total.toFixed(dec) }, ip);
      return { expense_bill: await this.expenseBillDto(tx, bill.id), replayed: false };
    });
  }

  async listExpenseBills(ctx: OrgContext, q: { company_id: string; status?: string; supplier_id?: string; page: number; per_page: number }) {
    this.assertCompanyInScope(ctx, q.company_id);
    const where = {
      companyId: q.company_id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplier_id ? { supplierId: q.supplier_id } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expenseBill.count({ where }),
      this.prisma.expenseBill.findMany({ where, orderBy: { billDate: 'desc' }, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    ]);
    return {
      data: rows.map((b) => ({
        id: b.id, number: b.number, status: b.status,
        bill_date: b.billDate.toISOString().slice(0, 10),
        total: String(b.total), outstanding: String(b.outstanding), pay_from: b.payFrom,
      })),
      meta: { page: q.page, per_page: q.per_page, total, total_pages: Math.ceil(total / q.per_page) },
    };
  }

  async getExpenseBill(ctx: OrgContext, id: string) {
    const b = await tx_scoped_expense_bill(this.prisma, ctx, id);
    return this.expenseBillDto(this.prisma, b.id);
  }

  private async expenseBillDto(tx: Tx, id: string) {
    const b = await tx.expenseBill.findUniqueOrThrow({
      where: { id }, include: { lines: { include: { account: true } }, supplier: true },
    });
    return {
      id: b.id, number: b.number, status: b.status,
      supplier_id: b.supplierId,
      supplier_name: b.supplier ? b.supplier.nameEn : null,
      bill_date: b.billDate.toISOString().slice(0, 10),
      due_date: b.dueDate?.toISOString().slice(0, 10) ?? null,
      subtotal: String(b.subtotal), tax_total: String(b.taxTotal), total: String(b.total),
      paid_total: String(b.paidTotal), outstanding: String(b.outstanding),
      pay_from: b.payFrom, bank_account_id: b.bankAccountId,
      journal_entry_id: b.journalEntryId, notes: b.notes,
      lines: b.lines.map((l) => ({
        id: l.id, account_id: l.accountId, account_code: l.account.code,
        description: l.description, quantity: String(l.quantity), unit_price: String(l.unitPrice),
        tax_rate: String(l.taxRate), line_total: String(l.lineTotal), tax_amount: String(l.taxAmount),
      })),
    };
  }

  async transitionExpenseBill(ctx: OrgContext, id: string, action: 'submit' | 'approve' | 'reject' | 'cancel', actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx_scoped_expense_bill(tx, ctx, id);
      let to: string;
      if (action === 'submit') {
        if (b.status !== 'draft') throw Errors.invalidFinanceTransition('expense_bill', b.status, 'submitted');
        to = 'submitted';
      } else if (action === 'approve') {
        if (b.status !== 'submitted') throw Errors.invalidFinanceTransition('expense_bill', b.status, 'approved');
        if (b.requestedById === actorId) throw Errors.selfApprovalForbidden();
        to = 'approved';
      } else if (action === 'reject') {
        if (b.status !== 'submitted') throw Errors.invalidFinanceTransition('expense_bill', b.status, 'rejected');
        to = 'rejected';
      } else {
        if (b.status !== 'draft' && b.status !== 'approved') throw Errors.invalidFinanceTransition('expense_bill', b.status, 'cancelled');
        to = 'cancelled';
      }
      const data: Record<string, unknown> = { status: to };
      if (action === 'approve') { data.approvedById = actorId; data.approvedAt = new Date(); }
      await tx.expenseBill.update({ where: { id }, data });
      await this.audit(tx, ctx, actorId, `finance.expense_${action}`, 'expense_bill', id, { from: b.status, to }, ip);
      if (to === 'submitted') {
        await this.notifications.notifyPermissionHolders(tx, ctx.organizationId, 'expense_bill', 'approve', {
          type: 'approval_request',
          titleAr: `طلب اعتماد فاتورة مصروفات ${b.number}`,
          titleEn: `Expense bill ${b.number} needs approval`,
          link: `/finance/expenses/${id}`,
        }, actorId);
      } else if ((to === 'approved' || to === 'rejected') && b.requestedById && b.requestedById !== actorId) {
        await this.notifications.notify(tx, {
          organizationId: ctx.organizationId, userId: b.requestedById,
          type: 'approval_decision',
          titleAr: to === 'approved' ? `تم اعتماد فاتورة المصروفات ${b.number}` : `تم رفض فاتورة المصروفات ${b.number}`,
          titleEn: to === 'approved' ? `Expense bill ${b.number} approved` : `Expense bill ${b.number} rejected`,
          link: `/finance/expenses/${id}`,
        });
      }
      return { expense_bill: await this.expenseBillDto(tx, id) };
    });
  }

  /**
   * Post an approved expense bill. Atomic with the GL journal:
   * - pay_from=supplier: Dr expense lines / Dr 1230 input VAT / Cr 2110 AP
   * - pay_from=bank|cash: Dr expense lines / Dr 1230 input VAT / Cr bank/cash account
   */
  async postExpenseBill(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx_scoped_expense_bill(tx, ctx, id);
      if (b.status !== 'approved') throw Errors.invalidFinanceTransition('expense_bill', b.status, 'posted');
      const dec = await this.baseDecimals(tx, b.companyId);

      const idemKey = idempotencyKey ?? (b.idempotencyKey ? `gl:${b.idempotencyKey}` : `gl:expense:${b.id}`);
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const inVAT = await this.resolveAccount(tx, b.companyId, '1230');
        const creditAccountId = b.payFrom === 'supplier'
          ? await this.resolveAccount(tx, b.companyId, '2110')
          : b.bankAccountId!;
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: b.companyId,
          journal_type: 'expense_bill',
          posting_date: b.billDate.toISOString().slice(0, 10),
          description: `Expense bill ${b.number}`,
          source_type: 'expense_bill', source_id: b.id,
          idempotency_key: idemKey,
          lines: [
            ...b.lines.map((l) => ({
              account_id: l.accountId, debit: toDecimal(l.lineTotal), credit: new Decimal(0),
              description: l.description,
            })),
            ...(toDecimal(b.taxTotal).gt(0) ? [{
              account_id: inVAT, debit: toDecimal(b.taxTotal), credit: new Decimal(0),
              description: 'Input VAT',
            }] : []),
            {
              account_id: creditAccountId,
              debit: new Decimal(0), credit: toDecimal(b.total),
              description: b.payFrom === 'supplier' ? 'Accounts payable' : 'Paid from bank/cash',
            },
          ],
        }, actorId, ip);
        journalId = gl.id;
      }

      await tx.expenseBill.update({
        where: { id },
        data: { status: 'posted', journalEntryId: journalId },
      });
      await this.audit(tx, ctx, actorId, 'finance.expense_posted', 'expense_bill', id, { journal_id: journalId }, ip);
      return { expense_bill: await this.expenseBillDto(tx, id), journal_id: journalId };
    });
  }
}

async function tx_scoped_bank_statement(tx: Tx, ctx: OrgContext, id: string) {
  const st = await tx.bankStatement.findUnique({ where: { id } });
  if (!st || st.organizationId !== ctx.organizationId) throw Errors.notFound('Bank statement');
  if (ctx.companyIds && !ctx.companyIds.includes(st.companyId)) throw Errors.forbidden();
  return st;
}

async function tx_scoped_expense_bill(tx: Tx, ctx: OrgContext, id: string) {
  const b = await tx.expenseBill.findUnique({ where: { id }, include: { lines: true } });
  if (!b || b.organizationId !== ctx.organizationId) throw Errors.notFound('Expense bill');
  if (ctx.companyIds && !ctx.companyIds.includes(b.companyId)) throw Errors.forbidden();
  return b;
}
