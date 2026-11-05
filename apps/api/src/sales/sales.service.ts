import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { InventoryService } from '../inventory/inventory.service';
import { NumberingService } from '../masterdata/numbering';
import { NotificationService } from '../notifications/notifications.service';
import { Errors } from '../common/errors';
import { OrgContext } from '../common/request.types';
import { pageMeta } from '../common/pagination';
import Decimal from 'decimal.js';
import { toDecimal, roundMoney } from '../accounting/money';
import { lineAmounts, docTotals, applyAllocation, invoicePayStatus } from './calculations';
import type {
  QuotationCreateDto, QuotationUpdateDto,
  SalesOrderCreateDto, DeliveryCreateDto, SalesInvoiceCreateDto,
  SalesPaymentCreateDto, CreditNoteCreateDto,
} from '@atlas-erp/contracts';

type Tx = Prisma.TransactionClient;
const d = (v: unknown): Decimal => toDecimal(String(v ?? 0));

/** Sales GL accounts (Egyptian CoA seed codes). */
const ACCT = { bank: '1110', ar: '1210', inventory: '1310', outputVat: '2120', revenue: '4110', cogs: '5110' };

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly inventory: InventoryService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationService,
  ) {}

  // ================= helpers =================

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  private async scopedCompany(tx: Tx, ctx: OrgContext, companyId: string) {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company || company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, companyId);
    return company;
  }

  private async scopedCustomer(tx: Tx, ctx: OrgContext, companyId: string, customerId: string) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.companyId !== companyId) throw Errors.notFound('Customer');
    if (customer.status !== 'active') throw Errors.notFound('Customer');
    return customer;
  }

  private async scopedProduct(tx: Tx, ctx: OrgContext, companyId: string, productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.companyId !== companyId) throw Errors.notFound('Product');
    if (!product.isActive) throw Errors.notFound('Product');
    return product;
  }

  private async scopedWarehouse(tx: Tx, ctx: OrgContext, companyId: string, warehouseId: string) {
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId }, include: { branch: true },
    });
    if (!warehouse) throw Errors.notFound('Warehouse');
    const branch = await tx.branch.findUnique({ where: { id: warehouse.branchId } });
    if (!branch || branch.companyId !== companyId) throw Errors.notFound('Warehouse');
    if (warehouse.status !== 'active') throw Errors.notFound('Warehouse');
    return warehouse;
  }

  private async baseDecimals(tx: Tx, companyId: string): Promise<number> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const cur = await tx.currency.findUnique({ where: { code: company.baseCurrency } });
    return cur?.decimals ?? 2;
  }

  /** Current weighted-average cost for a product/warehouse (0 when never stocked). */
  private async currentAvgCost(companyId: string, warehouseId: string, productId: string): Promise<Decimal> {
    const latest = await this.prisma.inventoryValuationEntry.findFirst({
      where: { companyId, warehouseId, productId },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? d(latest.resultingAvgCost) : new Decimal(0);
  }

  private async currentAvgCostTx(tx: Tx, companyId: string, warehouseId: string, productId: string): Promise<Decimal> {
    const latest = await tx.inventoryValuationEntry.findFirst({
      where: { companyId, warehouseId, productId },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? d(latest.resultingAvgCost) : new Decimal(0);
  }

  private async resolveAccount(tx: Tx, companyId: string, code: string): Promise<string> {
    const a = await tx.account.findFirst({ where: { companyId, code } });
    if (!a) throw Errors.productAccountInvalid(
      `Account ${code} is not configured for this company.`,
      `الحساب ${code} غير مُعدّ لهذه الشركة.`,
    );
    return a.id;
  }

  private async audit(tx: Tx, ctx: OrgContext, actorId: string, action: string, entityType: string, entityId: string, diff?: object, ip?: string) {
    await tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId, actorId, action,
        entityType, entityId, diff: (diff ?? undefined) as object | undefined, ip: ip ?? null,
      },
    });
  }

  private async checkIdempotency(tx: Tx, ctx: OrgContext, model: 'quotation' | 'salesOrder' | 'delivery' | 'salesInvoice' | 'salesPayment' | 'creditNote', key: string | undefined) {
    if (!key) return null;
    const existing = await (tx as unknown as Record<string, { findUnique: (a: unknown) => Promise<{ id: string; companyId: string } | null> }>)[model]
      .findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      this.assertCompanyInScope(ctx, existing.companyId);
      return existing;
    }
    return null;
  }

  // ================= quotations =================

  async createQuotation(ctx: OrgContext, dto: QuotationCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedCustomer(tx, ctx, dto.company_id, dto.customer_id);
      const replay = await this.checkIdempotency(tx, ctx, 'quotation', dto.idempotency_key);
      if (replay) return { quotation: await this.quotationDto(tx, replay.id), replayed: true };

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolveLines(tx, ctx, dto.company_id, dto.lines, decimals);
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'quotation');

      const q = await tx.quotation.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, customerId: dto.customer_id,
          number, status: 'draft', validUntil: new Date(dto.valid_until + 'T00:00:00Z'),
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, discountRate: l.discountRate, taxRate: l.taxRate,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.quotation_created', 'quotation', q.id, { number }, ip);
      return { quotation: await this.quotationDto(tx, q.id), replayed: false };
    });
  }

  /** Resolve priced lines: validate products, compute line totals. */
  private async resolveLines(
    tx: Tx, ctx: OrgContext, companyId: string,
    lines: Array<{ product_id?: string; description: string; quantity: string; unit_price: string; discount_rate?: string; tax_rate?: string }>,
    decimals: number,
  ) {
    const out: Array<{
      productId: string | null; description: string; quantity: Decimal; unitPrice: Decimal;
      discountRate: Decimal; taxRate: Decimal; lineTotal: Decimal;
    }> = [];
    for (const l of lines) {
      let productId: string | null = null;
      if (l.product_id) {
        const p = await this.scopedProduct(tx, ctx, companyId, l.product_id);
        productId = p.id;
      }
      const a = lineAmounts({ quantity: l.quantity, unit_price: l.unit_price, discount_rate: l.discount_rate ?? '0', tax_rate: l.tax_rate ?? '0' }, decimals);
      out.push({
        productId, description: l.description, quantity: d(l.quantity), unitPrice: d(l.unit_price),
        discountRate: d(l.discount_rate ?? '0'), taxRate: d(l.tax_rate ?? '0'), lineTotal: a.total,
      });
    }
    return out;
  }

  private async quotationDto(tx: Tx, id: string) {
    const q = await tx.quotation.findUniqueOrThrow({
      where: { id },
      include: { lines: { include: { product: { select: { sku: true, nameAr: true, nameEn: true, type: true } } } }, customer: { select: { nameAr: true, nameEn: true, number: true } } },
    });
    return {
      id: q.id, company_id: q.companyId, customer_id: q.customerId, number: q.number,
      status: q.status, valid_until: q.validUntil.toISOString().slice(0, 10),
      subtotal: d(q.subtotal).toFixed(4), tax_total: d(q.taxTotal).toFixed(4), total: d(q.total).toFixed(4),
      currency: q.currency, notes: q.notes, customer: q.customer,
      lines: q.lines.map((l) => ({
        id: l.id, product_id: l.productId, description: l.description,
        quantity: d(l.quantity).toFixed(4), unit_price: d(l.unitPrice).toFixed(4),
        discount_rate: d(l.discountRate).toFixed(4), tax_rate: d(l.taxRate).toFixed(4),
        line_total: d(l.lineTotal).toFixed(4), product: l.product,
      })),
      created_at: q.createdAt.toISOString(),
    };
  }

  async updateQuotation(ctx: OrgContext, id: string, dto: QuotationUpdateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id } });
      if (!q || q.organizationId !== ctx.organizationId) throw Errors.notFound('Quotation');
      this.assertCompanyInScope(ctx, q.companyId);
      if (q.status !== 'draft') throw Errors.salesDocNotDraft('quotation');
      const decimals = await this.baseDecimals(tx, q.companyId);
      const data: Record<string, unknown> = {};
      if (dto.valid_until) data.validUntil = new Date(dto.valid_until + 'T00:00:00Z');
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.lines) {
        const lines = await this.resolveLines(tx, ctx, q.companyId, dto.lines, decimals);
        const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
        await tx.quotationLine.deleteMany({ where: { quotationId: id } });
        await tx.quotationLine.createMany({
          data: lines.map((l) => ({
            quotationId: id, productId: l.productId, description: l.description, quantity: l.quantity,
            unitPrice: l.unitPrice, discountRate: l.discountRate, taxRate: l.taxRate, lineTotal: l.lineTotal,
          })),
        });
        data.subtotal = totals.subtotal; data.taxTotal = totals.taxTotal; data.total = totals.total;
      }
      await tx.quotation.update({ where: { id }, data });
      await this.audit(tx, ctx, actorId, 'sales.quotation_updated', 'quotation', id, undefined, ip);
      return { quotation: await this.quotationDto(tx, id) };
    });
  }

  async transitionQuotation(ctx: OrgContext, id: string, action: 'send' | 'withdraw' | 'reject', actorId: string, ip?: string) {
    const allowed: Record<string, string[]> = {
      send: ['draft'], withdraw: ['sent'], reject: ['sent'],
    };
    const to: Record<string, string> = { send: 'sent', withdraw: 'draft', reject: 'rejected' };
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id } });
      if (!q || q.organizationId !== ctx.organizationId) throw Errors.notFound('Quotation');
      this.assertCompanyInScope(ctx, q.companyId);
      if (!allowed[action].includes(q.status)) throw Errors.invalidSalesTransition('quotation', q.status, to[action]);
      await tx.quotation.update({ where: { id }, data: { status: to[action] } });
      await this.audit(tx, ctx, actorId, `sales.quotation_${to[action]}`, 'quotation', id, { from: q.status }, ip);
      return { quotation: await this.quotationDto(tx, id) };
    });
  }

  /** Accept a sent quotation and convert it into a draft sales order. */
  async acceptQuotation(ctx: OrgContext, id: string, warehouseId: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id }, include: { lines: true } });
      if (!q || q.organizationId !== ctx.organizationId) throw Errors.notFound('Quotation');
      this.assertCompanyInScope(ctx, q.companyId);
      if (q.status === 'expired') throw Errors.quotationExpired(q.number);
      if (q.status !== 'sent') throw Errors.invalidSalesTransition('quotation', q.status, 'accepted');
      await this.scopedWarehouse(tx, ctx, q.companyId, warehouseId);

      const order = await this.createOrderFromQuotation(tx, ctx, q, warehouseId, actorId);
      await tx.quotation.update({ where: { id }, data: { status: 'accepted' } });
      await this.audit(tx, ctx, actorId, 'sales.quotation_accepted', 'quotation', id, { sales_order_id: order.id }, ip);
      return { quotation: await this.quotationDto(tx, id), sales_order: order };
    });
  }

  private async createOrderFromQuotation(tx: Tx, ctx: OrgContext, q: { id: string; companyId: string; customerId: string; currency: string; lines: Array<{ productId: string | null; description: string; quantity: unknown; unitPrice: unknown; discountRate: unknown; taxRate: unknown; lineTotal: unknown }> }, warehouseId: string, actorId: string) {
    for (const l of q.lines) {
      if (!l.productId) throw Errors.notFound('Product');
      await this.scopedProduct(tx, ctx, q.companyId, l.productId);
    }
    const decimals = await this.baseDecimals(tx, q.companyId);
    const totals = docTotals(q.lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
    const number = await this.numbering.nextNumber(q.companyId, 'sales_order');
    const order = await tx.salesOrder.create({
      data: {
        organizationId: ctx.organizationId, companyId: q.companyId, customerId: q.customerId,
        quotationId: q.id, warehouseId, number, status: 'draft',
        subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
        currency: q.currency, createdById: actorId,
        lines: {
          create: q.lines.map((l) => ({
            productId: l.productId!, description: l.description, quantity: d(l.quantity),
            unitPrice: d(l.unitPrice), discountRate: d(l.discountRate), taxRate: d(l.taxRate),
            lineTotal: d(l.lineTotal),
          })),
        },
      },
    });
    await this.audit(tx, ctx, actorId, 'sales.order_created', 'sales_order', order.id, { number, from_quotation: q.id });
    return this.salesOrderDto(tx, order.id);
  }

  /** Scheduled-job entry: expire sent quotations past their valid_until. */
  async expireDueQuotations(ctx: OrgContext, actorId: string): Promise<{ expired: number }> {
    return this.prisma.$transaction(async (tx) => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const due = await tx.quotation.findMany({
        where: { organizationId: ctx.organizationId, status: 'sent', validUntil: { lt: today } },
        select: { id: true, companyId: true },
      });
      let n = 0;
      for (const q of due) {
        if (ctx.companyIds && !ctx.companyIds.includes(q.companyId)) continue;
        const full = await tx.quotation.findUnique({ where: { id: q.id }, select: { number: true, createdById: true } });
        await tx.quotation.update({ where: { id: q.id }, data: { status: 'expired' } });
        await this.audit(tx, ctx, actorId, 'sales.quotation_expired', 'quotation', q.id, { job: true });
        if (full?.createdById) {
          await this.notifications.notify(tx, {
            organizationId: ctx.organizationId, userId: full.createdById,
            type: 'quotation_expired',
            titleAr: `انتهت صلاحية عرض السعر ${full.number}`,
            titleEn: `Quotation ${full.number} expired`,
            link: `/sales/quotations/${q.id}`,
          });
        }
        n++;
      }
      return { expired: n };
    });
  }

  async listQuotations(ctx: OrgContext, companyId: string, q: { status?: string; customer_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.customer_id) where.customerId = q.customer_id;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59Z') } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { customer: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, customer: r.customer,
        valid_until: r.validUntil.toISOString().slice(0, 10),
        subtotal: d(r.subtotal).toFixed(4), tax_total: d(r.taxTotal).toFixed(4), total: d(r.total).toFixed(4),
        currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getQuotation(ctx: OrgContext, id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q || q.organizationId !== ctx.organizationId) throw Errors.notFound('Quotation');
    this.assertCompanyInScope(ctx, q.companyId);
    return this.prisma.$transaction((tx) => this.quotationDto(tx, id));
  }

  // ================= sales orders =================

  async createSalesOrder(ctx: OrgContext, dto: SalesOrderCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedCustomer(tx, ctx, dto.company_id, dto.customer_id);
      await this.scopedWarehouse(tx, ctx, dto.company_id, dto.warehouse_id);
      const replay = await this.checkIdempotency(tx, ctx, 'salesOrder', dto.idempotency_key);
      if (replay) return { sales_order: await this.salesOrderDto(tx, replay.id), replayed: true };

      let quotationId: string | null = null;
      if (dto.quotation_id) {
        const q = await tx.quotation.findUnique({ where: { id: dto.quotation_id } });
        if (!q || q.organizationId !== ctx.organizationId || q.companyId !== dto.company_id) throw Errors.notFound('Quotation');
        if (q.status !== 'accepted') throw Errors.quotationNotAccepted(q.number);
        quotationId = q.id;
      }

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolveLines(tx, ctx, dto.company_id, dto.lines.map((l) => ({
        product_id: l.product_id, description: l.description, quantity: l.quantity,
        unit_price: l.unit_price, discount_rate: l.discount_rate ?? '0', tax_rate: l.tax_rate ?? '0',
      })), decimals);
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'sales_order');

      const order = await tx.salesOrder.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, customerId: dto.customer_id,
          quotationId, warehouseId: dto.warehouse_id, number, status: 'draft',
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId!, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, discountRate: l.discountRate, taxRate: l.taxRate, lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.order_created', 'sales_order', order.id, { number }, ip);
      return { sales_order: await this.salesOrderDto(tx, order.id), replayed: false };
    });
  }

  private async salesOrderDto(tx: Tx, id: string) {
    const o = await tx.salesOrder.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { product: { select: { sku: true, nameAr: true, nameEn: true, type: true } } } },
        customer: { select: { nameAr: true, nameEn: true, number: true } },
        warehouse: { select: { nameAr: true, name: true } },
      },
    });
    return {
      id: o.id, company_id: o.companyId, customer_id: o.customerId, quotation_id: o.quotationId,
      warehouse_id: o.warehouseId, number: o.number, status: o.status,
      subtotal: d(o.subtotal).toFixed(4), tax_total: d(o.taxTotal).toFixed(4), total: d(o.total).toFixed(4),
      currency: o.currency, notes: o.notes, customer: o.customer, warehouse: o.warehouse,
      lines: o.lines.map((l) => ({
        id: l.id, product_id: l.productId, description: l.description,
        quantity: d(l.quantity).toFixed(4), delivered_quantity: d(l.deliveredQuantity).toFixed(4),
        invoiced_quantity: d(l.invoicedQuantity).toFixed(4),
        unit_price: d(l.unitPrice).toFixed(4), discount_rate: d(l.discountRate).toFixed(4),
        tax_rate: d(l.taxRate).toFixed(4), line_total: d(l.lineTotal).toFixed(4), product: l.product,
      })),
      created_at: o.createdAt.toISOString(),
    };
  }

  /** Confirm a draft order: creates row-locked stock reservations for stocked lines. */
  async confirmOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    // Reservations must be created OUTSIDE the main tx (InventoryService opens its own).
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: { lines: { include: { product: true } } } });
    if (!order || order.organizationId !== ctx.organizationId) throw Errors.notFound('Sales order');
    this.assertCompanyInScope(ctx, order.companyId);
    if (order.status !== 'draft') throw Errors.invalidSalesTransition('sales_order', order.status, 'confirmed');

    const reservations: Array<{ line_id: string; reservation_id: string }> = [];
    for (const line of order.lines) {
      if (line.product.type !== 'stocked') continue; // services need no reservation
      const r = await this.inventory.reserveStock(ctx, {
        company_id: order.companyId, warehouse_id: order.warehouseId, product_id: line.productId,
        quantity: d(line.quantity).toFixed(4),
        source_type: 'sales_order', source_id: order.id,
        idempotency_key: `so-reserve:${order.id}:${line.id}`,
      }, actorId, ip);
      reservations.push({ line_id: line.id, reservation_id: r.reservation.id });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id }, data: { status: 'confirmed' } });
      await this.audit(tx, ctx, actorId, 'sales.order_confirmed', 'sales_order', id, { reservations: reservations.length }, ip);
      return { sales_order: await this.salesOrderDto(tx, id), reservations };
    });
  }

  /** Cancel a draft/confirmed order (never after delivery); releases reservations. */
  async cancelOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order || order.organizationId !== ctx.organizationId) throw Errors.notFound('Sales order');
    this.assertCompanyInScope(ctx, order.companyId);
    if (!['draft', 'confirmed'].includes(order.status)) throw Errors.invalidSalesTransition('sales_order', order.status, 'cancelled');

    if (order.status === 'confirmed') {
      const res = await this.prisma.stockReservation.findMany({
        where: { organizationId: ctx.organizationId, sourceType: 'sales_order', sourceId: id, status: 'active' },
      });
      for (const r of res) await this.inventory.releaseReservation(ctx, r.id, actorId, ip);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id }, data: { status: 'cancelled' } });
      await this.audit(tx, ctx, actorId, 'sales.order_cancelled', 'sales_order', id, { from: order.status }, ip);
      return { sales_order: await this.salesOrderDto(tx, id) };
    });
  }

  async listSalesOrders(ctx: OrgContext, companyId: string, q: { status?: string; customer_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.customer_id) where.customerId = q.customer_id;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59Z') } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { customer: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, customer: r.customer,
        subtotal: d(r.subtotal).toFixed(4), tax_total: d(r.taxTotal).toFixed(4), total: d(r.total).toFixed(4),
        currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getSalesOrder(ctx: OrgContext, id: string) {
    const o = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Sales order');
    this.assertCompanyInScope(ctx, o.companyId);
    return this.prisma.$transaction((tx) => this.salesOrderDto(tx, id));
  }

  // ================= deliveries =================

  async createDelivery(ctx: OrgContext, dto: DeliveryCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({ where: { id: dto.sales_order_id }, include: { lines: { include: { product: true } } } });
      if (!order || order.organizationId !== ctx.organizationId) throw Errors.notFound('Sales order');
      this.assertCompanyInScope(ctx, order.companyId);
      if (!['confirmed', 'partially_delivered'].includes(order.status)) {
        throw Errors.invalidSalesTransition('sales_order', order.status, 'delivery');
      }
      const warehouseId = dto.warehouse_id ?? order.warehouseId;
      await this.scopedWarehouse(tx, ctx, order.companyId, warehouseId);
      const replay = await this.checkIdempotency(tx, ctx, 'delivery', dto.idempotency_key);
      if (replay) return { delivery: await this.deliveryDto(tx, replay.id), replayed: true };

      const lineById = new Map(order.lines.map((l) => [l.id, l]));
      const createLines: Array<{ salesOrderLineId: string; productId: string; quantity: Decimal }> = [];
      for (const dl of dto.lines) {
        const ol = lineById.get(dl.sales_order_line_id);
        if (!ol) throw Errors.notFound('Sales order line');
        if (ol.product.type !== 'stocked') throw Errors.serviceProductNoDelivery(ol.product.sku);
        const qty = d(dl.quantity);
        const remaining = d(ol.quantity).minus(d(ol.deliveredQuantity));
        if (qty.gt(remaining)) throw Errors.overDelivery(ol.product.sku, remaining.toFixed(4), qty.toFixed(4));
        createLines.push({ salesOrderLineId: ol.id, productId: ol.productId, quantity: qty });
      }

      const number = await this.numbering.nextNumber(order.companyId, 'delivery');
      const delivery = await tx.delivery.create({
        data: {
          organizationId: ctx.organizationId, companyId: order.companyId, salesOrderId: order.id,
          warehouseId, number, status: 'draft',
          deliveryDate: new Date((dto.delivery_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          notes: dto.notes ?? null, idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: { create: createLines.map((l) => ({ salesOrderLineId: l.salesOrderLineId, productId: l.productId, quantity: l.quantity })) },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.delivery_created', 'delivery', delivery.id, { number }, ip);
      return { delivery: await this.deliveryDto(tx, delivery.id), replayed: false };
    });
  }

  private async deliveryDto(tx: Tx, id: string) {
    const dv = await tx.delivery.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { product: { select: { sku: true, nameAr: true, nameEn: true } }, salesOrderLine: { select: { description: true } } } },
        salesOrder: { select: { number: true } },
      },
    });
    return {
      id: dv.id, company_id: dv.companyId, sales_order_id: dv.salesOrderId, warehouse_id: dv.warehouseId,
      number: dv.number, status: dv.status, delivery_date: dv.deliveryDate.toISOString().slice(0, 10),
      notes: dv.notes, sales_order: dv.salesOrder,
      lines: dv.lines.map((l) => ({
        id: l.id, sales_order_line_id: l.salesOrderLineId, product_id: l.productId,
        quantity: d(l.quantity).toFixed(4), product: l.product, description: l.salesOrderLine.description,
      })),
      created_at: dv.createdAt.toISOString(),
    };
  }

  /**
   * Post a draft delivery: issues stock (FIFO reservation auto-consume) + Dr COGS / Cr Inventory
   * per line via the Phase 5 engine, then advances the order's delivery status.
   * Lines are pre-validated for availability before anything posts.
   */
  async postDelivery(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: { lines: { include: { product: true, salesOrderLine: true } }, salesOrder: { include: { lines: true } } },
    });
    if (!delivery || delivery.organizationId !== ctx.organizationId) throw Errors.notFound('Delivery');
    this.assertCompanyInScope(ctx, delivery.companyId);
    if (delivery.status !== 'draft') throw Errors.invalidSalesTransition('delivery', delivery.status, 'posted');

    // Pre-validate every line (availability + stocked) before posting anything.
    const issueResults: Array<{ movement_id: string; cogs: string }> = [];
    for (const line of delivery.lines) {
      const res = await this.inventory.issueStock(ctx, {
        company_id: delivery.companyId, warehouse_id: delivery.warehouseId, product_id: line.productId,
        movement_type: 'issue', quantity: d(line.quantity).toFixed(4), unit_cost: '0.0000',
        movement_date: delivery.deliveryDate.toISOString().slice(0, 10),
        source_type: 'delivery', source_id: delivery.id,
        idempotency_key: `del-issue:${delivery.id}:${line.id}`,
      }, actorId, ip);
      issueResults.push({ movement_id: res.movement.id, cogs: res.cogs });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({ where: { id }, data: { status: 'posted' } });
      for (const line of delivery.lines) {
        await tx.salesOrderLine.update({
          where: { id: line.salesOrderLineId },
          data: { deliveredQuantity: { increment: line.quantity } },
        });
      }
      // Recompute order delivery status.
      const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId: delivery.salesOrderId } });
      const allDelivered = lines.every((l) => d(l.deliveredQuantity).gte(d(l.quantity)));
      const anyDelivered = lines.some((l) => d(l.deliveredQuantity).gt(0));
      const orderStatus = allDelivered ? 'delivered' : anyDelivered ? 'partially_delivered' : 'confirmed';
      await tx.salesOrder.update({ where: { id: delivery.salesOrderId }, data: { status: orderStatus } });
      await this.audit(tx, ctx, actorId, 'sales.delivery_posted', 'delivery', id,
        { movements: issueResults.map((r) => r.movement_id) }, ip);
      return { delivery: await this.deliveryDto(tx, id), issues: issueResults };
    });
  }

  async listDeliveries(ctx: OrgContext, companyId: string, q: { status?: string; sales_order_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.sales_order_id) where.salesOrderId = q.sales_order_id;
    if (q.from || q.to) where.deliveryDate = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { salesOrder: { select: { number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, sales_order: r.salesOrder,
        delivery_date: r.deliveryDate.toISOString().slice(0, 10), created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getDelivery(ctx: OrgContext, id: string) {
    const dv = await this.prisma.delivery.findUnique({ where: { id } });
    if (!dv || dv.organizationId !== ctx.organizationId) throw Errors.notFound('Delivery');
    this.assertCompanyInScope(ctx, dv.companyId);
    return this.prisma.$transaction((tx) => this.deliveryDto(tx, id));
  }

  // ================= invoices =================

  async createInvoice(ctx: OrgContext, dto: SalesInvoiceCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedCustomer(tx, ctx, dto.company_id, dto.customer_id);
      const replay = await this.checkIdempotency(tx, ctx, 'salesInvoice', dto.idempotency_key);
      if (replay) return { invoice: await this.salesInvoiceDto(tx, replay.id), replayed: true };

      const decimals = await this.baseDecimals(tx, dto.company_id);
      // Build invoice lines from: order lines, delivery lines, and/or direct lines.
      const built: Array<{
        salesOrderLineId: string | null; productId: string; description: string;
        quantity: Decimal; unitPrice: Decimal; discountRate: Decimal; taxRate: Decimal; lineTotal: Decimal;
      }> = [];
      let salesOrderId: string | null = null;

      if (dto.sales_order_id) {
        const order = await tx.salesOrder.findUnique({ where: { id: dto.sales_order_id }, include: { lines: { include: { product: true } } } });
        if (!order || order.organizationId !== ctx.organizationId || order.companyId !== dto.company_id) throw Errors.notFound('Sales order');
        if (order.customerId !== dto.customer_id) throw Errors.notFound('Sales order');
        if (!['confirmed', 'partially_delivered', 'delivered'].includes(order.status)) {
          throw Errors.invalidSalesTransition('sales_order', order.status, 'invoice');
        }
        salesOrderId = order.id;
        for (const ol of order.lines) {
          const billable = ol.product.type === 'stocked' ? d(ol.deliveredQuantity) : d(ol.quantity);
          const remaining = billable.minus(d(ol.invoicedQuantity));
          if (remaining.lte(0)) continue;
          const a = lineAmounts({ quantity: remaining, unit_price: ol.unitPrice, discount_rate: ol.discountRate, tax_rate: ol.taxRate }, decimals);
          built.push({
            salesOrderLineId: ol.id, productId: ol.productId, description: ol.description,
            quantity: remaining, unitPrice: d(ol.unitPrice), discountRate: d(ol.discountRate),
            taxRate: d(ol.taxRate), lineTotal: a.total,
          });
        }
      }

      if (dto.delivery_ids?.length) {
        for (const delId of dto.delivery_ids) {
          const dv = await tx.delivery.findUnique({ where: { id: delId }, include: { lines: { include: { salesOrderLine: { include: { product: true } } } } } });
          if (!dv || dv.organizationId !== ctx.organizationId || dv.companyId !== dto.company_id) throw Errors.notFound('Delivery');
          if (dv.status !== 'posted' && dv.status !== 'partially_invoiced') throw Errors.invalidSalesTransition('delivery', dv.status, 'invoice');
          if (salesOrderId && dv.salesOrderId !== salesOrderId) throw Errors.notFound('Delivery');
          salesOrderId = dv.salesOrderId;
          const order = await tx.salesOrder.findUniqueOrThrow({ where: { id: dv.salesOrderId } });
          if (order.customerId !== dto.customer_id) throw Errors.notFound('Delivery');
          for (const dl of dv.lines) {
            const ol = dl.salesOrderLine;
            const remaining = d(dl.quantity).minus(d(ol.invoicedQuantity));
            if (remaining.lte(0)) continue;
            // Cap by what was actually delivered on this order line.
            const billable = d(ol.deliveredQuantity).minus(d(ol.invoicedQuantity));
            const qty = remaining.gt(billable) ? billable : remaining;
            if (qty.lte(0)) continue;
            const a = lineAmounts({ quantity: qty, unit_price: ol.unitPrice, discount_rate: ol.discountRate, tax_rate: ol.taxRate }, decimals);
            built.push({
              salesOrderLineId: ol.id, productId: dl.productId, description: ol.description,
              quantity: qty, unitPrice: d(ol.unitPrice), discountRate: d(ol.discountRate),
              taxRate: d(ol.taxRate), lineTotal: a.total,
            });
          }
        }
      }

      if (dto.lines?.length) {
        for (const l of dto.lines) {
          const p = await this.scopedProduct(tx, ctx, dto.company_id, l.product_id);
          const a = lineAmounts({ quantity: l.quantity, unit_price: l.unit_price, discount_rate: l.discount_rate ?? '0', tax_rate: l.tax_rate ?? '0' }, decimals);
          built.push({
            salesOrderLineId: null, productId: p.id, description: l.description,
            quantity: d(l.quantity), unitPrice: d(l.unit_price), discountRate: d(l.discount_rate ?? '0'),
            taxRate: d(l.tax_rate ?? '0'), lineTotal: a.total,
          });
        }
      }

      if (!built.length) throw Errors.overInvoice('invoice', '0.0000', '0.0000');
      const totals = docTotals(built.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'sales_invoice');

      const inv = await tx.salesInvoice.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, customerId: dto.customer_id,
          salesOrderId, number, status: 'draft',
          invoiceDate: new Date((dto.invoice_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          paidTotal: new Decimal(0), outstanding: totals.total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: built.map((l) => ({
              salesOrderLineId: l.salesOrderLineId, productId: l.productId, description: l.description,
              quantity: l.quantity, unitPrice: l.unitPrice, discountRate: l.discountRate,
              taxRate: l.taxRate, lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.invoice_created', 'sales_invoice', inv.id, { number }, ip);
      return { invoice: await this.salesInvoiceDto(tx, inv.id), replayed: false };
    });
  }

  private async salesInvoiceDto(tx: Tx, id: string) {
    const inv = await tx.salesInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { product: { select: { sku: true, nameAr: true, nameEn: true, type: true } } } },
        customer: { select: { nameAr: true, nameEn: true, number: true } },
        salesOrder: { select: { number: true } },
      },
    });
    return {
      id: inv.id, company_id: inv.companyId, customer_id: inv.customerId, sales_order_id: inv.salesOrderId,
      number: inv.number, status: inv.status, invoice_date: inv.invoiceDate.toISOString().slice(0, 10),
      subtotal: d(inv.subtotal).toFixed(4), tax_total: d(inv.taxTotal).toFixed(4), total: d(inv.total).toFixed(4),
      paid_total: d(inv.paidTotal).toFixed(4), outstanding: d(inv.outstanding).toFixed(4),
      currency: inv.currency, notes: inv.notes, customer: inv.customer, sales_order: inv.salesOrder,
      lines: inv.lines.map((l) => ({
        id: l.id, sales_order_line_id: l.salesOrderLineId, product_id: l.productId, description: l.description,
        quantity: d(l.quantity).toFixed(4), unit_price: d(l.unitPrice).toFixed(4),
        discount_rate: d(l.discountRate).toFixed(4), tax_rate: d(l.taxRate).toFixed(4),
        line_total: d(l.lineTotal).toFixed(4), product: l.product,
      })),
      created_at: inv.createdAt.toISOString(),
    };
  }

  /**
   * Post a draft invoice: Dr 1210 AR / Cr 4110 Revenue / Cr 2120 Output VAT
   * in the SAME transaction (atomic). Idempotent on the idempotency key.
   */
  async postInvoice(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findUnique({ where: { id }, include: { lines: true } });
      if (!inv || inv.organizationId !== ctx.organizationId) throw Errors.notFound('Sales invoice');
      this.assertCompanyInScope(ctx, inv.companyId);
      if (inv.status !== 'draft') throw Errors.invalidSalesTransition('sales_invoice', inv.status, 'posted');

      const idemKey = idempotencyKey ?? (inv.idempotencyKey ? `gl:${inv.idempotencyKey}` : `gl:inv:${inv.id}`);
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const ar = await this.resolveAccount(tx, inv.companyId, ACCT.ar);
        const revenue = await this.resolveAccount(tx, inv.companyId, ACCT.revenue);
        const vat = await this.resolveAccount(tx, inv.companyId, ACCT.outputVat);
        const total = d(inv.total), subtotal = d(inv.subtotal), tax = d(inv.taxTotal);
        const lines: Array<{ account_id: string; debit: Decimal; credit: Decimal }> = [
          { account_id: ar, debit: total, credit: new Decimal(0) },
          { account_id: revenue, debit: new Decimal(0), credit: subtotal },
        ];
        if (tax.gt(0)) lines.push({ account_id: vat, debit: new Decimal(0), credit: tax });
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: inv.companyId,
          journal_type: 'sales_invoice',
          posting_date: inv.invoiceDate.toISOString().slice(0, 10),
          description: `Sales invoice ${inv.number}`,
          source_type: 'sales_invoice', source_id: inv.id,
          idempotency_key: idemKey,
          lines,
        }, actorId, ip);
        journalId = gl.id;
      }

      await tx.salesInvoice.update({
        where: { id },
        data: { status: 'posted', journalEntryId: journalId, outstanding: inv.total, paidTotal: new Decimal(0) },
      });

      // Advance linked order lines + deliveries + order status.
      const byOrderLine = new Map<string, Decimal>();
      for (const l of inv.lines) {
        if (!l.salesOrderLineId) continue;
        byOrderLine.set(l.salesOrderLineId, (byOrderLine.get(l.salesOrderLineId) ?? new Decimal(0)).plus(d(l.quantity)));
      }
      for (const [olId, qty] of byOrderLine) {
        await tx.salesOrderLine.update({ where: { id: olId }, data: { invoicedQuantity: { increment: qty } } });
      }
      if (inv.salesOrderId) {
        const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId: inv.salesOrderId }, include: { product: true } });
        // The order is 'invoiced' only when the FULL ordered quantity is invoiced.
        const fullyInvoiced = lines.every((l) => d(l.invoicedQuantity).gte(d(l.quantity)));
        if (fullyInvoiced) await tx.salesOrder.update({ where: { id: inv.salesOrderId }, data: { status: 'invoiced' } });
        // Mark deliveries that are now fully invoiced.
        const deliveries = await tx.delivery.findMany({
          where: { salesOrderId: inv.salesOrderId, status: { in: ['posted', 'partially_invoiced'] } },
          include: { lines: true },
        });
        for (const dv of deliveries) {
          const olIds = dv.lines.map((l) => l.salesOrderLineId);
          const ols = await tx.salesOrderLine.findMany({ where: { id: { in: olIds } }, include: { product: true } });
          const done = ols.every((l) => {
            const billable = l.product.type === 'stocked' ? d(l.deliveredQuantity) : d(l.quantity);
            return d(l.invoicedQuantity).gte(billable);
          });
          await tx.delivery.update({ where: { id: dv.id }, data: { status: done ? 'invoiced' : 'partially_invoiced' } });
        }
      }

      await this.audit(tx, ctx, actorId, 'sales.invoice_posted', 'sales_invoice', id, { journal_id: journalId }, ip);
      return { invoice: await this.salesInvoiceDto(tx, id), journal_id: journalId };
    });
  }

  async listSalesInvoices(ctx: OrgContext, companyId: string, q: { status?: string; customer_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.customer_id) where.customerId = q.customer_id;
    if (q.from || q.to) where.invoiceDate = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesInvoice.count({ where }),
      this.prisma.salesInvoice.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { customer: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, customer: r.customer,
        invoice_date: r.invoiceDate.toISOString().slice(0, 10),
        total: d(r.total).toFixed(4), paid_total: d(r.paidTotal).toFixed(4), outstanding: d(r.outstanding).toFixed(4),
        currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getSalesInvoice(ctx: OrgContext, id: string) {
    const inv = await this.prisma.salesInvoice.findUnique({ where: { id } });
    if (!inv || inv.organizationId !== ctx.organizationId) throw Errors.notFound('Sales invoice');
    this.assertCompanyInScope(ctx, inv.companyId);
    return this.prisma.$transaction((tx) => this.salesInvoiceDto(tx, id));
  }

  // ================= payments =================

  async createPayment(ctx: OrgContext, dto: SalesPaymentCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedCustomer(tx, ctx, dto.company_id, dto.customer_id);
      const replay = await this.checkIdempotency(tx, ctx, 'salesPayment', dto.idempotency_key);
      if (replay) return { payment: await this.salesPaymentDto(tx, replay.id), replayed: true };

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const amount = d(dto.amount);
      const allocations: Array<{ invoiceId: string; amount: Decimal }> = [];
      let allocated = new Decimal(0);
      for (const a of dto.allocations ?? []) {
        const inv = await tx.salesInvoice.findUnique({ where: { id: a.sales_invoice_id } });
        if (!inv || inv.organizationId !== ctx.organizationId || inv.companyId !== dto.company_id) throw Errors.notFound('Sales invoice');
        if (inv.customerId !== dto.customer_id) throw Errors.notFound('Sales invoice');
        if (inv.status !== 'posted' && inv.status !== 'partially_paid') throw Errors.invoiceNotPosted(inv.number);
        const amt = d(a.amount);
        if (amt.gt(d(inv.outstanding))) throw Errors.overAllocation(inv.number, d(inv.outstanding).toFixed(decimals), amt.toFixed(decimals));
        allocations.push({ invoiceId: inv.id, amount: amt });
        allocated = allocated.plus(amt);
      }
      if (allocated.gt(amount)) {
        throw Errors.overAllocation('payment', amount.toFixed(decimals), allocated.toFixed(decimals));
      }

      const number = await this.numbering.nextNumber(dto.company_id, 'sales_payment');
      const pay = await tx.salesPayment.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, customerId: dto.customer_id,
          number, status: 'draft',
          paymentDate: new Date((dto.payment_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          amount: roundMoney(amount, decimals), currency: company.baseCurrency,
          notes: dto.notes ?? null, idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          allocations: { create: allocations.map((a) => ({ organizationId: ctx.organizationId, salesInvoiceId: a.invoiceId, amount: a.amount, createdById: actorId })) },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.payment_created', 'sales_payment', pay.id, { number }, ip);
      return { payment: await this.salesPaymentDto(tx, pay.id), replayed: false };
    });
  }

  private async salesPaymentDto(tx: Tx, id: string) {
    const p = await tx.salesPayment.findUniqueOrThrow({
      where: { id },
      include: {
        allocations: { include: { salesInvoice: { select: { number: true } } } },
        customer: { select: { nameAr: true, nameEn: true, number: true } },
      },
    });
    return {
      id: p.id, company_id: p.companyId, customer_id: p.customerId, number: p.number, status: p.status,
      payment_date: p.paymentDate.toISOString().slice(0, 10), amount: d(p.amount).toFixed(4),
      currency: p.currency, notes: p.notes, customer: p.customer,
      allocations: p.allocations.map((a) => ({
        id: a.id, sales_invoice_id: a.salesInvoiceId, amount: d(a.amount).toFixed(4),
        invoice_number: a.salesInvoice.number,
      })),
      created_at: p.createdAt.toISOString(),
    };
  }

  /**
   * Post a draft payment: Dr 1110 Bank / Cr 1210 AR, allocations reduce invoice
   * outstanding; an invoice is `paid` only when outstanding reaches 0.
   */
  async postPayment(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const pay = await tx.salesPayment.findUnique({ where: { id }, include: { allocations: true } });
      if (!pay || pay.organizationId !== ctx.organizationId) throw Errors.notFound('Sales payment');
      this.assertCompanyInScope(ctx, pay.companyId);
      if (pay.status !== 'draft') throw Errors.invalidSalesTransition('sales_payment', pay.status, 'posted');

      const idemKey = idempotencyKey ?? (pay.idempotencyKey ? `gl:${pay.idempotencyKey}` : `gl:pay:${pay.id}`);
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const bank = await this.resolveAccount(tx, pay.companyId, ACCT.bank);
        const ar = await this.resolveAccount(tx, pay.companyId, ACCT.ar);
        const amount = d(pay.amount);
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: pay.companyId,
          journal_type: 'sales_payment',
          posting_date: pay.paymentDate.toISOString().slice(0, 10),
          description: `Customer payment ${pay.number}`,
          source_type: 'sales_payment', source_id: pay.id,
          idempotency_key: idemKey,
          lines: [
            { account_id: bank, debit: amount, credit: new Decimal(0) },
            { account_id: ar, debit: new Decimal(0), credit: amount },
          ],
        }, actorId, ip);
        journalId = gl.id;
      }

      const decimals = await this.baseDecimals(tx, pay.companyId);
      for (const a of pay.allocations) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: a.salesInvoiceId } });
        const newOutstanding = applyAllocation(inv.outstanding, a.amount, decimals);
        const newPaid = roundMoney(d(inv.paidTotal).plus(d(a.amount)), decimals);
        const status = invoicePayStatus(newOutstanding, d(inv.total));
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: { outstanding: newOutstanding, paidTotal: newPaid, status },
        });
      }

      await tx.salesPayment.update({ where: { id }, data: { status: 'posted', journalEntryId: journalId } });
      await this.audit(tx, ctx, actorId, 'sales.payment_posted', 'sales_payment', id, { journal_id: journalId }, ip);
      return { payment: await this.salesPaymentDto(tx, id), journal_id: journalId };
    });
  }

  async listSalesPayments(ctx: OrgContext, companyId: string, q: { status?: string; customer_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.customer_id) where.customerId = q.customer_id;
    if (q.from || q.to) where.paymentDate = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesPayment.count({ where }),
      this.prisma.salesPayment.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { customer: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, customer: r.customer,
        payment_date: r.paymentDate.toISOString().slice(0, 10),
        amount: d(r.amount).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getSalesPayment(ctx: OrgContext, id: string) {
    const p = await this.prisma.salesPayment.findUnique({ where: { id } });
    if (!p || p.organizationId !== ctx.organizationId) throw Errors.notFound('Sales payment');
    this.assertCompanyInScope(ctx, p.companyId);
    return this.prisma.$transaction((tx) => this.salesPaymentDto(tx, id));
  }

  // ================= credit notes =================

  async createCreditNote(ctx: OrgContext, dto: CreditNoteCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedCustomer(tx, ctx, dto.company_id, dto.customer_id);
      const replay = await this.checkIdempotency(tx, ctx, 'creditNote', dto.idempotency_key);
      if (replay) return { credit_note: await this.creditNoteDto(tx, replay.id), replayed: true };

      let invoiceId: string | null = null;
      if (dto.sales_invoice_id) {
        const inv = await tx.salesInvoice.findUnique({ where: { id: dto.sales_invoice_id } });
        if (!inv || inv.organizationId !== ctx.organizationId || inv.companyId !== dto.company_id) throw Errors.notFound('Sales invoice');
        if (inv.customerId !== dto.customer_id) throw Errors.notFound('Sales invoice');
        if (inv.status !== 'posted' && inv.status !== 'partially_paid' && inv.status !== 'paid') {
          throw Errors.invoiceNotPosted(inv.number);
        }
        invoiceId = inv.id;
      }

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolveLines(tx, ctx, dto.company_id, dto.lines.map((l) => ({
        product_id: l.product_id, description: l.description, quantity: l.quantity,
        unit_price: l.unit_price, discount_rate: l.discount_rate ?? '0', tax_rate: l.tax_rate ?? '0',
      })), decimals);
      if (dto.is_return) {
        for (const l of lines) {
          if (!l.productId) throw Errors.notFound('Product');
          const p = await this.scopedProduct(tx, ctx, dto.company_id, l.productId);
          if (p.type !== 'stocked') throw Errors.productNotStocked(p.sku);
        }
      }
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      if (invoiceId) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
        if (totals.total.gt(d(inv.outstanding))) {
          throw Errors.creditExceedsReceivable(inv.number, d(inv.outstanding).toFixed(decimals), totals.total.toFixed(decimals));
        }
      }
      const number = await this.numbering.nextNumber(dto.company_id, 'credit_note');

      const cn = await tx.creditNote.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, customerId: dto.customer_id,
          salesInvoiceId: invoiceId, number, status: 'draft',
          creditDate: new Date((dto.credit_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: company.baseCurrency, reason: dto.reason, isReturn: dto.is_return ?? false,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, discountRate: l.discountRate, taxRate: l.taxRate, lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'sales.credit_note_created', 'credit_note', cn.id, { number }, ip);
      return { credit_note: await this.creditNoteDto(tx, cn.id), replayed: false };
    });
  }

  private async creditNoteDto(tx: Tx, id: string) {
    const cn = await tx.creditNote.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { include: { product: { select: { sku: true, nameAr: true, nameEn: true, type: true } } } },
        customer: { select: { nameAr: true, nameEn: true, number: true } },
        salesInvoice: { select: { number: true } },
      },
    });
    return {
      id: cn.id, company_id: cn.companyId, customer_id: cn.customerId, sales_invoice_id: cn.salesInvoiceId,
      number: cn.number, status: cn.status, credit_date: cn.creditDate.toISOString().slice(0, 10),
      subtotal: d(cn.subtotal).toFixed(4), tax_total: d(cn.taxTotal).toFixed(4), total: d(cn.total).toFixed(4),
      currency: cn.currency, reason: cn.reason, is_return: cn.isReturn,
      customer: cn.customer, sales_invoice: cn.salesInvoice,
      lines: cn.lines.map((l) => ({
        id: l.id, product_id: l.productId, description: l.description,
        quantity: d(l.quantity).toFixed(4), unit_price: d(l.unitPrice).toFixed(4),
        discount_rate: d(l.discountRate).toFixed(4), tax_rate: d(l.taxRate).toFixed(4),
        line_total: d(l.lineTotal).toFixed(4), product: l.product,
      })),
      created_at: cn.createdAt.toISOString(),
    };
  }

  /**
   * Post a draft credit note: Dr 4110 Revenue / Dr 2120 Output VAT / Cr 1210 AR.
   * On returns: receives the goods back into stock + reverses COGS (Dr 1310 / Cr 5110).
   * Reduces the linked invoice's outstanding (floored at 0).
   */
  async postCreditNote(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string, warehouseId?: string) {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id }, include: { lines: { include: { product: true } } },
    });
    if (!cn || cn.organizationId !== ctx.organizationId) throw Errors.notFound('Credit note');
    this.assertCompanyInScope(ctx, cn.companyId);
    if (cn.status !== 'draft') throw Errors.invalidSalesTransition('credit_note', cn.status, 'posted');

    let whId = warehouseId ?? null;
    if (cn.isReturn) {
      if (!whId) {
        // Default to the first active warehouse of the company.
        const wh = await this.prisma.warehouse.findFirst({
          where: { branch: { companyId: cn.companyId }, status: 'active' },
        });
        if (!wh) throw Errors.notFound('Warehouse');
        whId = wh.id;
      }
      // Return the goods first (each receive is atomic via the inventory engine),
      // valued at the CURRENT weighted-average cost (the best proxy for the
      // original avg cost at which the goods left).
      for (const line of cn.lines) {
        if (!line.productId) continue;
        const avg = await this.currentAvgCost(cn.companyId, whId, line.productId);
        await this.inventory.receiveStock(ctx, {
          company_id: cn.companyId, warehouse_id: whId, product_id: line.productId,
          movement_type: 'receive', quantity: d(line.quantity).toFixed(4),
          unit_cost: avg.toFixed(4),
          movement_date: cn.creditDate.toISOString().slice(0, 10),
          source_type: 'credit_note', source_id: cn.id,
          idempotency_key: `cn-return:${cn.id}:${line.id}`,
        }, actorId, ip);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const decimals = await this.baseDecimals(tx, cn.companyId);
      const idemKey = idempotencyKey ?? (cn.idempotencyKey ? `gl:${cn.idempotencyKey}` : `gl:cn:${cn.id}`);
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const ar = await this.resolveAccount(tx, cn.companyId, ACCT.ar);
        const revenue = await this.resolveAccount(tx, cn.companyId, ACCT.revenue);
        const vat = await this.resolveAccount(tx, cn.companyId, ACCT.outputVat);
        const total = d(cn.total), subtotal = d(cn.subtotal), tax = d(cn.taxTotal);
        const cnLines: Array<{ account_id: string; debit: Decimal; credit: Decimal }> = [
          { account_id: revenue, debit: subtotal, credit: new Decimal(0) },
        ];
        if (tax.gt(0)) cnLines.push({ account_id: vat, debit: tax, credit: new Decimal(0) });
        cnLines.push({ account_id: ar, debit: new Decimal(0), credit: total });
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: cn.companyId,
          journal_type: 'credit_note',
          posting_date: cn.creditDate.toISOString().slice(0, 10),
          description: `Credit note ${cn.number} — ${cn.reason}`,
          source_type: 'credit_note', source_id: cn.id,
          idempotency_key: idemKey,
          lines: cnLines,
        }, actorId, ip);
        journalId = gl.id;

        // Reverse COGS on returns: Dr 1310 Inventory / Cr 5110 COGS at the
        // weighted-average cost (the cost at which the goods originally left).
        if (cn.isReturn) {
          const inventory = await this.resolveAccount(tx, cn.companyId, ACCT.inventory);
          const cogs = await this.resolveAccount(tx, cn.companyId, ACCT.cogs);
          for (const line of cn.lines) {
            if (!line.productId) continue;
            const avg = await this.currentAvgCostTx(tx, cn.companyId, whId!, line.productId);
            const cost = roundMoney(d(line.quantity).mul(avg), decimals);
            if (cost.lte(0)) continue;
            await this.accounting.postSystemEntry(tx, ctx, {
              company_id: cn.companyId,
              journal_type: 'credit_note_return',
              posting_date: cn.creditDate.toISOString().slice(0, 10),
              description: `COGS reversal — credit note ${cn.number}`,
              source_type: 'credit_note', source_id: cn.id,
              idempotency_key: `gl:cn-cogs:${cn.id}:${line.id}`,
              lines: [
                { account_id: inventory, debit: cost, credit: new Decimal(0) },
                { account_id: cogs, debit: new Decimal(0), credit: cost },
              ],
            }, actorId, ip);
          }
        }
      }

      await tx.creditNote.update({ where: { id }, data: { status: 'posted', journalEntryId: journalId } });

      if (cn.salesInvoiceId) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: cn.salesInvoiceId } });
        const newOutstanding = d(inv.outstanding).minus(d(cn.total));
        const floored = newOutstanding.lt(0) ? new Decimal(0) : roundMoney(newOutstanding, decimals);
        const newPaid = roundMoney(d(inv.total).minus(floored), decimals);
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: { outstanding: floored, paidTotal: newPaid, status: invoicePayStatus(floored, d(inv.total)) },
        });
      }

      await this.audit(tx, ctx, actorId, 'sales.credit_note_posted', 'credit_note', id, { journal_id: journalId }, ip);
      return { credit_note: await this.creditNoteDto(tx, id), journal_id: journalId };
    });
  }

  async listCreditNotes(ctx: OrgContext, companyId: string, q: { status?: string; customer_id?: string; from?: string; to?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.customer_id) where.customerId = q.customer_id;
    if (q.from || q.to) where.creditDate = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.creditNote.count({ where }),
      this.prisma.creditNote.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { customer: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, customer: r.customer, is_return: r.isReturn,
        credit_date: r.creditDate.toISOString().slice(0, 10),
        total: d(r.total).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getCreditNote(ctx: OrgContext, id: string) {
    const cn = await this.prisma.creditNote.findUnique({ where: { id } });
    if (!cn || cn.organizationId !== ctx.organizationId) throw Errors.notFound('Credit note');
    this.assertCompanyInScope(ctx, cn.companyId);
    return this.prisma.$transaction((tx) => this.creditNoteDto(tx, id));
  }
}
