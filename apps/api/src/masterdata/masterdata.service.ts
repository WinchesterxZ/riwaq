import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/errors';
import { OrgContext } from '../common/request.types';
import { pageMeta } from '../common/pagination';
import { NumberingService } from './numbering';
import { findDuplicateWarnings, DuplicateWarning } from './duplicates';
import {
  ensureStorageDir, isAllowedMime, maxUploadMb, storageDir, storageKeyFor, UploadedFile,
} from './storage';
import {
  parseCsvText, toCsv, requireHeaders, validateCustomerCsvRows, validateSupplierCsvRows,
  validateProductCsvRows, CUSTOMER_CSV_HEADERS, SUPPLIER_CSV_HEADERS, PRODUCT_CSV_HEADERS,
  CsvRowError, ValidatedPartyRow, ValidatedProductRow,
} from './csv';
import type {
  CustomerCreateDto, CustomerUpdateDto, SupplierCreateDto, SupplierUpdateDto,
  ContactCreateDto, AddressCreateDto, PaymentTermCreateDto, PaymentTermUpdateDto,
  ProductCategoryCreateDto, ProductCategoryUpdateDto, UnitOfMeasureCreateDto,
  UnitOfMeasureUpdateDto, UnitConversionCreateDto, ProductCreateDto, ProductUpdateDto,
  ProductVariantCreateDto, ProductVariantUpdateDto, DocumentSequenceCreateDto,
  DocumentSequenceUpdateDto,
} from '@atlas-erp/contracts';
import { createReadStream, existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type PartyKind = 'customer' | 'supplier';
/** Attachment owners are exactly the vocabulary the web client sends. */
type AttachmentOwner = 'customer' | 'supplier' | 'product';

/**
 * Structural view of the customer/supplier Prisma delegates so the shared
 * party helpers don't duplicate every method per kind.
 */
interface PartyDelegate {
  count(args: { where: unknown }): Promise<number>;
  findMany(args: unknown): Promise<any[]>;
  findUnique(args: unknown): Promise<any>;
  create(args: unknown): Promise<any>;
  update(args: unknown): Promise<any>;
}

@Injectable()
export class MasterdataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------- shared helpers ----------

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  private partyDelegate(kind: PartyKind): PartyDelegate {
    return (kind === 'customer' ? this.prisma.customer : this.prisma.supplier) as unknown as PartyDelegate;
  }

  private async companyInScope(ctx: OrgContext, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, organizationId: ctx.organizationId },
    });
    if (!company) throw Errors.notFound('Company');
    this.assertCompanyInScope(ctx, companyId);
    return company;
  }

  /** Fetch a customer/supplier/product by id; 404 unknown, 403 other-org, 403 out-of-scope company. */
  private async ownerInScope(ctx: OrgContext, ownerType: AttachmentOwner, ownerId: string) {
    let entity: { id: string; companyId: string } | null = null;
    if (ownerType === 'customer') {
      entity = await this.prisma.customer.findUnique({
        where: { id: ownerId },
        select: { id: true, companyId: true },
      });
    } else if (ownerType === 'supplier') {
      entity = await this.prisma.supplier.findUnique({
        where: { id: ownerId },
        select: { id: true, companyId: true },
      });
    } else {
      entity = await this.prisma.product.findUnique({
        where: { id: ownerId },
        select: { id: true, companyId: true },
      });
    }
    if (!entity) throw Errors.ownerNotFound(ownerType);
    const company = await this.prisma.company.findUnique({
      where: { id: entity.companyId },
      select: { organizationId: true },
    });
    if (!company || company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, entity.companyId);
    return { id: entity.id, companyId: entity.companyId };
  }

  /** Owner-view permission needed to download/list attachments of an owner entity. */
  private assertOwnerViewPermission(ctx: OrgContext, ownerType: AttachmentOwner) {
    if (!ctx.permissions.includes(`${ownerType}:view`)) throw Errors.forbidden();
  }

  private async validatePaymentTerm(companyId: string, paymentTermId: string | null | undefined) {
    if (!paymentTermId) return;
    const term = await this.prisma.paymentTerm.findUnique({ where: { id: paymentTermId } });
    if (!term || term.companyId !== companyId) throw Errors.notFound('Payment term');
  }

  private async validateSalesperson(ctx: OrgContext, salespersonId: string | null | undefined) {
    if (!salespersonId) return;
    const membership = await this.prisma.membership.findFirst({
      where: { userId: salespersonId, organizationId: ctx.organizationId, status: 'active' },
      select: { id: true },
    });
    if (!membership) throw Errors.notFound('Salesperson');
  }

  /**
   * Validate a ledger account reference for product account mapping:
   * same company, active, postable (summary accounts cannot be mapped).
   */
  private async validateProductAccount(companyId: string, accountId: string, label: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) {
      throw Errors.productAccountInvalid(
        `${label} must reference an account of the same company.`,
        `${label} يجب أن يشير إلى حساب من نفس الشركة.`,
      );
    }
    if (!account.isActive) throw Errors.glAccountInactive(account.code);
    if (!account.isPostable) throw Errors.accountNotPostable(account.code);
  }

  private async productReferences(dto: {
    company_id: string; category_id?: string | null; base_uom_id?: string;
    tax_code_id?: string | null; preferred_supplier_id?: string | null;
    inventory_account_id?: string | null; cogs_account_id?: string | null;
    revenue_account_id?: string | null;
  }) {
    const companyId = dto.company_id;
    if (dto.category_id) {
      const cat = await this.prisma.productCategory.findUnique({ where: { id: dto.category_id } });
      if (!cat || cat.companyId !== companyId) throw Errors.notFound('Product category');
    }
    if (dto.base_uom_id) {
      const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.base_uom_id } });
      if (!uom) throw Errors.notFound('Unit of measure');
    }
    if (dto.tax_code_id) {
      const tax = await this.prisma.taxCode.findUnique({ where: { id: dto.tax_code_id } });
      if (!tax || tax.companyId !== companyId) throw Errors.notFound('Tax code');
    }
    if (dto.preferred_supplier_id) {
      const sup = await this.prisma.supplier.findUnique({ where: { id: dto.preferred_supplier_id } });
      if (!sup || sup.companyId !== companyId) throw Errors.notFound('Supplier');
    }
    if (dto.inventory_account_id) await this.validateProductAccount(companyId, dto.inventory_account_id, 'inventory_account_id');
    if (dto.cogs_account_id) await this.validateProductAccount(companyId, dto.cogs_account_id, 'cogs_account_id');
    if (dto.revenue_account_id) await this.validateProductAccount(companyId, dto.revenue_account_id, 'revenue_account_id');
  }

  private throwIfSkuConflict(e: unknown, sku: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.target as string[] | undefined) ?? [];
      if (target.some((t) => t.includes('sku'))) throw Errors.duplicateSku(sku);
      throw Errors.duplicate('field');
    }
    throw e;
  }

  // ---------- DTO mappers (API never leaks Prisma camelCase) ----------

  private partyDto(p: {
    id: string; companyId: string; number: string; nameAr: string; nameEn: string;
    kind: string; taxId: string | null; paymentTermId: string | null;
    creditLimit: unknown; status: string; salespersonId: string | null;
    createdAt: Date; updatedAt: Date;
    paymentTerm?: { id: string; nameAr: string; nameEn: string; days: number } | null;
    salesperson?: { id: string; name: string; email: string } | null;
    defaultCurrency?: string;
  }) {
    return {
      id: p.id,
      company_id: p.companyId,
      number: p.number,
      name_ar: p.nameAr,
      name_en: p.nameEn,
      kind: p.kind,
      tax_id: p.taxId,
      payment_term_id: p.paymentTermId,
      payment_term: p.paymentTerm ? {
        id: p.paymentTerm.id, name_ar: p.paymentTerm.nameAr,
        name_en: p.paymentTerm.nameEn, days: p.paymentTerm.days,
      } : null,
      credit_limit: p.creditLimit == null ? null : String(p.creditLimit),
      status: p.status,
      salesperson_id: p.salespersonId,
      salesperson: p.salesperson ? {
        id: p.salesperson.id, name: p.salesperson.name, email: p.salesperson.email,
      } : null,
      ...(p.defaultCurrency !== undefined ? { default_currency: p.defaultCurrency } : {}),
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  private contactDto(c: { id: string; ownerType: string; ownerId: string; name: string; role: string | null; phone: string | null; email: string | null; isPrimary: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: c.id, owner_type: c.ownerType, owner_id: c.ownerId, name: c.name,
      role: c.role, phone: c.phone, email: c.email, is_primary: c.isPrimary,
      created_at: c.createdAt, updated_at: c.updatedAt,
    };
  }

  private addressDto(a: { id: string; ownerType: string; ownerId: string; label: string | null; line1: string; line2: string | null; city: string | null; country: string | null; isBilling: boolean; isShipping: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: a.id, owner_type: a.ownerType, owner_id: a.ownerId, label: a.label,
      line1: a.line1, line2: a.line2, city: a.city, country: a.country,
      is_billing: a.isBilling, is_shipping: a.isShipping,
      created_at: a.createdAt, updated_at: a.updatedAt,
    };
  }

  private paymentTermDto(t: { id: string; companyId: string; nameAr: string; nameEn: string; days: number; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: t.id, company_id: t.companyId, name_ar: t.nameAr, name_en: t.nameEn,
      days: t.days, is_active: t.isActive, created_at: t.createdAt, updated_at: t.updatedAt,
    };
  }

  private categoryDto(c: { id: string; companyId: string; nameAr: string; nameEn: string; parentId: string | null; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: c.id, company_id: c.companyId, name_ar: c.nameAr, name_en: c.nameEn,
      parent_id: c.parentId, is_active: c.isActive,
      created_at: c.createdAt, updated_at: c.updatedAt,
    };
  }

  private unitDto(u: { id: string; code: string; nameAr: string; nameEn: string; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: u.id, code: u.code, name_ar: u.nameAr, name_en: u.nameEn,
      is_active: u.isActive, created_at: u.createdAt, updated_at: u.updatedAt,
    };
  }

  private conversionDto(c: { id: string; factor: unknown; createdAt: Date; from: { id: string; code: string; nameAr: string; nameEn: string }; to: { id: string; code: string; nameAr: string; nameEn: string } }) {
    const unit = (u: { id: string; code: string; nameAr: string; nameEn: string }) =>
      ({ id: u.id, code: u.code, name_ar: u.nameAr, name_en: u.nameEn });
    return {
      id: c.id, from_uom: unit(c.from), to_uom: unit(c.to),
      factor: String(c.factor), created_at: c.createdAt,
    };
  }

  private productDto(p: {
    id: string; companyId: string; sku: string; nameAr: string; nameEn: string; type: string;
    categoryId: string | null; baseUomId: string; purchasePrice: unknown; salesPrice: unknown;
    taxCodeId: string | null; reorderLevel: unknown; preferredSupplierId: string | null;
    inventoryAccountId: string | null; cogsAccountId: string | null; revenueAccountId: string | null;
    isActive: boolean; createdAt: Date; updatedAt: Date;
    category?: { id: string; nameAr: string; nameEn: string } | null;
    baseUom?: { id: string; code: string; nameAr: string; nameEn: string };
    taxCode?: { id: string; nameAr: string; nameEn: string; rate: unknown; type: string } | null;
    preferredSupplier?: { id: string; number: string; nameAr: string; nameEn: string } | null;
    inventoryAccount?: { id: string; code: string; nameAr: string; nameEn: string } | null;
    cogsAccount?: { id: string; code: string; nameAr: string; nameEn: string } | null;
    revenueAccount?: { id: string; code: string; nameAr: string; nameEn: string } | null;
  }) {
    const acct = (a?: { id: string; code: string; nameAr: string; nameEn: string } | null) =>
      a ? { id: a.id, code: a.code, name_ar: a.nameAr, name_en: a.nameEn } : null;
    return {
      id: p.id, company_id: p.companyId, sku: p.sku,
      name_ar: p.nameAr, name_en: p.nameEn, type: p.type,
      category_id: p.categoryId,
      category: p.category ? { id: p.category.id, name_ar: p.category.nameAr, name_en: p.category.nameEn } : null,
      base_uom_id: p.baseUomId,
      base_uom: p.baseUom ? { id: p.baseUom.id, code: p.baseUom.code, name_ar: p.baseUom.nameAr, name_en: p.baseUom.nameEn } : null,
      purchase_price: p.purchasePrice == null ? null : String(p.purchasePrice),
      sales_price: p.salesPrice == null ? null : String(p.salesPrice),
      tax_code_id: p.taxCodeId,
      tax_code: p.taxCode ? {
        id: p.taxCode.id, name_ar: p.taxCode.nameAr, name_en: p.taxCode.nameEn,
        rate: String(p.taxCode.rate), type: p.taxCode.type,
      } : null,
      reorder_level: p.reorderLevel == null ? null : String(p.reorderLevel),
      preferred_supplier_id: p.preferredSupplierId,
      preferred_supplier: p.preferredSupplier ? {
        id: p.preferredSupplier.id, number: p.preferredSupplier.number,
        name_ar: p.preferredSupplier.nameAr, name_en: p.preferredSupplier.nameEn,
      } : null,
      inventory_account_id: p.inventoryAccountId, inventory_account: acct(p.inventoryAccount),
      cogs_account_id: p.cogsAccountId, cogs_account: acct(p.cogsAccount),
      revenue_account_id: p.revenueAccountId, revenue_account: acct(p.revenueAccount),
      is_active: p.isActive, created_at: p.createdAt, updated_at: p.updatedAt,
    };
  }

  private variantDto(v: { id: string; companyId: string; productId: string; sku: string; attributes: unknown; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: v.id, company_id: v.companyId, product_id: v.productId, sku: v.sku,
      attributes: v.attributes, is_active: v.isActive,
      created_at: v.createdAt, updated_at: v.updatedAt,
    };
  }

  private sequenceDto(s: { id: string; companyId: string; documentType: string; prefix: string; nextNumber: number; resetPolicy: string; lastResetYear: number | null }) {
    return {
      id: s.id, company_id: s.companyId, document_type: s.documentType,
      prefix: s.prefix, next_number: s.nextNumber,
      reset_policy: s.resetPolicy, last_reset_year: s.lastResetYear,
    };
  }

  private attachmentDto(a: { id: string; ownerType: string; ownerId: string; fileKey: string; fileName: string; mime: string; size: number; uploadedById: string; createdAt: Date }) {
    return {
      id: a.id, owner_type: a.ownerType, owner_id: a.ownerId,
      file_key: a.fileKey, file_name: a.fileName, mime: a.mime, size: a.size,
      uploaded_by_id: a.uploadedById, created_at: a.createdAt,
    };
  }

  private productInclude() {
    const acct = { select: { id: true, code: true, nameAr: true, nameEn: true } };
    return {
      category: { select: { id: true, nameAr: true, nameEn: true } },
      baseUom: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      taxCode: { select: { id: true, nameAr: true, nameEn: true, rate: true, type: true } },
      preferredSupplier: { select: { id: true, number: true, nameAr: true, nameEn: true } },
      inventoryAccount: acct,
      cogsAccount: acct,
      revenueAccount: acct,
    };
  }

  private partyInclude() {
    return {
      paymentTerm: { select: { id: true, nameAr: true, nameEn: true, days: true } },
      salesperson: { select: { id: true, name: true, email: true } },
    };
  }

  // ---------- customers & suppliers ----------

  async listParties(
    ctx: OrgContext, kind: PartyKind,
    q: { company_id: string; search?: string; status?: string; page: number; per_page: number },
  ) {
    await this.companyInScope(ctx, q.company_id);
    const where: Prisma.CustomerWhereInput = {
      companyId: q.company_id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? {
        OR: [
          { number: { contains: q.search, mode: 'insensitive' } },
          { nameAr: { contains: q.search, mode: 'insensitive' } },
          { nameEn: { contains: q.search, mode: 'insensitive' } },
          { taxId: { contains: q.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const delegate = this.partyDelegate(kind);
    const [total, rows] = await Promise.all([
      delegate.count({ where }),
      delegate.findMany({
        where,
        include: this.partyInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return { data: (rows as any[]).map((r) => this.partyDto(r)), meta: pageMeta(total, q.page, q.per_page) };
  }

  async createParty(
    ctx: OrgContext, kind: PartyKind, dto: CustomerCreateDto | SupplierCreateDto,
    actorId: string, ip?: string,
  ): Promise<{ data: unknown; warnings: DuplicateWarning[] }> {
    const company = await this.companyInScope(ctx, dto.company_id);
    await this.validatePaymentTerm(company.id, dto.payment_term_id);
    await this.validateSalesperson(ctx, dto.salesperson_id);

    const base = {
      companyId: company.id,
      nameAr: dto.name_ar,
      nameEn: dto.name_en,
      kind: dto.kind,
      taxId: dto.tax_id?.trim() || null,
      paymentTermId: dto.payment_term_id ?? null,
      creditLimit: dto.credit_limit ?? null,
      salespersonId: dto.salesperson_id ?? null,
      createdById: actorId,
    };
    const data = kind === 'supplier'
      ? { ...base, defaultCurrency: (dto as SupplierCreateDto).default_currency?.toUpperCase() || company.baseCurrency }
      : base;

    if (kind === 'supplier') {
      const cur = await this.prisma.currency.findUnique({
        where: { code: (data as { defaultCurrency: string }).defaultCurrency },
      });
      if (!cur) throw Errors.notFound('Currency');
    }

    const number = await this.numbering.nextNumber(company.id, kind);

    // Duplicate detection: same company + (same tax_id OR same name, case-insensitive).
    const candidates = await this.partyDelegate(kind).findMany({
      where: {
        companyId: company.id,
        OR: [
          ...(data.taxId ? [{ taxId: data.taxId }] : []),
          { nameAr: { equals: data.nameAr, mode: 'insensitive' } },
          { nameEn: { equals: data.nameEn, mode: 'insensitive' } },
        ],
      },
      select: { taxId: true, nameAr: true, nameEn: true },
      take: 5,
    });
    const warnings = findDuplicateWarnings(
      { taxId: data.taxId, nameAr: data.nameAr, nameEn: data.nameEn },
      candidates,
    );

    const created = await this.partyDelegate(kind).create({
      data: { ...data, number },
      include: this.partyInclude(),
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${kind}.created`,
      entityType: kind, entityId: created.id, ip,
    });
    return { data: this.partyDto(created), warnings };
  }

  async getParty(ctx: OrgContext, kind: PartyKind, id: string) {
    const row: any = await this.partyDelegate(kind).findUnique({
      where: { id },
      include: { ...this.partyInclude(), company: { select: { organizationId: true } } },
    });
    if (!row || row.company.organizationId !== ctx.organizationId) throw Errors.notFound(kind === 'customer' ? 'Customer' : 'Supplier');
    this.assertCompanyInScope(ctx, row.companyId);
    return this.partyDto(row);
  }

  async updateParty(ctx: OrgContext, kind: PartyKind, id: string, dto: CustomerUpdateDto | SupplierUpdateDto, actorId: string, ip?: string) {
    const existing = await this.getPartyRaw(ctx, kind, id);
    await this.validatePaymentTerm(existing.companyId, (dto as { payment_term_id?: string | null }).payment_term_id);
    await this.validateSalesperson(ctx, (dto as { salesperson_id?: string | null }).salesperson_id);
    const delegate = this.partyDelegate(kind);
    const data: Record<string, unknown> = {
      ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
      ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.tax_id !== undefined ? { taxId: dto.tax_id?.trim() || null } : {}),
      ...((dto as { payment_term_id?: string | null }).payment_term_id !== undefined ? { paymentTermId: (dto as { payment_term_id: string | null }).payment_term_id } : {}),
      ...(dto.credit_limit !== undefined ? { creditLimit: dto.credit_limit } : {}),
      ...((dto as { salesperson_id?: string | null }).salesperson_id !== undefined ? { salespersonId: (dto as { salesperson_id: string | null }).salesperson_id } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
    if (kind === 'supplier' && (dto as SupplierUpdateDto).default_currency !== undefined) {
      const cur = ((dto as SupplierUpdateDto).default_currency ?? '').toUpperCase() || null;
      if (cur) {
        const exists = await this.prisma.currency.findUnique({ where: { code: cur } });
        if (!exists) throw Errors.notFound('Currency');
      }
      data.defaultCurrency = cur;
    }
    const updated = await delegate.update({
      where: { id },
      data,
      include: this.partyInclude(),
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${kind}.updated`,
      entityType: kind, entityId: id, ip,
    });
    return this.partyDto(updated);
  }

  private async getPartyRaw(ctx: OrgContext, kind: PartyKind, id: string) {
    const row = await this.partyDelegate(kind).findUnique({
      where: { id },
      include: { company: { select: { organizationId: true } } },
    });
    if (!row || row.company.organizationId !== ctx.organizationId) {
      throw Errors.notFound(kind === 'customer' ? 'Customer' : 'Supplier');
    }
    this.assertCompanyInScope(ctx, row.companyId);
    return row;
  }

  /**
   * Soft deactivation only. Deactivating a party that already has documents is
   * allowed — history survives; Restrict FKs stay intact, no cascades.
   */
  async deactivateParty(ctx: OrgContext, kind: PartyKind, id: string, actorId: string, ip?: string) {
    await this.getPartyRaw(ctx, kind, id);
    const updated = await this.partyDelegate(kind).update({
      where: { id },
      data: { status: 'inactive' },
      include: this.partyInclude(),
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${kind}.deactivated`,
      entityType: kind, entityId: id, ip,
    });
    return this.partyDto(updated);
  }

  // ---------- contacts & addresses ----------

  private async partySubOwner(ctx: OrgContext, ownerType: PartyKind, ownerId: string) {
    const row = await this.partyDelegate(ownerType).findUnique({
      where: { id: ownerId },
      select: { id: true, companyId: true, company: { select: { organizationId: true } } },
    });
    if (!row || row.company.organizationId !== ctx.organizationId) {
      throw Errors.notFound(ownerType === 'customer' ? 'Customer' : 'Supplier');
    }
    this.assertCompanyInScope(ctx, row.companyId);
    return row;
  }

  async listContacts(ctx: OrgContext, ownerType: PartyKind, ownerId: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const rows = await this.prisma.contact.findMany({
      where: { ownerType, ownerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.contactDto(r));
  }

  async createContact(ctx: OrgContext, ownerType: PartyKind, ownerId: string, dto: ContactCreateDto, actorId: string, ip?: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const created = await this.prisma.contact.create({
      data: {
        ownerType, ownerId,
        name: dto.name,
        role: dto.role ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        isPrimary: dto.is_primary,
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${ownerType}.contact_created`,
      entityType: 'contact', entityId: created.id, ip,
    });
    return this.contactDto(created);
  }

  async listAddresses(ctx: OrgContext, ownerType: PartyKind, ownerId: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const rows = await this.prisma.address.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.addressDto(r));
  }

  async createAddress(ctx: OrgContext, ownerType: PartyKind, ownerId: string, dto: AddressCreateDto, actorId: string, ip?: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const created = await this.prisma.address.create({
      data: {
        ownerType, ownerId,
        label: dto.label ?? null,
        line1: dto.line1,
        line2: dto.line2 ?? null,
        city: dto.city ?? null,
        country: dto.country ?? null,
        isBilling: dto.is_billing,
        isShipping: dto.is_shipping,
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${ownerType}.address_created`,
      entityType: 'address', entityId: created.id, ip,
    });
    return this.addressDto(created);
  }

  // ---------- payment terms ----------

  async listPaymentTerms(ctx: OrgContext, q: { company_id: string; is_active?: boolean; page: number; per_page: number }) {
    await this.companyInScope(ctx, q.company_id);
    const where = {
      companyId: q.company_id,
      ...(q.is_active !== undefined ? { isActive: q.is_active } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.paymentTerm.count({ where }),
      this.prisma.paymentTerm.findMany({
        where,
        orderBy: { days: 'asc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return { data: rows.map((r) => this.paymentTermDto(r)), meta: pageMeta(total, q.page, q.per_page) };
  }

  async createPaymentTerm(ctx: OrgContext, dto: PaymentTermCreateDto, actorId: string, ip?: string) {
    await this.companyInScope(ctx, dto.company_id);
    const created = await this.prisma.paymentTerm.create({
      data: {
        companyId: dto.company_id,
        nameAr: dto.name_ar,
        nameEn: dto.name_en,
        days: dto.days,
        isActive: dto.is_active,
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'payment_term.created',
      entityType: 'payment_term', entityId: created.id, ip,
    });
    return this.paymentTermDto(created);
  }

  private async paymentTermInScope(ctx: OrgContext, id: string) {
    const term = await this.prisma.paymentTerm.findUnique({
      where: { id },
      include: { company: { select: { organizationId: true } } },
    });
    if (!term || term.company.organizationId !== ctx.organizationId) throw Errors.notFound('Payment term');
    this.assertCompanyInScope(ctx, term.companyId);
    return term;
  }

  async updatePaymentTerm(ctx: OrgContext, id: string, dto: PaymentTermUpdateDto, actorId: string, ip?: string) {
    await this.paymentTermInScope(ctx, id);
    const updated = await this.prisma.paymentTerm.update({
      where: { id },
      data: {
        ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
        ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
        ...(dto.days !== undefined ? { days: dto.days } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'payment_term.updated',
      entityType: 'payment_term', entityId: id, ip,
    });
    return this.paymentTermDto(updated);
  }

  async deactivatePaymentTerm(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    await this.paymentTermInScope(ctx, id);
    const updated = await this.prisma.paymentTerm.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'payment_term.deactivated',
      entityType: 'payment_term', entityId: id, ip,
    });
    return this.paymentTermDto(updated);
  }

  // ---------- product categories ----------

  async listCategories(ctx: OrgContext, companyId: string, isActive?: boolean) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.prisma.productCategory.findMany({
      where: {
        companyId,
        ...(isActive !== undefined ? { isActive } : {}),
      },
      orderBy: [{ nameEn: 'asc' }],
    });
    // Build a nested tree from the flat list.
    const byId = new Map(rows.map((r) => [r.id, { ...this.categoryDto(r), children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId && byId.has(r.parentId)) {
        (byId.get(r.parentId)!.children as unknown[]).push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async createCategory(ctx: OrgContext, dto: ProductCategoryCreateDto, actorId: string, ip?: string) {
    await this.companyInScope(ctx, dto.company_id);
    if (dto.parent_id) {
      const parent = await this.prisma.productCategory.findUnique({ where: { id: dto.parent_id } });
      if (!parent || parent.companyId !== dto.company_id) throw Errors.notFound('Parent category');
    }
    const created = await this.prisma.productCategory.create({
      data: {
        companyId: dto.company_id,
        nameAr: dto.name_ar,
        nameEn: dto.name_en,
        parentId: dto.parent_id ?? null,
        isActive: dto.is_active,
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'product_category.created',
      entityType: 'product_category', entityId: created.id, ip,
    });
    return this.categoryDto(created);
  }

  private async categoryInScope(ctx: OrgContext, id: string) {
    const cat = await this.prisma.productCategory.findUnique({
      where: { id },
      include: { company: { select: { organizationId: true } } },
    });
    if (!cat || cat.company.organizationId !== ctx.organizationId) throw Errors.notFound('Product category');
    this.assertCompanyInScope(ctx, cat.companyId);
    return cat;
  }

  async updateCategory(ctx: OrgContext, id: string, dto: ProductCategoryUpdateDto, actorId: string, ip?: string) {
    const cat = await this.categoryInScope(ctx, id);
    if (dto.parent_id !== undefined) {
      if (dto.parent_id === id) throw Errors.categoryParentCycle();
      if (dto.parent_id) {
        const parent = await this.prisma.productCategory.findUnique({ where: { id: dto.parent_id } });
        if (!parent || parent.companyId !== cat.companyId) throw Errors.notFound('Parent category');
        // Cycle check: walk up from the new parent; must never reach this category.
        let cursor: string | null = parent.parentId;
        const seen = new Set<string>([parent.id]);
        while (cursor) {
          if (cursor === id || seen.has(cursor)) throw Errors.categoryParentCycle();
          seen.add(cursor);
          const next = await this.prisma.productCategory.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          cursor = next?.parentId ?? null;
        }
      }
    }
    const updated = await this.prisma.productCategory.update({
      where: { id },
      data: {
        ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
        ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
        ...(dto.parent_id !== undefined ? { parentId: dto.parent_id } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'product_category.updated',
      entityType: 'product_category', entityId: id, ip,
    });
    return this.categoryDto(updated);
  }

  async deactivateCategory(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    await this.categoryInScope(ctx, id);
    const updated = await this.prisma.productCategory.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'product_category.deactivated',
      entityType: 'product_category', entityId: id, ip,
    });
    return this.categoryDto(updated);
  }

  // ---------- units of measure ----------

  async listUnits() {
    const rows = await this.prisma.unitOfMeasure.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => this.unitDto(r));
  }

  async createUnit(dto: UnitOfMeasureCreateDto, ctx: OrgContext, actorId: string, ip?: string) {
    try {
      const created = await this.prisma.unitOfMeasure.create({
        data: {
          code: dto.code.toUpperCase(),
          nameAr: dto.name_ar,
          nameEn: dto.name_en,
          isActive: dto.is_active,
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'unit.created',
        entityType: 'unit', entityId: created.id, ip,
      });
      return this.unitDto(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('code');
      }
      throw e;
    }
  }

  async updateUnit(id: string, dto: UnitOfMeasureUpdateDto, ctx: OrgContext, actorId: string, ip?: string) {
    const unit = await this.prisma.unitOfMeasure.findUnique({ where: { id } });
    if (!unit) throw Errors.notFound('Unit of measure');
    const updated = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
        ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'unit.updated',
      entityType: 'unit', entityId: id, ip,
    });
    return this.unitDto(updated);
  }

  async listConversions() {
    const rows = await this.prisma.unitConversion.findMany({
      include: {
        from: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        to: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.conversionDto(r));
  }

  async createConversion(dto: UnitConversionCreateDto, ctx: OrgContext, actorId: string, ip?: string) {
    const from = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.from_uom_id } });
    const to = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.to_uom_id } });
    if (!from || !to) throw Errors.notFound('Unit of measure');
    try {
      const created = await this.prisma.unitConversion.create({
        data: { fromUomId: from.id, toUomId: to.id, factor: dto.factor },
        include: {
          from: { select: { id: true, code: true, nameAr: true, nameEn: true } },
          to: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'unit.conversion_created',
        entityType: 'unit_conversion', entityId: created.id, ip,
      });
      return this.conversionDto(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('unit conversion');
      }
      throw e;
    }
  }

  async deleteConversion(id: string, ctx: OrgContext, actorId: string, ip?: string) {
    const conv = await this.prisma.unitConversion.findUnique({ where: { id } });
    if (!conv) throw Errors.notFound('Unit conversion');
    await this.prisma.unitConversion.delete({ where: { id } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'unit.conversion_deleted',
      entityType: 'unit_conversion', entityId: id, ip,
    });
    return { deleted: true, id };
  }

  async deleteContact(ctx: OrgContext, ownerType: PartyKind, ownerId: string, contactId: string, actorId: string, ip?: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.ownerType !== ownerType || contact.ownerId !== ownerId) {
      throw Errors.notFound('Contact');
    }
    await this.prisma.contact.delete({ where: { id: contactId } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${ownerType}.contact_deleted`,
      entityType: 'contact', entityId: contactId, ip,
    });
    return { deleted: true, id: contactId };
  }

  async deleteAddress(ctx: OrgContext, ownerType: PartyKind, ownerId: string, addressId: string, actorId: string, ip?: string) {
    await this.partySubOwner(ctx, ownerType, ownerId);
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.ownerType !== ownerType || address.ownerId !== ownerId) {
      throw Errors.notFound('Address');
    }
    await this.prisma.address.delete({ where: { id: addressId } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${ownerType}.address_deleted`,
      entityType: 'address', entityId: addressId, ip,
    });
    return { deleted: true, id: addressId };
  }

  // ---------- products ----------

  async listProducts(
    ctx: OrgContext,
    q: { company_id: string; search?: string; type?: string; category_id?: string; status?: string; sort: string; page: number; per_page: number },
  ) {
    await this.companyInScope(ctx, q.company_id);
    const where: Prisma.ProductWhereInput = {
      companyId: q.company_id,
      ...(q.type ? { type: q.type } : {}),
      ...(q.category_id ? { categoryId: q.category_id } : {}),
      ...(q.status === 'active' ? { isActive: true } : q.status === 'inactive' ? { isActive: false } : {}),
      ...(q.search ? {
        OR: [
          { sku: { contains: q.search, mode: 'insensitive' } },
          { nameAr: { contains: q.search, mode: 'insensitive' } },
          { nameEn: { contains: q.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      name: { nameEn: 'asc' },
      '-name': { nameEn: 'desc' },
      sku: { sku: 'asc' },
      '-sku': { sku: 'desc' },
      created_desc: { createdAt: 'desc' },
      created_asc: { createdAt: 'asc' },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: this.productInclude(),
        orderBy: sortMap[q.sort] ?? { createdAt: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return { data: rows.map((r) => this.productDto(r)), meta: pageMeta(total, q.page, q.per_page) };
  }

  async createProduct(ctx: OrgContext, dto: ProductCreateDto, actorId: string, ip?: string) {
    await this.companyInScope(ctx, dto.company_id);
    await this.productReferences(dto);
    // NOTE (Phase 5 inventory): stock movements must be rejected for products
    // with type='service'. The flag is stored here; the inventory module will
    // enforce it — this phase does not build inventory.
    try {
      const created = await this.prisma.product.create({
        data: {
          companyId: dto.company_id,
          sku: dto.sku.trim(),
          nameAr: dto.name_ar,
          nameEn: dto.name_en,
          type: dto.type,
          categoryId: dto.category_id ?? null,
          baseUomId: dto.base_uom_id,
          purchasePrice: dto.purchase_price ?? null,
          salesPrice: dto.sales_price ?? null,
          taxCodeId: dto.tax_code_id ?? null,
          reorderLevel: dto.reorder_level ?? null,
          preferredSupplierId: dto.preferred_supplier_id ?? null,
          inventoryAccountId: dto.inventory_account_id ?? null,
          cogsAccountId: dto.cogs_account_id ?? null,
          revenueAccountId: dto.revenue_account_id ?? null,
          isActive: dto.is_active,
          createdById: actorId,
        },
        include: this.productInclude(),
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'product.created',
        entityType: 'product', entityId: created.id, ip,
      });
      return this.productDto(created);
    } catch (e) {
      this.throwIfSkuConflict(e, dto.sku.trim());
      throw e;
    }
  }

  private async productInScope(ctx: OrgContext, id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { ...this.productInclude(), company: { select: { organizationId: true } } },
    });
    if (!product || (product as unknown as { company: { organizationId: string } }).company.organizationId !== ctx.organizationId) {
      throw Errors.notFound('Product');
    }
    this.assertCompanyInScope(ctx, product.companyId);
    return product;
  }

  async getProduct(ctx: OrgContext, id: string) {
    return this.productDto(await this.productInScope(ctx, id));
  }

  async updateProduct(ctx: OrgContext, id: string, dto: ProductUpdateDto, actorId: string, ip?: string) {
    const product = await this.productInScope(ctx, id);
    const refs = {
      company_id: product.companyId,
      ...(dto.category_id !== undefined ? { category_id: dto.category_id } : {}),
      ...(dto.base_uom_id !== undefined ? { base_uom_id: dto.base_uom_id } : {}),
      ...(dto.tax_code_id !== undefined ? { tax_code_id: dto.tax_code_id } : {}),
      ...(dto.preferred_supplier_id !== undefined ? { preferred_supplier_id: dto.preferred_supplier_id } : {}),
      ...(dto.inventory_account_id !== undefined ? { inventory_account_id: dto.inventory_account_id } : {}),
      ...(dto.cogs_account_id !== undefined ? { cogs_account_id: dto.cogs_account_id } : {}),
      ...(dto.revenue_account_id !== undefined ? { revenue_account_id: dto.revenue_account_id } : {}),
    };
    await this.productReferences(refs);
    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
          ...(dto.name_ar !== undefined ? { nameAr: dto.name_ar } : {}),
          ...(dto.name_en !== undefined ? { nameEn: dto.name_en } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.category_id !== undefined ? { categoryId: dto.category_id } : {}),
          ...(dto.base_uom_id !== undefined ? { baseUomId: dto.base_uom_id } : {}),
          ...(dto.purchase_price !== undefined ? { purchasePrice: dto.purchase_price } : {}),
          ...(dto.sales_price !== undefined ? { salesPrice: dto.sales_price } : {}),
          ...(dto.tax_code_id !== undefined ? { taxCodeId: dto.tax_code_id } : {}),
          ...(dto.reorder_level !== undefined ? { reorderLevel: dto.reorder_level } : {}),
          ...(dto.preferred_supplier_id !== undefined ? { preferredSupplierId: dto.preferred_supplier_id } : {}),
          ...(dto.inventory_account_id !== undefined ? { inventoryAccountId: dto.inventory_account_id } : {}),
          ...(dto.cogs_account_id !== undefined ? { cogsAccountId: dto.cogs_account_id } : {}),
          ...(dto.revenue_account_id !== undefined ? { revenueAccountId: dto.revenue_account_id } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        },
        include: this.productInclude(),
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'product.updated',
        entityType: 'product', entityId: id, ip,
      });
      return this.productDto(updated);
    } catch (e) {
      this.throwIfSkuConflict(e, (dto.sku ?? product.sku).trim());
      throw e;
    }
  }

  async deactivateProduct(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    await this.productInScope(ctx, id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
      include: this.productInclude(),
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'product.deactivated',
      entityType: 'product', entityId: id, ip,
    });
    return this.productDto(updated);
  }

  // ---------- product variants ----------

  async listVariants(ctx: OrgContext, productId: string) {
    const product = await this.productInScope(ctx, productId);
    const rows = await this.prisma.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.variantDto(r));
  }

  async createVariant(ctx: OrgContext, productId: string, dto: ProductVariantCreateDto, actorId: string, ip?: string) {
    const product = await this.productInScope(ctx, productId);
    try {
      const created = await this.prisma.productVariant.create({
        data: {
          companyId: product.companyId,
          productId: product.id,
          sku: dto.sku.trim(),
          attributes: dto.attributes as Prisma.InputJsonValue,
          isActive: dto.is_active,
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'product.variant_created',
        entityType: 'product_variant', entityId: created.id, ip,
      });
      return this.variantDto(created);
    } catch (e) {
      this.throwIfSkuConflict(e, dto.sku.trim());
      throw e;
    }
  }

  private async variantInScope(ctx: OrgContext, productId: string, variantId: string) {
    const product = await this.productInScope(ctx, productId);
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.productId !== product.id) throw Errors.notFound('Product variant');
    return variant;
  }

  async updateVariant(ctx: OrgContext, productId: string, variantId: string, dto: ProductVariantUpdateDto, actorId: string, ip?: string) {
    const variant = await this.variantInScope(ctx, productId, variantId);
    try {
      const updated = await this.prisma.productVariant.update({
        where: { id: variant.id },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
          ...(dto.attributes !== undefined ? { attributes: dto.attributes as Prisma.InputJsonValue } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'product.variant_updated',
        entityType: 'product_variant', entityId: variant.id, ip,
      });
      return this.variantDto(updated);
    } catch (e) {
      this.throwIfSkuConflict(e, (dto.sku ?? variant.sku).trim());
      throw e;
    }
  }

  async deleteVariant(ctx: OrgContext, productId: string, variantId: string, actorId: string, ip?: string) {
    const variant = await this.variantInScope(ctx, productId, variantId);
    await this.prisma.productVariant.delete({ where: { id: variant.id } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'product.variant_deleted',
      entityType: 'product_variant', entityId: variant.id, ip,
    });
    return { deleted: true, id: variant.id };
  }

  // ---------- document sequences ----------

  async listSequences(ctx: OrgContext, q: { company_id: string; document_type?: string }) {
    await this.companyInScope(ctx, q.company_id);
    const rows = await this.prisma.documentSequence.findMany({
      where: {
        companyId: q.company_id,
        ...(q.document_type ? { documentType: q.document_type } : {}),
      },
      orderBy: { documentType: 'asc' },
    });
    return rows.map((r) => this.sequenceDto(r));
  }

  async createSequence(ctx: OrgContext, dto: DocumentSequenceCreateDto, actorId: string, ip?: string) {
    await this.companyInScope(ctx, dto.company_id);
    try {
      const created = await this.prisma.documentSequence.create({
        data: {
          companyId: dto.company_id,
          documentType: dto.document_type,
          prefix: dto.prefix,
          nextNumber: dto.next_number,
          resetPolicy: dto.reset_policy,
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'document_sequence.created',
        entityType: 'document_sequence', entityId: created.id, ip,
      });
      return this.sequenceDto(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.duplicate('document_type');
      }
      throw e;
    }
  }

  private async sequenceInScope(ctx: OrgContext, id: string) {
    const seq = await this.prisma.documentSequence.findUnique({
      where: { id },
      include: { company: { select: { organizationId: true } } },
    });
    if (!seq || seq.company.organizationId !== ctx.organizationId) throw Errors.notFound('Document sequence');
    this.assertCompanyInScope(ctx, seq.companyId);
    return seq;
  }

  async updateSequence(ctx: OrgContext, id: string, dto: DocumentSequenceUpdateDto, actorId: string, ip?: string) {
    await this.sequenceInScope(ctx, id);
    const updated = await this.prisma.documentSequence.update({
      where: { id },
      data: {
        ...(dto.prefix !== undefined ? { prefix: dto.prefix } : {}),
        ...(dto.next_number !== undefined ? { nextNumber: dto.next_number } : {}),
        ...(dto.reset_policy !== undefined
          ? { resetPolicy: dto.reset_policy, ...(dto.reset_policy === 'never' ? { lastResetYear: null } : {}) }
          : {}),
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'document_sequence.updated',
      entityType: 'document_sequence', entityId: id, ip,
    });
    return this.sequenceDto(updated);
  }

  async previewSequence(ctx: OrgContext, companyId: string, documentType: string) {
    await this.companyInScope(ctx, companyId);
    return this.numbering.preview(companyId, documentType);
  }

  // ---------- attachments ----------

  async uploadAttachment(
    ctx: OrgContext, ownerType: AttachmentOwner, ownerId: string,
    file: UploadedFile | undefined, actorId: string, ip?: string,
  ) {
    await this.ownerInScope(ctx, ownerType, ownerId);
    if (!file || !file.buffer || file.buffer.length === 0) throw Errors.fileRequired();
    if (file.size > maxUploadMb() * 1024 * 1024) throw Errors.attachmentTooLarge(maxUploadMb());
    if (!isAllowedMime(file.mimetype)) throw Errors.invalidFileType(file.mimetype);

    const dir = ensureStorageDir();
    const fileKey = storageKeyFor(file.originalname);
    writeFileSync(join(dir, fileKey), file.buffer);

    const created = await this.prisma.attachment.create({
      data: {
        ownerType,
        ownerId,
        fileKey,
        fileName: file.originalname,
        mime: file.mimetype,
        size: file.size,
        uploadedById: actorId,
      },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'attachment.uploaded',
      entityType: 'attachment', entityId: created.id, ip,
    });
    return this.attachmentDto(created);
  }

  async listAttachments(
    ctx: OrgContext, ownerType: AttachmentOwner, ownerId: string,
    q: { page: number; per_page: number },
  ) {
    await this.ownerInScope(ctx, ownerType, ownerId);
    const where = { ownerType, ownerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.attachment.count({ where }),
      this.prisma.attachment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
    ]);
    return { data: rows.map((r) => this.attachmentDto(r)), meta: pageMeta(total, q.page, q.per_page) };
  }

  /**
   * Resolve an attachment for download: 404 unknown id, 403 when the owner
   * lives in another org or the caller lacks the owner's view permission.
   */
  async downloadAttachment(ctx: OrgContext, id: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw Errors.notFound('Attachment');
    const ownerType = attachment.ownerType as AttachmentOwner;
    if (!['customer', 'supplier', 'product'].includes(ownerType)) {
      throw Errors.notFound('Attachment');
    }
    await this.ownerInScope(ctx, ownerType, attachment.ownerId);
    this.assertOwnerViewPermission(ctx, ownerType);
    const path = join(storageDir(), attachment.fileKey);
    if (!existsSync(path)) throw Errors.notFound('File');
    const stat = statSync(path);
    return {
      path,
      fileName: attachment.fileName,
      mime: attachment.mime,
      size: stat.size,
    };
  }

  async deleteAttachment(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw Errors.notFound('Attachment');
    const ownerType = attachment.ownerType as AttachmentOwner;
    await this.ownerInScope(ctx, ownerType, attachment.ownerId);
    try {
      unlinkSync(join(storageDir(), attachment.fileKey));
    } catch {
      // Best effort: the DB row is the source of truth.
    }
    await this.prisma.attachment.delete({ where: { id } });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: 'attachment.deleted',
      entityType: 'attachment', entityId: id, ip,
    });
    return { deleted: true, id };
  }

  // ---------- CSV export / import ----------

  async exportParties(ctx: OrgContext, kind: PartyKind, companyId: string) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.partyDelegate(kind).findMany({
      where: { companyId },
      include: { paymentTerm: { select: { nameEn: true } } },
      orderBy: { number: 'asc' },
    });
    const isSupplier = kind === 'supplier';
    const headers = isSupplier ? SUPPLIER_CSV_HEADERS : CUSTOMER_CSV_HEADERS;
    const data = rows.map((r) => {
      const base = [
        r.number, r.nameAr, r.nameEn, r.kind, r.taxId ?? '',
        r.paymentTerm?.nameEn ?? '',
        r.creditLimit == null ? '' : String(r.creditLimit),
        r.status,
      ];
      return isSupplier ? [...base.slice(0, 4), r.taxId ?? '', base[5], base[6], base[7], (r as { defaultCurrency: string }).defaultCurrency] : [r.number, ...base.slice(1)];
    });
    const headersOut = ['number', ...headers];
    return { filename: `${kind}s-${companyId.slice(0, 8)}.csv`, csv: toCsv(headersOut, data) };
  }

  async importParties(ctx: OrgContext, kind: PartyKind, companyId: string, buffer: Buffer, actorId: string, ip?: string) {
    const company = await this.companyInScope(ctx, companyId);
    if (!buffer || buffer.length === 0) throw Errors.fileRequired();
    if (buffer.length > maxUploadMb() * 1024 * 1024) throw Errors.attachmentTooLarge(maxUploadMb());

    const { headers, rows } = parseCsvText(buffer.toString('utf8'));
    const isSupplier = kind === 'supplier';
    const headerErrors = requireHeaders(headers, isSupplier ? SUPPLIER_CSV_HEADERS : CUSTOMER_CSV_HEADERS);
    if (headerErrors.length > 0) throw Errors.csvImportValidation(headerErrors);

    const terms = await this.prisma.paymentTerm.findMany({
      where: { companyId, isActive: true },
      select: { id: true, nameAr: true, nameEn: true },
    });
    const paymentTerms = new Map<string, string>();
    for (const t of terms) {
      paymentTerms.set(t.nameAr.trim().toLowerCase(), t.id);
      paymentTerms.set(t.nameEn.trim().toLowerCase(), t.id);
    }
    const currencies = isSupplier
      ? new Set((await this.prisma.currency.findMany({ select: { code: true } })).map((c) => c.code))
      : undefined;

    // Validate ALL rows before persisting anything.
    const { rows: valid, errors } = isSupplier
      ? validateSupplierCsvRows(rows, { paymentTerms, currencies })
      : validateCustomerCsvRows(rows, { paymentTerms });
    if (errors.length > 0) throw Errors.csvImportValidation(errors);

    const warnings: DuplicateWarning[] = [];
    let imported = 0;
    for (const row of valid) {
      const result = await this.createPartyFromCsv(ctx, kind, company, row, actorId, ip);
      imported++;
      warnings.push(...result.warnings);
    }
    return { imported, warnings };
  }

  private async createPartyFromCsv(
    ctx: OrgContext, kind: PartyKind,
    company: { id: string; baseCurrency: string },
    row: ValidatedPartyRow, actorId: string, ip?: string,
  ): Promise<{ warnings: DuplicateWarning[] }> {
    const number = await this.numbering.nextNumber(company.id, kind);
    const base = {
      companyId: company.id,
      number,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      kind: row.kind,
      taxId: row.tax_id,
      paymentTermId: row.payment_term_id,
      creditLimit: row.credit_limit,
      status: row.status,
      createdById: actorId,
    };
    const data = kind === 'supplier'
      ? { ...base, defaultCurrency: row.default_currency || company.baseCurrency }
      : base;

    const delegate = this.partyDelegate(kind);
    const candidates = await delegate.findMany({
      where: {
        companyId: company.id,
        OR: [
          ...(data.taxId ? [{ taxId: data.taxId }] : []),
          { nameAr: { equals: data.nameAr, mode: 'insensitive' } },
          { nameEn: { equals: data.nameEn, mode: 'insensitive' } },
        ],
      },
      select: { taxId: true, nameAr: true, nameEn: true },
      take: 5,
    });
    const warnings = findDuplicateWarnings(
      { taxId: data.taxId, nameAr: data.nameAr, nameEn: data.nameEn },
      candidates,
    );
    const created = await delegate.create({ data });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId, action: `${kind}.imported`,
      entityType: kind, entityId: created.id, ip,
    });
    return { warnings };
  }

  async exportProducts(ctx: OrgContext, companyId: string) {
    await this.companyInScope(ctx, companyId);
    const rows = await this.prisma.product.findMany({
      where: { companyId },
      include: {
        category: { select: { nameEn: true } },
        baseUom: { select: { code: true } },
        taxCode: { select: { nameEn: true } },
      },
      orderBy: { sku: 'asc' },
    });
    const data = rows.map((r) => [
      r.sku, r.nameAr, r.nameEn, r.type,
      r.category?.nameEn ?? '',
      r.baseUom.code,
      r.purchasePrice == null ? '' : String(r.purchasePrice),
      r.salesPrice == null ? '' : String(r.salesPrice),
      r.taxCode?.nameEn ?? '',
      r.reorderLevel == null ? '' : String(r.reorderLevel),
      r.isActive ? 'true' : 'false',
    ]);
    return { filename: `products-${companyId.slice(0, 8)}.csv`, csv: toCsv(PRODUCT_CSV_HEADERS, data) };
  }

  async importProducts(ctx: OrgContext, companyId: string, buffer: Buffer, actorId: string, ip?: string) {
    await this.companyInScope(ctx, companyId);
    if (!buffer || buffer.length === 0) throw Errors.fileRequired();
    if (buffer.length > maxUploadMb() * 1024 * 1024) throw Errors.attachmentTooLarge(maxUploadMb());

    const { headers, rows } = parseCsvText(buffer.toString('utf8'));
    const headerErrors = requireHeaders(headers, PRODUCT_CSV_HEADERS);
    if (headerErrors.length > 0) throw Errors.csvImportValidation(headerErrors);

    const [categories, uoms, taxCodes, existingProducts] = await this.prisma.$transaction([
      this.prisma.productCategory.findMany({
        where: { companyId, isActive: true },
        select: { id: true, nameAr: true, nameEn: true },
      }),
      this.prisma.unitOfMeasure.findMany({ select: { id: true, code: true } }),
      this.prisma.taxCode.findMany({
        where: { companyId, isActive: true },
        select: { id: true, nameAr: true, nameEn: true },
      }),
      this.prisma.product.findMany({ where: { companyId }, select: { sku: true } }),
    ]);
    const categoryMap = new Map<string, string>();
    for (const c of categories) {
      categoryMap.set(c.nameAr.trim().toLowerCase(), c.id);
      categoryMap.set(c.nameEn.trim().toLowerCase(), c.id);
    }
    const uomMap = new Map(uoms.map((u) => [u.code.toUpperCase(), u.id]));
    const taxMap = new Map<string, string>();
    for (const t of taxCodes) {
      taxMap.set(t.nameAr.trim().toLowerCase(), t.id);
      taxMap.set(t.nameEn.trim().toLowerCase(), t.id);
    }
    const existingSkus = new Set(existingProducts.map((p) => p.sku.toUpperCase()));

    // Validate ALL rows before persisting anything.
    const { rows: valid, errors } = validateProductCsvRows(rows, {
      categories: categoryMap,
      uoms: uomMap,
      taxCodes: taxMap,
      existingSkus,
    });
    if (errors.length > 0) throw Errors.csvImportValidation(errors);

    let imported = 0;
    for (const row of valid) {
      await this.createProductFromCsv(ctx, companyId, row, actorId, ip);
      imported++;
    }
    return { imported };
  }

  private async createProductFromCsv(
    ctx: OrgContext, companyId: string, row: ValidatedProductRow,
    actorId: string, ip?: string,
  ) {
    try {
      const created = await this.prisma.product.create({
        data: {
          companyId,
          sku: row.sku,
          nameAr: row.name_ar,
          nameEn: row.name_en,
          type: row.type,
          categoryId: row.category_id,
          baseUomId: row.base_uom_id,
          purchasePrice: row.purchase_price,
          salesPrice: row.sales_price,
          taxCodeId: row.tax_code_id,
          reorderLevel: row.reorder_level,
          isActive: row.is_active,
          createdById: actorId,
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId, actorId, action: 'product.imported',
        entityType: 'product', entityId: created.id, ip,
      });
    } catch (e) {
      this.throwIfSkuConflict(e, row.sku);
      throw e;
    }
  }

  /** Stream helper for the controller's download endpoint. */
  attachmentStream(path: string) {
    return createReadStream(path);
  }

  inlineDisposition(mime: string): boolean {
    const m = mime.toLowerCase();
    return m.startsWith('image/') || m === 'application/pdf';
  }
}
