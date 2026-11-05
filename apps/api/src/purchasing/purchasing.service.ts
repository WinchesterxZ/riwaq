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
import { lineAmounts, docTotals, applyAllocation } from '../sales/calculations';
import {
  matchLine, approvalRequired, billPayStatus, applyBillAllocation,
  PURCHASE_APPROVAL_THRESHOLD,
} from './calculations';
import type {
  PurchaseRequestCreateDto, RfqCreateDto, RfqAwardDto,
  PurchaseOrderCreateDto, GoodsReceiptCreateDto,
  SupplierBillCreateDto, SupplierPaymentCreateDto,
} from '@atlas-erp/contracts';

type Tx = Prisma.TransactionClient;
const d = (v: unknown): Decimal => toDecimal(String(v ?? 0));

/** Purchasing GL accounts (Egyptian CoA seed codes). */
const ACCT = { bank: '1110', inventory: '1310', grni: '1320', inputVat: '1230', ap: '2110' };

type PurchasingModel = 'purchaseRequest' | 'rfq' | 'purchaseOrder' | 'goodsReceipt' | 'supplierBill' | 'supplierPayment';

@Injectable()
export class PurchasingService {
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

  private async scopedSupplier(tx: Tx, ctx: OrgContext, companyId: string, supplierId: string) {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.companyId !== companyId) throw Errors.notFound('Supplier');
    if (supplier.status !== 'active') throw Errors.notFound('Supplier');
    return supplier;
  }

  private async scopedProduct(tx: Tx, ctx: OrgContext, companyId: string, productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.companyId !== companyId) throw Errors.notFound('Product');
    if (!product.isActive) throw Errors.notFound('Product');
    return product;
  }

  private async scopedWarehouse(tx: Tx, ctx: OrgContext, companyId: string, warehouseId: string) {
    const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
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

  private async checkIdempotency(tx: Tx, ctx: OrgContext, model: PurchasingModel, key: string | undefined) {
    if (!key) return null;
    const existing = await (tx as unknown as Record<string, { findUnique: (a: unknown) => Promise<{ id: string; companyId: string } | null> }>)[model]
      .findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      this.assertCompanyInScope(ctx, existing.companyId);
      return existing;
    }
    return null;
  }

  /** Resolve priced lines: validate products (stocked only for purchasing), compute line totals. */
  private async resolvePricedLines(
    tx: Tx, ctx: OrgContext, companyId: string,
    lines: Array<{ product_id?: string; description: string; quantity: string; unit_price: string; discount_rate?: string; tax_rate?: string }>,
    decimals: number,
  ) {
    const out: Array<{
      productId: string | null; description: string; quantity: Decimal;
      unitPrice: Decimal; discountRate: Decimal; taxRate: Decimal; lineTotal: Decimal;
    }> = [];
    for (const l of lines) {
      let productId: string | null = null;
      if (l.product_id) {
        const p = await this.scopedProduct(tx, ctx, companyId, l.product_id);
        if (p.type === 'service') throw Errors.invalidInventoryTransition(p.sku, 'service→purchasing');
        productId = p.id;
      }
      const a = lineAmounts({ quantity: l.quantity, unit_price: l.unit_price, discount_rate: l.discount_rate, tax_rate: l.tax_rate }, decimals);
      out.push({
        productId, description: l.description,
        quantity: d(l.quantity), unitPrice: d(l.unit_price),
        discountRate: d(l.discount_rate), taxRate: d(l.tax_rate),
        lineTotal: a.total,
      });
    }
    return out;
  }

  // ================= DTOs =================

  private lineDto(l: { id: string; productId?: string | null; description: string; quantity: unknown; unitPrice: unknown; discountRate?: unknown; taxRate?: unknown; lineTotal: unknown }) {
    return {
      id: l.id, product_id: l.productId ?? null, description: l.description,
      quantity: d(l.quantity).toFixed(4), unit_price: d(l.unitPrice).toFixed(4),
      discount_rate: d(l.discountRate).toFixed(4), tax_rate: d(l.taxRate).toFixed(4),
      line_total: d(l.lineTotal).toFixed(4),
    };
  }

  private async purchaseRequestDto(tx: Tx, id: string) {
    const r = await tx.purchaseRequest.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    return {
      id: r.id, number: r.number, status: r.status,
      subtotal: d(r.subtotal).toFixed(4), total: d(r.total).toFixed(4), currency: r.currency,
      notes: r.notes, requested_by: r.requestedById, approved_by: r.approvedById,
      lines: r.lines.map((l) => this.lineDto({ ...l, discountRate: 0, taxRate: 0 })),
      created_at: r.createdAt.toISOString(),
    };
  }

  private async rfqDto(tx: Tx, id: string) {
    const r = await tx.rfq.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    return {
      id: r.id, number: r.number, status: r.status, supplier_id: r.supplierId,
      purchase_request_id: r.purchaseRequestId,
      subtotal: d(r.subtotal).toFixed(4), total: d(r.total).toFixed(4), currency: r.currency,
      notes: r.notes,
      lines: r.lines.map((l) => ({
        id: l.id, supplier_id: l.supplierId, product_id: l.productId, description: l.description,
        quantity: d(l.quantity).toFixed(4), quoted_price: l.quotedPrice ? d(l.quotedPrice).toFixed(4) : null,
        awarded: l.awarded,
      })),
      created_at: r.createdAt.toISOString(),
    };
  }

  private async purchaseOrderDto(tx: Tx, id: string) {
    const o = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    return {
      id: o.id, number: o.number, status: o.status, supplier_id: o.supplierId,
      purchase_request_id: o.purchaseRequestId, rfq_id: o.rfqId, warehouse_id: o.warehouseId,
      subtotal: d(o.subtotal).toFixed(4), tax_total: d(o.taxTotal).toFixed(4), total: d(o.total).toFixed(4),
      currency: o.currency, notes: o.notes,
      requested_by: o.requestedById, approved_by: o.approvedById,
      lines: o.lines.map((l) => ({
        ...this.lineDto(l),
        received_quantity: d(l.receivedQuantity).toFixed(4),
        billed_quantity: d(l.billedQuantity).toFixed(4),
      })),
      created_at: o.createdAt.toISOString(),
    };
  }

  private async goodsReceiptDto(tx: Tx, id: string) {
    const g = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    return {
      id: g.id, number: g.number, status: g.status,
      purchase_order_id: g.purchaseOrderId, warehouse_id: g.warehouseId,
      receipt_date: g.receiptDate.toISOString().slice(0, 10), notes: g.notes,
      lines: g.lines.map((l) => ({
        id: l.id, purchase_order_line_id: l.purchaseOrderLineId, product_id: l.productId,
        quantity: d(l.quantity).toFixed(4), unit_cost: d(l.unitCost).toFixed(4),
      })),
      created_at: g.createdAt.toISOString(),
    };
  }

  private async supplierBillDto(tx: Tx, id: string) {
    const b = await tx.supplierBill.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    return {
      id: b.id, number: b.number, status: b.status, supplier_id: b.supplierId,
      purchase_order_id: b.purchaseOrderId, supplier_ref: b.supplierRef,
      bill_date: b.billDate.toISOString().slice(0, 10),
      due_date: b.dueDate ? b.dueDate.toISOString().slice(0, 10) : null,
      subtotal: d(b.subtotal).toFixed(4), tax_total: d(b.taxTotal).toFixed(4), total: d(b.total).toFixed(4),
      paid_total: d(b.paidTotal).toFixed(4), outstanding: d(b.outstanding).toFixed(4),
      currency: b.currency, notes: b.notes, approved_by: b.approvedById,
      lines: b.lines.map((l) => ({
        ...this.lineDto(l),
        purchase_order_line_id: l.purchaseOrderLineId, goods_receipt_line_id: l.goodsReceiptLineId,
      })),
      created_at: b.createdAt.toISOString(),
    };
  }

  private async supplierPaymentDto(tx: Tx, id: string) {
    const p = await tx.supplierPayment.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
    return {
      id: p.id, number: p.number, status: p.status, supplier_id: p.supplierId,
      payment_date: p.paymentDate.toISOString().slice(0, 10),
      amount: d(p.amount).toFixed(4), currency: p.currency, notes: p.notes,
      allocations: p.allocations.map((a) => ({
        id: a.id, supplier_bill_id: a.supplierBillId, amount: d(a.amount).toFixed(4),
      })),
      created_at: p.createdAt.toISOString(),
    };
  }

  // ================= purchase requests =================

  async createPurchaseRequest(ctx: OrgContext, dto: PurchaseRequestCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      const replay = await this.checkIdempotency(tx, ctx, 'purchaseRequest', dto.idempotency_key);
      if (replay) return { purchase_request: await this.purchaseRequestDto(tx, replay.id), replayed: true };

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolvePricedLines(tx, ctx, dto.company_id, dto.lines, decimals);
      const subtotal = lines.reduce((s, l) => s.plus(l.quantity.mul(l.unitPrice)), new Decimal(0));
      const total = roundMoney(subtotal, decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'purchase_request');

      const r = await tx.purchaseRequest.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id,
          number, status: 'draft', requestedById: actorId,
          subtotal: roundMoney(subtotal, decimals), total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, lineTotal: roundMoney(l.quantity.mul(l.unitPrice), decimals),
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.pr_created', 'purchase_request', r.id, { number }, ip);
      return { purchase_request: await this.purchaseRequestDto(tx, r.id), replayed: false };
    });
  }

  async listPurchaseRequests(ctx: OrgContext, companyId: string, q: { status?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.count({ where }),
      this.prisma.purchaseRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status,
        total: d(r.total).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getPurchaseRequest(ctx: OrgContext, id: string) {
    const r = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase request');
    this.assertCompanyInScope(ctx, r.companyId);
    return this.prisma.$transaction((tx) => this.purchaseRequestDto(tx, id));
  }

  async transitionPurchaseRequest(ctx: OrgContext, id: string, action: 'submit' | 'approve' | 'reject' | 'cancel', actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase request');
      this.assertCompanyInScope(ctx, r.companyId);
      let to: string;
      if (action === 'submit') {
        if (r.status !== 'draft') throw Errors.invalidPurchasingTransition('purchase_request', r.status, 'submitted');
        to = 'submitted';
      } else if (action === 'approve') {
        if (r.status !== 'submitted') throw Errors.invalidPurchasingTransition('purchase_request', r.status, 'approved');
        if (r.requestedById === actorId) throw Errors.selfApprovalForbidden();
        to = 'approved';
      } else if (action === 'reject') {
        if (r.status !== 'submitted') throw Errors.invalidPurchasingTransition('purchase_request', r.status, 'rejected');
        to = 'rejected';
      } else {
        if (r.status !== 'draft' && r.status !== 'approved') throw Errors.invalidPurchasingTransition('purchase_request', r.status, 'cancelled');
        to = 'cancelled';
      }
      const data: Record<string, unknown> = { status: to };
      if (to === 'approved') { data.approvedById = actorId; data.approvedAt = new Date(); }
      await tx.purchaseRequest.update({ where: { id }, data });
      await this.audit(tx, ctx, actorId, `purchasing.pr_${action}`, 'purchase_request', id, { from: r.status, to }, ip);
      if (to === 'submitted') {
        await this.notifications.notifyPermissionHolders(tx, ctx.organizationId, 'purchase_request', 'approve', {
          type: 'approval_request',
          titleAr: `طلب اعتماد طلب شراء ${r.number}`,
          titleEn: `Purchase request ${r.number} needs approval`,
          link: `/purchasing/requests/${id}`,
        }, actorId);
      } else if ((to === 'approved' || to === 'rejected') && r.requestedById && r.requestedById !== actorId) {
        await this.notifications.notify(tx, {
          organizationId: ctx.organizationId, userId: r.requestedById,
          type: 'approval_decision',
          titleAr: to === 'approved' ? `تم اعتماد طلب الشراء ${r.number}` : `تم رفض طلب الشراء ${r.number}`,
          titleEn: to === 'approved' ? `Purchase request ${r.number} approved` : `Purchase request ${r.number} rejected`,
          link: `/purchasing/requests/${id}`,
        });
      }
      return { purchase_request: await this.purchaseRequestDto(tx, id) };
    });
  }

  /** Convert an approved PR into a draft purchase order (supplier chosen at conversion). */
  async convertPurchaseRequest(ctx: OrgContext, id: string, supplierId: string, warehouseId: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.purchaseRequest.findUnique({ where: { id }, include: { lines: true } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase request');
      this.assertCompanyInScope(ctx, r.companyId);
      if (r.status !== 'approved') throw Errors.invalidPurchasingTransition('purchase_request', r.status, 'ordered');
      await this.scopedSupplier(tx, ctx, r.companyId, supplierId);
      await this.scopedWarehouse(tx, ctx, r.companyId, warehouseId);
      const decimals = await this.baseDecimals(tx, r.companyId);
      const number = await this.numbering.nextNumber(r.companyId, 'purchase_order');
      const lines = r.lines.map((l) => ({
        quantity: l.quantity, unit_price: l.unitPrice, discount_rate: '0', tax_rate: '0',
      }));
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price })), decimals);
      const o = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId, companyId: r.companyId, supplierId,
          purchaseRequestId: r.id, warehouseId, number, status: 'draft', requestedById: actorId,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: r.currency, createdById: actorId,
          lines: {
            create: r.lines.map((l) => ({
              productId: l.productId!, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, discountRate: 0, taxRate: 0,
              lineTotal: roundMoney(d(l.quantity).mul(d(l.unitPrice)), decimals),
            })),
          },
        },
      });
      await tx.purchaseRequest.update({ where: { id }, data: { status: 'ordered' } });
      await this.audit(tx, ctx, actorId, 'purchasing.pr_converted', 'purchase_request', id, { purchase_order_id: o.id, number }, ip);
      return { purchase_order: await this.purchaseOrderDto(tx, o.id) };
    });
  }

  // ================= RFQs (lightweight) =================
  //
  // An RFQ collects quoted prices from suppliers for a set of items
  // (optionally linked to a purchase request). Awarding picks the winning
  // supplier and converts the RFQ into a draft purchase order.

  async createRfq(ctx: OrgContext, dto: RfqCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      const replay = await this.checkIdempotency(tx, ctx, 'rfq', dto.idempotency_key);
      if (replay) return { rfq: await this.rfqDto(tx, replay.id), replayed: true };

      let prId: string | null = null;
      if (dto.purchase_request_id) {
        const pr = await tx.purchaseRequest.findUnique({ where: { id: dto.purchase_request_id } });
        if (!pr || pr.organizationId !== ctx.organizationId || pr.companyId !== dto.company_id) throw Errors.notFound('Purchase request');
        prId = pr.id;
      }
      const decimals = await this.baseDecimals(tx, dto.company_id);
      for (const l of dto.lines) {
        await this.scopedSupplier(tx, ctx, dto.company_id, l.supplier_id);
        if (l.product_id) await this.scopedProduct(tx, ctx, dto.company_id, l.product_id);
      }
      const subtotal = dto.lines.reduce(
        (s, l) => s.plus(d(l.quantity).mul(d(l.quoted_price ?? 0))), new Decimal(0),
      );
      const number = await this.numbering.nextNumber(dto.company_id, 'rfq');
      const r = await tx.rfq.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id,
          number, status: 'draft', purchaseRequestId: prId,
          subtotal: roundMoney(subtotal, decimals), total: roundMoney(subtotal, decimals),
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: dto.lines.map((l) => ({
              supplierId: l.supplier_id, productId: l.product_id ?? null,
              description: l.description, quantity: d(l.quantity),
              quotedPrice: l.quoted_price ? d(l.quoted_price) : null,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.rfq_created', 'rfq', r.id, { number }, ip);
      return { rfq: await this.rfqDto(tx, r.id), replayed: false };
    });
  }

  async listRfqs(ctx: OrgContext, companyId: string, q: { status?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.rfq.count({ where }),
      this.prisma.rfq.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status,
        total: d(r.total).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getRfq(ctx: OrgContext, id: string) {
    const r = await this.prisma.rfq.findUnique({ where: { id } });
    if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('RFQ');
    this.assertCompanyInScope(ctx, r.companyId);
    return this.prisma.$transaction((tx) => this.rfqDto(tx, id));
  }

  async transitionRfq(ctx: OrgContext, id: string, action: 'send' | 'cancel', actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.rfq.findUnique({ where: { id } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('RFQ');
      this.assertCompanyInScope(ctx, r.companyId);
      const to = action === 'send' ? 'sent' : 'cancelled';
      if (action === 'send' && r.status !== 'draft') throw Errors.invalidPurchasingTransition('rfq', r.status, to);
      if (action === 'cancel' && r.status !== 'draft' && r.status !== 'sent') throw Errors.invalidPurchasingTransition('rfq', r.status, to);
      await tx.rfq.update({ where: { id }, data: { status: to } });
      await this.audit(tx, ctx, actorId, `purchasing.rfq_${action}`, 'rfq', id, { from: r.status, to }, ip);
      return { rfq: await this.rfqDto(tx, id) };
    });
  }

  /** Record a supplier's quoted price on an RFQ line (while sent). */
  async recordRfqQuote(ctx: OrgContext, rfqId: string, lineId: string, quotedPrice: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.rfq.findUnique({ where: { id: rfqId }, include: { lines: true } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('RFQ');
      this.assertCompanyInScope(ctx, r.companyId);
      if (r.status !== 'sent') throw Errors.invalidPurchasingTransition('rfq', r.status, 'quote');
      const line = r.lines.find((l) => l.id === lineId);
      if (!line) throw Errors.notFound('RFQ line');
      await tx.rfqLine.update({ where: { id: lineId }, data: { quotedPrice: d(quotedPrice) } });
      const decimals = await this.baseDecimals(tx, r.companyId);
      const subtotal = r.lines.reduce(
        (s, l) => s.plus(d(l.id === lineId ? quotedPrice : l.quotedPrice ?? 0).mul(d(l.quantity))), new Decimal(0),
      );
      await tx.rfq.update({ where: { id: rfqId }, data: { subtotal: roundMoney(subtotal, decimals), total: roundMoney(subtotal, decimals) } });
      await this.audit(tx, ctx, actorId, 'purchasing.rfq_quoted', 'rfq', rfqId, { line_id: lineId, quoted_price: quotedPrice }, ip);
      return { rfq: await this.rfqDto(tx, rfqId) };
    });
  }

  /** Award the RFQ to a supplier: marks it awarded and creates a draft PO. */
  async awardRfq(ctx: OrgContext, id: string, dto: RfqAwardDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.rfq.findUnique({ where: { id }, include: { lines: true } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('RFQ');
      this.assertCompanyInScope(ctx, r.companyId);
      if (r.status !== 'sent') throw Errors.invalidPurchasingTransition('rfq', r.status, 'awarded');
      await this.scopedSupplier(tx, ctx, r.companyId, dto.supplier_id);
      await this.scopedWarehouse(tx, ctx, r.companyId, dto.warehouse_id);
      const decimals = await this.baseDecimals(tx, r.companyId);
      const warehouseId = dto.warehouse_id;

      const priceByLine = new Map((dto.lines ?? []).map((l) => [l.rfq_line_id, l.quoted_price]));
      const awardedLines = r.lines.filter((l) => l.supplierId === dto.supplier_id);
      if (awardedLines.length === 0) throw Errors.notFound('RFQ lines for supplier');
      for (const l of awardedLines) {
        const price = priceByLine.get(l.id) ?? (l.quotedPrice ? String(l.quotedPrice) : null);
        if (!price) throw Errors.purchasingDocNotDraft(`RFQ line ${l.id} has no quoted price`);
        if (!l.productId) throw Errors.notFound('Product');
        const p = await this.scopedProduct(tx, ctx, r.companyId, l.productId);
        if (p.type === 'service') throw Errors.invalidInventoryTransition(p.sku, 'service→purchasing');
      }

      const poLines = awardedLines.map((l) => {
        const price = priceByLine.get(l.id) ?? String(l.quotedPrice);
        const a = lineAmounts({ quantity: l.quantity, unit_price: price, discount_rate: '0', tax_rate: '0' }, decimals);
        return {
          productId: l.productId!, description: l.description, quantity: d(l.quantity),
          unitPrice: d(price), discountRate: new Decimal(0), taxRate: new Decimal(0), lineTotal: a.total,
        };
      });
      const totals = docTotals(poLines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice })), decimals);
      const number = await this.numbering.nextNumber(r.companyId, 'purchase_order');
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId, companyId: r.companyId, supplierId: dto.supplier_id,
          rfqId: r.id, warehouseId, number, status: 'draft', requestedById: actorId,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: r.currency, createdById: actorId,
          lines: { create: poLines },
        },
      });
      await tx.rfqLine.updateMany({ where: { rfqId: id }, data: { awarded: false } });
      await tx.rfqLine.updateMany({ where: { id: { in: awardedLines.map((l) => l.id) } }, data: { awarded: true } });
      await tx.rfq.update({ where: { id }, data: { status: 'awarded', supplierId: dto.supplier_id } });
      await this.audit(tx, ctx, actorId, 'purchasing.rfq_awarded', 'rfq', id, { supplier_id: dto.supplier_id, purchase_order_id: po.id }, ip);
      return { rfq: await this.rfqDto(tx, id), purchase_order: await this.purchaseOrderDto(tx, po.id) };
    });
  }

  // ================= purchase orders =================

  async createPurchaseOrder(ctx: OrgContext, dto: PurchaseOrderCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedSupplier(tx, ctx, dto.company_id, dto.supplier_id);
      await this.scopedWarehouse(tx, ctx, dto.company_id, dto.warehouse_id);
      const replay = await this.checkIdempotency(tx, ctx, 'purchaseOrder', dto.idempotency_key);
      if (replay) return { purchase_order: await this.purchaseOrderDto(tx, replay.id), replayed: true };

      let prId: string | null = null;
      if (dto.purchase_request_id) {
        const pr = await tx.purchaseRequest.findUnique({ where: { id: dto.purchase_request_id } });
        if (!pr || pr.organizationId !== ctx.organizationId || pr.companyId !== dto.company_id) throw Errors.notFound('Purchase request');
        if (pr.status !== 'approved' && pr.status !== 'ordered') throw Errors.invalidPurchasingTransition('purchase_request', pr.status, 'ordered');
        prId = pr.id;
      }
      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolvePricedLines(tx, ctx, dto.company_id, dto.lines, decimals);
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'purchase_order');

      const o = await tx.purchaseOrder.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, supplierId: dto.supplier_id,
          purchaseRequestId: prId, warehouseId: dto.warehouse_id,
          number, status: 'draft', requestedById: actorId,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId!, description: l.description, quantity: l.quantity,
              unitPrice: l.unitPrice, discountRate: l.discountRate, taxRate: l.taxRate,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.po_created', 'purchase_order', o.id, { number }, ip);
      return { purchase_order: await this.purchaseOrderDto(tx, o.id), replayed: false };
    });
  }

  async listPurchaseOrders(ctx: OrgContext, companyId: string, q: { status?: string; supplier_id?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.supplier_id) where.supplierId = q.supplier_id;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { supplier: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, supplier: r.supplier,
        total: d(r.total).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getPurchaseOrder(ctx: OrgContext, id: string) {
    const o = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
    this.assertCompanyInScope(ctx, o.companyId);
    return this.prisma.$transaction((tx) => this.purchaseOrderDto(tx, id));
  }

  /**
   * Submit a PO. Below the approval threshold it auto-approves;
   * at/above it stays `submitted` until a different user approves.
   */
  async submitPurchaseOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
      this.assertCompanyInScope(ctx, o.companyId);
      if (o.status !== 'draft') throw Errors.invalidPurchasingTransition('purchase_order', o.status, 'submitted');
      const data: Record<string, unknown> = {};
      let to = 'submitted';
      if (!approvalRequired(o.total)) {
        to = 'approved';
        data.approvedById = actorId;
        data.approvedAt = new Date();
      }
      await tx.purchaseOrder.update({ where: { id }, data: { ...data, status: to } });
      await this.audit(tx, ctx, actorId, 'purchasing.po_submitted', 'purchase_order', id, { to, auto_approved: to === 'approved' }, ip);
      if (to === 'submitted') {
        await this.notifications.notifyPermissionHolders(tx, ctx.organizationId, 'purchase_order', 'approve', {
          type: 'approval_request',
          titleAr: `طلب اعتماد أمر شراء ${o.number}`,
          titleEn: `Purchase order ${o.number} needs approval`,
          bodyAr: `بانتظار اعتمادك لأمر الشراء ${o.number} بقيمة ${o.total}`,
          bodyEn: `Purchase order ${o.number} (${o.total}) is waiting for your approval`,
          link: `/purchasing/orders/${id}`,
        }, actorId);
      }
      return { purchase_order: await this.purchaseOrderDto(tx, id) };
    });
  }

  async approvePurchaseOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
      this.assertCompanyInScope(ctx, o.companyId);
      if (o.status !== 'submitted') throw Errors.invalidPurchasingTransition('purchase_order', o.status, 'approved');
      if (o.requestedById === actorId) throw Errors.selfApprovalForbidden();
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'approved', approvedById: actorId, approvedAt: new Date() } });
      await this.audit(tx, ctx, actorId, 'purchasing.po_approved', 'purchase_order', id, { total: String(o.total) }, ip);
      if (o.requestedById && o.requestedById !== actorId) {
        await this.notifications.notify(tx, {
          organizationId: ctx.organizationId, userId: o.requestedById,
          type: 'approval_decision',
          titleAr: `تم اعتماد أمر الشراء ${o.number}`,
          titleEn: `Purchase order ${o.number} approved`,
          link: `/purchasing/orders/${id}`,
        });
      }
      return { purchase_order: await this.purchaseOrderDto(tx, id) };
    });
  }

  async rejectPurchaseOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
      this.assertCompanyInScope(ctx, o.companyId);
      if (o.status !== 'submitted') throw Errors.invalidPurchasingTransition('purchase_order', o.status, 'rejected');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'rejected' } });
      await this.audit(tx, ctx, actorId, 'purchasing.po_rejected', 'purchase_order', id, {}, ip);
      if (o.requestedById && o.requestedById !== actorId) {
        await this.notifications.notify(tx, {
          organizationId: ctx.organizationId, userId: o.requestedById,
          type: 'approval_decision',
          titleAr: `تم رفض أمر الشراء ${o.number}`,
          titleEn: `Purchase order ${o.number} rejected`,
          link: `/purchasing/orders/${id}`,
        });
      }
      return { purchase_order: await this.purchaseOrderDto(tx, id) };
    });
  }

  async cancelPurchaseOrder(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!o || o.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
      this.assertCompanyInScope(ctx, o.companyId);
      if (o.status !== 'draft' && o.status !== 'approved') throw Errors.invalidPurchasingTransition('purchase_order', o.status, 'cancelled');
      if (o.lines.some((l) => d(l.receivedQuantity).gt(0))) throw Errors.invalidPurchasingTransition('purchase_order', o.status, 'cancelled');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'cancelled' } });
      await this.audit(tx, ctx, actorId, 'purchasing.po_cancelled', 'purchase_order', id, {}, ip);
      return { purchase_order: await this.purchaseOrderDto(tx, id) };
    });
  }

  /** Recompute PO receive/bill status from its lines. */
  private async refreshPurchaseOrderStatus(tx: Tx, orderId: string) {
    const o = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    if (o.status === 'cancelled' || o.status === 'closed') return;
    const recvDone = o.lines.every((l) => d(l.receivedQuantity).gte(d(l.quantity)));
    const recvSome = o.lines.some((l) => d(l.receivedQuantity).gt(0));
    const billDone = o.lines.every((l) => d(l.billedQuantity).gte(d(l.quantity)));
    let status = o.status;
    if (billDone && recvDone) status = 'billed';
    else if (recvDone) status = 'received';
    else if (recvSome) status = 'partially_received';
    if (status !== o.status) await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
  }

  // ================= goods receipts =================

  async createGoodsReceipt(ctx: OrgContext, dto: GoodsReceiptCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchase_order_id }, include: { lines: true } });
      if (!po || po.organizationId !== ctx.organizationId) throw Errors.notFound('Purchase order');
      this.assertCompanyInScope(ctx, po.companyId);
      if (po.status !== 'approved' && po.status !== 'partially_received') {
        throw Errors.invalidPurchasingTransition('purchase_order', po.status, 'goods_receipt');
      }
      const warehouseId = dto.warehouse_id ?? po.warehouseId;
      await this.scopedWarehouse(tx, ctx, po.companyId, warehouseId);
      const replay = await this.checkIdempotency(tx, ctx, 'goodsReceipt', dto.idempotency_key);
      if (replay) return { goods_receipt: await this.goodsReceiptDto(tx, replay.id), replayed: true };

      const poLines = new Map(po.lines.map((l) => [l.id, l]));
      for (const l of dto.lines) {
        const pl = poLines.get(l.purchase_order_line_id);
        if (!pl) throw Errors.notFound('Purchase order line');
      }
      const number = await this.numbering.nextNumber(po.companyId, 'goods_receipt');
      const g = await tx.goodsReceipt.create({
        data: {
          organizationId: ctx.organizationId, companyId: po.companyId, purchaseOrderId: po.id,
          warehouseId, number, status: 'draft',
          receiptDate: dto.receipt_date ? new Date(dto.receipt_date + 'T00:00:00Z') : new Date(),
          notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: dto.lines.map((l) => {
              const pl = poLines.get(l.purchase_order_line_id)!;
              return {
                purchaseOrderLineId: pl.id, productId: pl.productId,
                quantity: d(l.quantity), unitCost: l.unit_cost ? d(l.unit_cost) : d(pl.unitPrice),
              };
            }),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.grn_created', 'goods_receipt', g.id, { number }, ip);
      return { goods_receipt: await this.goodsReceiptDto(tx, g.id), replayed: false };
    });
  }

  async listGoodsReceipts(ctx: OrgContext, companyId: string, q: { status?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.count({ where }),
      this.prisma.goodsReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status,
        receipt_date: r.receiptDate.toISOString().slice(0, 10), created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getGoodsReceipt(ctx: OrgContext, id: string) {
    const g = await this.prisma.goodsReceipt.findUnique({ where: { id } });
    if (!g || g.organizationId !== ctx.organizationId) throw Errors.notFound('Goods receipt');
    this.assertCompanyInScope(ctx, g.companyId);
    return this.prisma.$transaction((tx) => this.goodsReceiptDto(tx, id));
  }

  /**
   * Post a goods receipt: pre-validate every line (no over-receipt), then post
   * one immutable stock movement per line via the inventory engine (each atomic,
   * Dr 1310 / Cr 1320 GRNI), then flip the receipt + PO lines + PO status.
   * Line idempotency keys make a retried post replay safely.
   */
  async postGoodsReceipt(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    const g0 = await this.prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
    if (!g0 || g0.organizationId !== ctx.organizationId) throw Errors.notFound('Goods receipt');
    this.assertCompanyInScope(ctx, g0.companyId);
    if (g0.status !== 'draft') throw Errors.invalidPurchasingTransition('goods_receipt', g0.status, 'posted');

    // Pre-validation inside a transaction (row-locks the PO lines).
    const poLineIds = g0.lines.map((l) => l.purchaseOrderLineId);
    await this.prisma.$transaction(async (tx) => {
      for (const pid of poLineIds) {
        await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE id = ${pid}::uuid FOR UPDATE`;
      }
      const poLines = await tx.purchaseOrderLine.findMany({ where: { id: { in: poLineIds } }, include: { product: true } });
      const byId = new Map(poLines.map((l) => [l.id, l]));
      for (const l of g0.lines) {
        const pl = byId.get(l.purchaseOrderLineId)!;
        const remaining = d(pl.quantity).minus(d(pl.receivedQuantity));
        if (d(l.quantity).gt(remaining)) {
          throw Errors.overReceipt(pl.product.sku, remaining.toFixed(4), d(l.quantity).toFixed(4));
        }
      }
    });

    // Post one movement per line (each atomic in the inventory engine).
    const receiptDate = g0.receiptDate.toISOString().slice(0, 10);
    for (const l of g0.lines) {
      await this.inventory.receiveStock(ctx, {
        company_id: g0.companyId, warehouse_id: g0.warehouseId, product_id: l.productId,
        movement_type: 'receive', quantity: String(l.quantity), unit_cost: String(l.unitCost),
        movement_date: receiptDate, source_type: 'goods_receipt', source_id: g0.id,
        idempotency_key: `grn:${g0.id}:${l.id}`,
      }, actorId, ip);
    }

    // Flip receipt + PO lines + PO status.
    return this.prisma.$transaction(async (tx) => {
      const g = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (g.status === 'posted') return { goods_receipt: await this.goodsReceiptDto(tx, id), replayed: true };
      for (const l of g.lines) {
        await tx.purchaseOrderLine.update({
          where: { id: l.purchaseOrderLineId },
          data: { receivedQuantity: { increment: l.quantity } },
        });
      }
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'posted' } });
      await this.refreshPurchaseOrderStatus(tx, g.purchaseOrderId);
      await this.audit(tx, ctx, actorId, 'purchasing.grn_posted', 'goods_receipt', id, { lines: g.lines.length }, ip);
      return { goods_receipt: await this.goodsReceiptDto(tx, id), replayed: false };
    });
  }

  async cancelGoodsReceipt(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const g = await tx.goodsReceipt.findUnique({ where: { id } });
      if (!g || g.organizationId !== ctx.organizationId) throw Errors.notFound('Goods receipt');
      this.assertCompanyInScope(ctx, g.companyId);
      if (g.status !== 'draft') throw Errors.invalidPurchasingTransition('goods_receipt', g.status, 'cancelled');
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'cancelled' } });
      await this.audit(tx, ctx, actorId, 'purchasing.grn_cancelled', 'goods_receipt', id, {}, ip);
      return { goods_receipt: await this.goodsReceiptDto(tx, id) };
    });
  }

  // ================= supplier bills =================

  async createSupplierBill(ctx: OrgContext, dto: SupplierBillCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedSupplier(tx, ctx, dto.company_id, dto.supplier_id);
      const replay = await this.checkIdempotency(tx, ctx, 'supplierBill', dto.idempotency_key);
      if (replay) return { supplier_bill: await this.supplierBillDto(tx, replay.id), replayed: true };

      let poId: string | null = null;
      if (dto.purchase_order_id) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchase_order_id } });
        if (!po || po.organizationId !== ctx.organizationId || po.companyId !== dto.company_id) throw Errors.notFound('Purchase order');
        if (po.supplierId !== dto.supplier_id) throw Errors.notFound('Purchase order');
        poId = po.id;
      }
      const decimals = await this.baseDecimals(tx, dto.company_id);
      const lines = await this.resolvePricedLines(tx, ctx, dto.company_id, dto.lines, decimals);
      // Validate line references.
      for (let i = 0; i < dto.lines.length; i++) {
        const ref = dto.lines[i];
        if (ref.purchase_order_line_id) {
          const pl = await tx.purchaseOrderLine.findUnique({ where: { id: ref.purchase_order_line_id }, include: { purchaseOrder: true } });
          if (!pl || pl.purchaseOrder.companyId !== dto.company_id) throw Errors.notFound('Purchase order line');
        }
        if (ref.goods_receipt_line_id) {
          const gl = await tx.goodsReceiptLine.findUnique({ where: { id: ref.goods_receipt_line_id }, include: { goodsReceipt: true } });
          if (!gl || gl.goodsReceipt.companyId !== dto.company_id || gl.goodsReceipt.status !== 'posted') throw Errors.notFound('Goods receipt line');
        }
      }
      const totals = docTotals(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unitPrice, discount_rate: l.discountRate, tax_rate: l.taxRate })), decimals);
      const number = await this.numbering.nextNumber(dto.company_id, 'supplier_bill');

      const b = await tx.supplierBill.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, supplierId: dto.supplier_id,
          purchaseOrderId: poId, goodsReceiptId: dto.goods_receipt_id ?? null,
          number, supplierRef: dto.supplier_ref ?? null, status: 'draft',
          billDate: dto.bill_date ? new Date(dto.bill_date + 'T00:00:00Z') : new Date(),
          dueDate: dto.due_date ? new Date(dto.due_date + 'T00:00:00Z') : null,
          subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
          paidTotal: 0, outstanding: totals.total,
          currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: dto.lines.map((ref, i) => ({
              purchaseOrderLineId: ref.purchase_order_line_id ?? null,
              goodsReceiptLineId: ref.goods_receipt_line_id ?? null,
              productId: lines[i].productId, description: lines[i].description,
              quantity: lines[i].quantity, unitPrice: lines[i].unitPrice,
              discountRate: lines[i].discountRate, taxRate: lines[i].taxRate,
              lineTotal: lines[i].lineTotal,
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.bill_created', 'supplier_bill', b.id, { number }, ip);
      return { supplier_bill: await this.supplierBillDto(tx, b.id), replayed: false };
    });
  }

  async listSupplierBills(ctx: OrgContext, companyId: string, q: { status?: string; supplier_id?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.supplier_id) where.supplierId = q.supplier_id;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplierBill.count({ where }),
      this.prisma.supplierBill.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        include: { supplier: { select: { nameAr: true, nameEn: true, number: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, supplier: r.supplier,
        total: d(r.total).toFixed(4), outstanding: d(r.outstanding).toFixed(4),
        currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getSupplierBill(ctx: OrgContext, id: string) {
    const b = await this.prisma.supplierBill.findUnique({ where: { id } });
    if (!b || b.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier bill');
    this.assertCompanyInScope(ctx, b.companyId);
    return this.prisma.$transaction((tx) => this.supplierBillDto(tx, id));
  }

  async submitSupplierBill(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.supplierBill.findUnique({ where: { id } });
      if (!b || b.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier bill');
      this.assertCompanyInScope(ctx, b.companyId);
      if (b.status !== 'draft') throw Errors.invalidPurchasingTransition('supplier_bill', b.status, 'submitted');
      await tx.supplierBill.update({ where: { id }, data: { status: 'submitted' } });
      await this.audit(tx, ctx, actorId, 'purchasing.bill_submitted', 'supplier_bill', id, {}, ip);
      await this.notifications.notifyPermissionHolders(tx, ctx.organizationId, 'supplier_bill', 'approve', {
        type: 'approval_request',
        titleAr: `طلب اعتماد فاتورة مورد ${b.number}`,
        titleEn: `Supplier bill ${b.number} needs approval`,
        bodyAr: `بانتظار اعتمادك لفاتورة المورد ${b.number} بقيمة ${b.total}`,
        bodyEn: `Supplier bill ${b.number} (${b.total}) is waiting for your approval`,
        link: `/purchasing/bills/${id}`,
      }, actorId);
      return { supplier_bill: await this.supplierBillDto(tx, id) };
    });
  }

  async approveSupplierBill(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.supplierBill.findUnique({ where: { id } });
      if (!b || b.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier bill');
      this.assertCompanyInScope(ctx, b.companyId);
      if (b.status !== 'submitted') throw Errors.invalidPurchasingTransition('supplier_bill', b.status, 'approved');
      if (b.createdById === actorId) throw Errors.selfApprovalForbidden();
      await tx.supplierBill.update({ where: { id }, data: { status: 'approved', approvedById: actorId, approvedAt: new Date() } });
      await this.audit(tx, ctx, actorId, 'purchasing.bill_approved', 'supplier_bill', id, {}, ip);
      if (b.createdById && b.createdById !== actorId) {
        await this.notifications.notify(tx, {
          organizationId: ctx.organizationId, userId: b.createdById,
          type: 'approval_decision',
          titleAr: `تم اعتماد فاتورة المورد ${b.number}`,
          titleEn: `Supplier bill ${b.number} approved`,
          link: `/purchasing/bills/${id}`,
        });
      }
      return { supplier_bill: await this.supplierBillDto(tx, id) };
    });
  }

  /**
   * Post a supplier bill: run 2-way/3-way matching first (variances beyond
   * tolerance block posting), then clear GRNI — Dr 1320 / Dr 1230 / Cr 2110 —
   * in the same transaction. Inventory is never double-recognized: the goods
   * receipt already debited it once.
   */
  async postSupplierBill(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.supplierBill.findUnique({ where: { id }, include: { lines: true } });
      if (!b || b.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier bill');
      this.assertCompanyInScope(ctx, b.companyId);
      if (b.status !== 'approved') throw Errors.invalidPurchasingTransition('supplier_bill', b.status, 'posted');

      // ---- matching ----
      // Compare NET unit price (before tax/discount) against receipt/PO cost.
      const reasons: string[] = [];
      for (const l of b.lines) {
        const netUnit = d(l.unitPrice).times(new Decimal(1).minus(d(l.discountRate ?? 0).div(100)));
        if (l.goodsReceiptLineId) {
          const gl = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.goodsReceiptLineId } });
          const r = matchLine(
            { quantity: l.quantity, unit_price: netUnit },
            { quantity: gl.quantity, unit_price: gl.unitCost },
          );
          if (!r.ok) reasons.push(`line ${l.description}: 3-way ${r.reasons.join(', ')}`);
        } else if (l.purchaseOrderLineId) {
          const pl = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.purchaseOrderLineId } });
          const r = matchLine(
            { quantity: l.quantity, unit_price: netUnit },
            { quantity: pl.quantity, unit_price: pl.unitPrice },
          );
          if (!r.ok) reasons.push(`line ${l.description}: 2-way ${r.reasons.join(', ')}`);
        }
      }
      if (reasons.length > 0) throw Errors.matchVarianceBlocked(reasons);

      // ---- GL: clear GRNI ----
      const idemKey = idempotencyKey ?? `gl:bill:${b.id}`;
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const grni = await this.resolveAccount(tx, b.companyId, ACCT.grni);
        const inputVat = await this.resolveAccount(tx, b.companyId, ACCT.inputVat);
        const ap = await this.resolveAccount(tx, b.companyId, ACCT.ap);
        const decimals = await this.baseDecimals(tx, b.companyId);
        const netGoods = roundMoney(d(b.subtotal), decimals);
        const vat = roundMoney(d(b.taxTotal), decimals);
        const total = roundMoney(d(b.total), decimals);
        const glLines: Array<{ account_id: string; debit: Decimal; credit: Decimal }> = [
          { account_id: grni, debit: netGoods, credit: new Decimal(0) },
          { account_id: ap, debit: new Decimal(0), credit: total },
        ];
        if (vat.gt(0)) glLines.splice(1, 0, { account_id: inputVat, debit: vat, credit: new Decimal(0) });
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: b.companyId,
          journal_type: 'supplier_bill',
          posting_date: b.billDate.toISOString().slice(0, 10),
          description: `Supplier bill ${b.number}`,
          source_type: 'supplier_bill', source_id: b.id,
          idempotency_key: idemKey,
          lines: glLines,
        }, actorId, ip);
        journalId = gl.id;
      }

      // ---- PO billed quantities ----
      for (const l of b.lines) {
        if (l.purchaseOrderLineId) {
          await tx.purchaseOrderLine.update({
            where: { id: l.purchaseOrderLineId },
            data: { billedQuantity: { increment: l.quantity } },
          });
        }
      }
      const poIds = new Set(
        (await tx.purchaseOrderLine.findMany({ where: { id: { in: b.lines.map((l) => l.purchaseOrderLineId).filter(Boolean) as string[] } }, select: { purchaseOrderId: true } }))
          .map((l) => l.purchaseOrderId),
      );
      if (b.purchaseOrderId) poIds.add(b.purchaseOrderId);
      for (const poId of poIds) await this.refreshPurchaseOrderStatus(tx, poId);

      await tx.supplierBill.update({ where: { id }, data: { status: 'posted' } });
      await this.audit(tx, ctx, actorId, 'purchasing.bill_posted', 'supplier_bill', id, { journal_id: journalId }, ip);
      return { supplier_bill: await this.supplierBillDto(tx, id), journal_id: journalId };
    });
  }

  // ================= supplier payments =================

  async createSupplierPayment(ctx: OrgContext, dto: SupplierPaymentCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const company = await this.scopedCompany(tx, ctx, dto.company_id);
      await this.scopedSupplier(tx, ctx, dto.company_id, dto.supplier_id);
      const replay = await this.checkIdempotency(tx, ctx, 'supplierPayment', dto.idempotency_key);
      if (replay) return { supplier_payment: await this.supplierPaymentDto(tx, replay.id), replayed: true };

      const decimals = await this.baseDecimals(tx, dto.company_id);
      const amount = roundMoney(d(dto.amount), decimals);
      let allocTotal = new Decimal(0);
      for (const a of dto.allocations) {
        const bill = await tx.supplierBill.findUnique({ where: { id: a.supplier_bill_id } });
        if (!bill || bill.organizationId !== ctx.organizationId || bill.companyId !== dto.company_id) throw Errors.notFound('Supplier bill');
        if (bill.supplierId !== dto.supplier_id) throw Errors.notFound('Supplier bill');
        if (bill.status !== 'posted' && bill.status !== 'partially_paid') throw Errors.billNotPosted(bill.number);
        if (d(a.amount).gt(d(bill.outstanding))) throw Errors.overBillAllocation(bill.number, d(bill.outstanding).toFixed(decimals), d(a.amount).toFixed(decimals));
        allocTotal = allocTotal.plus(d(a.amount));
      }
      if (!allocTotal.eq(amount)) throw Errors.overBillAllocation('payment', amount.toFixed(decimals), allocTotal.toFixed(decimals));
      const number = await this.numbering.nextNumber(dto.company_id, 'supplier_payment');

      const p = await tx.supplierPayment.create({
        data: {
          organizationId: ctx.organizationId, companyId: dto.company_id, supplierId: dto.supplier_id,
          number, status: 'draft',
          paymentDate: dto.payment_date ? new Date(dto.payment_date + 'T00:00:00Z') : new Date(),
          amount, currency: company.baseCurrency, notes: dto.notes ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          allocations: {
            create: dto.allocations.map((a) => ({
              organizationId: ctx.organizationId,
              supplierBillId: a.supplier_bill_id, amount: roundMoney(d(a.amount), decimals),
            })),
          },
        },
      });
      await this.audit(tx, ctx, actorId, 'purchasing.spay_created', 'supplier_payment', p.id, { number }, ip);
      return { supplier_payment: await this.supplierPaymentDto(tx, p.id), replayed: false };
    });
  }

  async listSupplierPayments(ctx: OrgContext, companyId: string, q: { status?: string; supplier_id?: string; page?: number; per_page?: number }) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (q.status) where.status = q.status;
    if (q.supplier_id) where.supplierId = q.supplier_id;
    const page = q.page ?? 1, perPage = q.per_page ?? 20;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplierPayment.count({ where }),
      this.prisma.supplierPayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id, number: r.number, status: r.status,
        amount: d(r.amount).toFixed(4), currency: r.currency, created_at: r.createdAt.toISOString(),
      })),
      meta: pageMeta(total, page, perPage),
    };
  }

  async getSupplierPayment(ctx: OrgContext, id: string) {
    const p = await this.prisma.supplierPayment.findUnique({ where: { id } });
    if (!p || p.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier payment');
    this.assertCompanyInScope(ctx, p.companyId);
    return this.prisma.$transaction((tx) => this.supplierPaymentDto(tx, id));
  }

  /** Post a supplier payment: Dr 2110 AP / Cr 1110 Bank, allocations drive bill status. */
  async postSupplierPayment(ctx: OrgContext, id: string, actorId: string, ip?: string, idempotencyKey?: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.supplierPayment.findUnique({ where: { id }, include: { allocations: true } });
      if (!p || p.organizationId !== ctx.organizationId) throw Errors.notFound('Supplier payment');
      this.assertCompanyInScope(ctx, p.companyId);
      if (p.status !== 'draft') throw Errors.invalidPurchasingTransition('supplier_payment', p.status, 'posted');

      const idemKey = idempotencyKey ?? `gl:spay:${p.id}`;
      const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: idemKey } });
      let journalId: string;
      if (existing) {
        journalId = existing.id;
      } else {
        const ap = await this.resolveAccount(tx, p.companyId, ACCT.ap);
        const bank = await this.resolveAccount(tx, p.companyId, ACCT.bank);
        const amount = d(p.amount);
        const gl = await this.accounting.postSystemEntry(tx, ctx, {
          company_id: p.companyId,
          journal_type: 'supplier_payment',
          posting_date: p.paymentDate.toISOString().slice(0, 10),
          description: `Supplier payment ${p.number}`,
          source_type: 'supplier_payment', source_id: p.id,
          idempotency_key: idemKey,
          lines: [
            { account_id: ap, debit: amount, credit: new Decimal(0) },
            { account_id: bank, debit: new Decimal(0), credit: amount },
          ],
        }, actorId, ip);
        journalId = gl.id;
      }

      const decimals = await this.baseDecimals(tx, p.companyId);
      for (const a of p.allocations) {
        const bill = await tx.supplierBill.findUniqueOrThrow({ where: { id: a.supplierBillId } });
        const { outstanding, paidTotal } = applyBillAllocation(bill.outstanding, bill.paidTotal, a.amount, decimals);
        const status = billPayStatus(outstanding, d(bill.total));
        await tx.supplierBill.update({
          where: { id: bill.id },
          data: { outstanding, paidTotal, status },
        });
      }

      await tx.supplierPayment.update({ where: { id }, data: { status: 'posted', journalEntryId: journalId } });
      await this.audit(tx, ctx, actorId, 'purchasing.spay_posted', 'supplier_payment', id, { journal_id: journalId }, ip);
      return { supplier_payment: await this.supplierPaymentDto(tx, id), journal_id: journalId };
    });
  }
}
