import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { NumberingService } from '../masterdata/numbering';
import { NotificationService } from '../notifications/notifications.service';
import { Errors } from '../common/errors';
import { OrgContext } from '../common/request.types';
import { pageMeta } from '../common/pagination';
import Decimal from 'decimal.js';
import { toDecimal, roundMoney } from '../accounting/money';
import { WeightedAveragePolicy, ValuationPolicy } from './valuation';
import type {
  StockMovementCreateDto, StockReservationCreateDto, StockBalanceQuery,
  InventoryTransferCreateDto, InventoryAdjustmentCreateDto,
  InventoryCountCreateDto, InventoryCountLinesDto, StockMovementListQuery,
} from '@atlas-erp/contracts';

type Tx = Prisma.TransactionClient;

/** Cost impact above which an adjustment must be approved before posting. */
const ADJUSTMENT_AUTO_APPROVE_LIMIT = new Decimal(10000);

interface Balance {
  onHand: Decimal;
  reserved: Decimal;
  available: Decimal;
  avgCost: Decimal;
}

interface ResolvedAccounts {
  inventory: string;
  grni: string;
  cogs: string;
  adjustment: string;
}

const d = (v: unknown): Decimal => toDecimal(String(v ?? 0));

@Injectable()
export class InventoryService {
  private readonly valuation: ValuationPolicy = new WeightedAveragePolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationService,
  ) {}

  // ================= helpers =================

  /** Serialize all inventory writes for one product (race-safe available checks). */
  private async lockProduct(tx: Tx, productId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
  }

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  private async scopedProduct(tx: Tx, ctx: OrgContext, productId: string) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { company: true },
    });
    if (!product) throw Errors.notFound('Product');
    if (product.company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, product.companyId);
    if (!product.isActive) throw Errors.notFound('Product');
    return product;
  }

  private assertStocked(product: { type: string; sku: string }) {
    if (product.type !== 'stocked') throw Errors.productNotStocked(product.sku);
  }

  private async scopedWarehouse(tx: Tx, ctx: OrgContext, warehouseId: string) {
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      include: { branch: true },
    });
    if (!warehouse) throw Errors.notFound('Warehouse');
    const branch = await tx.branch.findUnique({
      where: { id: warehouse.branchId },
      include: { company: true },
    });
    if (!branch || branch.company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, branch.companyId);
    if (warehouse.status !== 'active') throw Errors.notFound('Warehouse');
    return { warehouse, companyId: branch.companyId };
  }

  private async balanceOf(tx: Tx, companyId: string, warehouseId: string, productId: string): Promise<Balance> {
    const mov = await tx.stockMovement.aggregate({
      _sum: { quantity: true },
      where: { companyId, warehouseId, productId },
    });
    const res = await tx.stockReservation.aggregate({
      _sum: { quantity: true },
      where: { companyId, warehouseId, productId, status: 'active' },
    });
    const onHand = d(mov._sum.quantity);
    const reserved = d(res._sum.quantity);
    const latest = await tx.inventoryValuationEntry.findFirst({
      where: { companyId, warehouseId, productId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      onHand,
      reserved,
      available: onHand.minus(reserved),
      avgCost: latest ? d(latest.resultingAvgCost) : new Decimal(0),
    };
  }

  private async resolveAccounts(tx: Tx, companyId: string, product: { inventoryAccountId: string | null; cogsAccountId: string | null }): Promise<ResolvedAccounts> {
    const byCode = async (code: string, what: string): Promise<string> => {
      const a = await tx.account.findFirst({ where: { companyId, code } });
      if (!a) throw Errors.productAccountInvalid(
        `${what} account (${code}) is not configured for this company.`,
        `حساب ${what} (${code}) غير مُعدّ لهذه الشركة.`,
      );
      return a.id;
    };
    return {
      inventory: product.inventoryAccountId ?? (await byCode('1310', 'inventory / المخزون')),
      grni: await byCode('1320', 'GRNI / البضاعة المستلمة غير المفوترة'),
      cogs: product.cogsAccountId ?? (await byCode('5110', 'COGS / تكلفة البضاعة المباعة')),
      adjustment: await byCode('5390', 'inventory adjustment / تسويات المخزون'),
    };
  }

  private async baseDecimals(tx: Tx, companyId: string): Promise<number> {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const cur = await tx.currency.findUnique({ where: { code: company.baseCurrency } });
    return cur?.decimals ?? 2;
  }

  private money(v: Decimal, decimals: number): Decimal {
    return roundMoney(v, decimals);
  }

  private async audit(tx: Tx, ctx: OrgContext, actorId: string, action: string, entityType: string, entityId: string, diff?: object, ip?: string) {
    await tx.auditEvent.create({
      data: {
        organizationId: ctx.organizationId, actorId, action,
        entityType, entityId, diff: (diff ?? undefined) as object | undefined, ip: ip ?? null,
      },
    });
  }

  private movementDto(m: {
    id: string; companyId: string; warehouseId: string; locationId: string | null;
    productId: string; movementType: string; quantity: unknown; unitCost: unknown;
    totalCost: unknown; sourceType: string | null; sourceId: string | null;
    movementDate: Date; createdAt: Date;
  }) {
    return {
      id: m.id,
      company_id: m.companyId,
      warehouse_id: m.warehouseId,
      location_id: m.locationId,
      product_id: m.productId,
      movement_type: m.movementType,
      quantity: d(m.quantity).toFixed(4),
      unit_cost: d(m.unitCost).toFixed(4),
      total_cost: d(m.totalCost).toFixed(4),
      source_type: m.sourceType,
      source_id: m.sourceId,
      movement_date: m.movementDate.toISOString().slice(0, 10),
      created_at: m.createdAt.toISOString(),
    };
  }

  // ================= core movement writer =================

  private async applyMovement(
    tx: Tx, ctx: OrgContext, actorId: string, ip: string | undefined,
    args: {
      companyId: string; warehouseId: string; locationId?: string;
      productId: string; movementType: string;
      quantityDelta: Decimal; unitCost: Decimal;
      sourceType?: string; sourceId?: string;
      movementDate?: string; idempotencyKey?: string;
    },
  ) {
    const bal = await this.balanceOf(tx, args.companyId, args.warehouseId, args.productId);
    const state = { qty: bal.onHand, avgCost: bal.avgCost };
    const res = args.quantityDelta.gte(0)
      ? this.valuation.receive(state, args.quantityDelta, args.unitCost)
      : this.valuation.issue(state, args.quantityDelta.abs());
    const movement = await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: args.companyId,
        warehouseId: args.warehouseId,
        locationId: args.locationId ?? null,
        productId: args.productId,
        movementType: args.movementType,
        quantity: res.quantityDelta,
        unitCost: res.movementUnitCost,
        totalCost: res.costDelta,
        sourceType: args.sourceType ?? null,
        sourceId: args.sourceId ?? null,
        movementDate: new Date((args.movementDate ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
        idempotencyKey: args.idempotencyKey ?? null,
        createdById: actorId,
      },
    });
    await tx.inventoryValuationEntry.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: args.companyId,
        warehouseId: args.warehouseId,
        productId: args.productId,
        movementId: movement.id,
        quantityDelta: res.quantityDelta,
        costDelta: res.costDelta,
        resultingQty: res.resultingQty,
        resultingAvgCost: res.resultingAvgCost,
      },
    });
    return { movement, valuation: res };
  }

  // ================= receive / issue / return / opening =================

  private async doReceive(
    ctx: OrgContext, dto: StockMovementCreateDto, actorId: string, ip: string | undefined,
    movementType: 'receive' | 'opening' | 'return',
  ) {
    const qty = toDecimal(dto.quantity);
    const unitCost = toDecimal(dto.unit_cost);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.scopedProduct(tx, ctx, dto.product_id);
      this.assertStocked(product);
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      await this.lockProduct(tx, product.id);

      if (dto.idempotency_key) {
        const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: dto.idempotency_key } });
        if (existing) return { movement: this.movementDto(existing), replayed: true, journal_id: null as string | null };
      }
      if (movementType === 'opening') {
        const count = await tx.stockMovement.count({ where: { companyId, warehouseId: dto.warehouse_id, productId: product.id } });
        if (count > 0) throw Errors.openingStockExists(product.sku);
      }

      const { movement, valuation } = await this.applyMovement(tx, ctx, actorId, ip, {
        companyId, warehouseId: dto.warehouse_id, locationId: dto.location_id,
        productId: product.id, movementType,
        quantityDelta: qty, unitCost,
        sourceType: dto.source_type, sourceId: dto.source_id,
        movementDate: dto.movement_date, idempotencyKey: dto.idempotency_key,
      });

      // ---- GL (atomic, same transaction) ----
      const decimals = await this.baseDecimals(tx, companyId);
      const accounts = await this.resolveAccounts(tx, companyId, product);
      const total = this.money(valuation.costDelta, decimals);
      // Opening stock is offset to retained earnings (opening equity);
      // regular receipts clear through GRNI (matched by the supplier bill later).
      let offsetAccount = accounts.grni;
      if (movementType === 'opening') {
        const re = await tx.account.findFirst({ where: { companyId, code: '3020' } });
        if (!re) throw Errors.productAccountInvalid(
          'Opening equity account (3020) is not configured for this company.',
          'حساب الأرباح المحتجزة (3020) غير مُعدّ لهذه الشركة.',
        );
        offsetAccount = re.id;
      }
      const gl = await this.accounting.postSystemEntry(tx, ctx, {
        company_id: companyId,
        posting_date: dto.movement_date ?? new Date().toISOString().slice(0, 10),
        description: movementType === 'opening' ? `Opening stock ${product.sku}` : `Goods receipt ${product.sku} × ${qty.toFixed(4)}`,
        journal_type: movementType === 'opening' ? 'inventory_opening' : 'inventory_receipt',
        source_type: 'stock_movement',
        source_id: movement.id,
        idempotency_key: dto.idempotency_key ? `gl:${dto.idempotency_key}` : `gl:mov:${movement.id}`,
        lines: [
          { account_id: accounts.inventory, debit: total, credit: new Decimal(0) },
          { account_id: offsetAccount, debit: new Decimal(0), credit: total },
        ],
      }, actorId, ip);

      await this.audit(tx, ctx, actorId, 'inventory.received', 'stock_movement', movement.id,
        { product_id: product.id, quantity: qty.toFixed(4), unit_cost: unitCost.toFixed(4) }, ip);
      return { movement: this.movementDto(movement), replayed: false, journal_id: gl.id };
    });
  }

  async receiveStock(ctx: OrgContext, dto: StockMovementCreateDto, actorId: string, ip?: string) {
    if (dto.movement_type !== 'receive') throw Errors.invalidInventoryTransition(dto.movement_type, 'receive');
    return this.doReceive(ctx, dto, actorId, ip, 'receive');
  }

  async openingStock(ctx: OrgContext, dto: StockMovementCreateDto, actorId: string, ip?: string) {
    if (dto.movement_type !== 'opening') throw Errors.invalidInventoryTransition(dto.movement_type, 'opening');
    return this.doReceive(ctx, dto, actorId, ip, 'opening');
  }

  /** Customer/supplier return restocked at its original cost. */
  async returnStock(ctx: OrgContext, dto: StockMovementCreateDto & { original_unit_cost?: string }, actorId: string, ip?: string) {
    const qty = toDecimal(dto.quantity);
    const originalCost = toDecimal(dto.original_unit_cost ?? dto.unit_cost);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.scopedProduct(tx, ctx, dto.product_id);
      this.assertStocked(product);
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      await this.lockProduct(tx, product.id);

      if (dto.idempotency_key) {
        const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: dto.idempotency_key } });
        if (existing) return { movement: this.movementDto(existing), replayed: true, journal_id: null as string | null };
      }

      const bal = await this.balanceOf(tx, companyId, dto.warehouse_id, product.id);
      const res = this.valuation.returnStock({ qty: bal.onHand, avgCost: bal.avgCost }, qty, originalCost);
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          locationId: dto.location_id ?? null, productId: product.id, movementType: 'return',
          quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
          sourceType: dto.source_type ?? null, sourceId: dto.source_id ?? null,
          movementDate: new Date((dto.movement_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
        },
      });
      await tx.inventoryValuationEntry.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          productId: product.id, movementId: movement.id,
          quantityDelta: res.quantityDelta, costDelta: res.costDelta,
          resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
        },
      });

      const decimals = await this.baseDecimals(tx, companyId);
      const accounts = await this.resolveAccounts(tx, companyId, product);
      const total = this.money(res.costDelta, decimals);
      const gl = await this.accounting.postSystemEntry(tx, ctx, {
        company_id: companyId,
        posting_date: dto.movement_date ?? new Date().toISOString().slice(0, 10),
        description: `Customer return ${product.sku} × ${qty.toFixed(4)}`,
        journal_type: 'inventory_return',
        source_type: 'stock_movement', source_id: movement.id,
        idempotency_key: dto.idempotency_key ? `gl:${dto.idempotency_key}` : `gl:mov:${movement.id}`,
        lines: [
          { account_id: accounts.inventory, debit: total, credit: new Decimal(0) },
          { account_id: accounts.cogs, debit: new Decimal(0), credit: total },
        ],
      }, actorId, ip);

      await this.audit(tx, ctx, actorId, 'inventory.returned', 'stock_movement', movement.id,
        { product_id: product.id, quantity: qty.toFixed(4) }, ip);
      return { movement: this.movementDto(movement), replayed: false, journal_id: gl.id };
    });
  }

  async issueStock(
    ctx: OrgContext,
    dto: StockMovementCreateDto & { reservation_id?: string },
    actorId: string, ip?: string,
  ) {
    const qty = toDecimal(dto.quantity);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.scopedProduct(tx, ctx, dto.product_id);
      this.assertStocked(product);
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      await this.lockProduct(tx, product.id);

      if (dto.idempotency_key) {
        const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: dto.idempotency_key } });
        if (existing) return { movement: this.movementDto(existing), replayed: true, journal_id: null as string | null, cogs: '0.0000' };
      }

      const bal = await this.balanceOf(tx, companyId, dto.warehouse_id, product.id);
      if (bal.available.lt(qty)) throw Errors.insufficientStock(product.sku, bal.available.toFixed(4), qty.toFixed(4));

      // Consume reservations: the named one if provided, else oldest-first (FIFO).
      if (dto.reservation_id) {
        const r = await tx.stockReservation.findUnique({ where: { id: dto.reservation_id } });
        if (!r || r.status !== 'active' || r.productId !== product.id || r.warehouseId !== dto.warehouse_id) {
          throw Errors.notFound('Reservation');
        }
        const rq = d(r.quantity);
        if (rq.lte(qty)) {
          await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'consumed' } });
        } else {
          await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: rq.minus(qty) } });
        }
      } else {
        let remaining = qty;
        const actives = await tx.stockReservation.findMany({
          where: { companyId, warehouseId: dto.warehouse_id, productId: product.id, status: 'active' },
          orderBy: { createdAt: 'asc' },
        });
        for (const r of actives) {
          if (remaining.lte(0)) break;
          const rq = d(r.quantity);
          if (rq.lte(remaining)) {
            await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'consumed' } });
            remaining = remaining.minus(rq);
          } else {
            await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: rq.minus(remaining) } });
            remaining = d(0);
          }
        }
      }

      const res = this.valuation.issue({ qty: bal.onHand, avgCost: bal.avgCost }, qty);
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          locationId: dto.location_id ?? null, productId: product.id, movementType: 'issue',
          quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
          sourceType: dto.source_type ?? null, sourceId: dto.source_id ?? null,
          movementDate: new Date((dto.movement_date ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'),
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
        },
      });
      await tx.inventoryValuationEntry.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          productId: product.id, movementId: movement.id,
          quantityDelta: res.quantityDelta, costDelta: res.costDelta,
          resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
        },
      });

      const decimals = await this.baseDecimals(tx, companyId);
      const accounts = await this.resolveAccounts(tx, companyId, product);
      const cogs = this.money(res.costDelta.abs(), decimals);
      const gl = await this.accounting.postSystemEntry(tx, ctx, {
        company_id: companyId,
        posting_date: dto.movement_date ?? new Date().toISOString().slice(0, 10),
        description: `Stock issue ${product.sku} × ${qty.toFixed(4)}`,
        journal_type: 'inventory_issue',
        source_type: 'stock_movement', source_id: movement.id,
        idempotency_key: dto.idempotency_key ? `gl:${dto.idempotency_key}` : `gl:mov:${movement.id}`,
        lines: [
          { account_id: accounts.cogs, debit: cogs, credit: new Decimal(0) },
          { account_id: accounts.inventory, debit: new Decimal(0), credit: cogs },
        ],
      }, actorId, ip);

      await this.audit(tx, ctx, actorId, 'inventory.issued', 'stock_movement', movement.id,
        { product_id: product.id, quantity: qty.toFixed(4), cogs: cogs.toFixed(decimals) }, ip);
      const afterBal = await this.balanceOf(tx, companyId, dto.warehouse_id, product.id);
      if (product.reorderLevel != null && afterBal.available.lt(d(product.reorderLevel))) {
        await this.notifications.notifyPermissionHolders(tx, ctx.organizationId, 'stock_movement', 'view', {
          type: 'low_stock',
          titleAr: `مخزون منخفض: ${product.nameAr} (${product.sku})`,
          titleEn: `Low stock: ${product.nameEn} (${product.sku})`,
          bodyAr: `المتاح ${afterBal.available.toFixed(2)} أقل من حد إعادة الطلب ${d(product.reorderLevel).toFixed(2)}`,
          bodyEn: `Available ${afterBal.available.toFixed(2)} below reorder level ${d(product.reorderLevel).toFixed(2)}`,
          link: `/inventory/balances`,
        });
      }
      return { movement: this.movementDto(movement), replayed: false, journal_id: gl.id, cogs: cogs.toFixed(decimals) };
    });
  }

  // ================= reservations =================

  async reserveStock(ctx: OrgContext, dto: StockReservationCreateDto, actorId: string, ip?: string) {
    const qty = toDecimal(dto.quantity);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.scopedProduct(tx, ctx, dto.product_id);
      this.assertStocked(product);
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      await this.lockProduct(tx, product.id);

      if (dto.idempotency_key) {
        const existing = await tx.stockReservation.findUnique({ where: { idempotencyKey: dto.idempotency_key } });
        if (existing) return { reservation: this.reservationDto(existing), replayed: true };
      }

      const bal = await this.balanceOf(tx, companyId, dto.warehouse_id, product.id);
      if (bal.available.lt(qty)) throw Errors.insufficientStock(product.sku, bal.available.toFixed(4), qty.toFixed(4));

      const reservation = await tx.stockReservation.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          productId: product.id, quantity: qty, status: 'active',
          sourceType: dto.source_type ?? null, sourceId: dto.source_id ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
        },
      });
      await this.audit(tx, ctx, actorId, 'inventory.reserved', 'stock_reservation', reservation.id,
        { product_id: product.id, quantity: qty.toFixed(4) }, ip);
      return { reservation: this.reservationDto(reservation), replayed: false };
    });
  }

  async releaseReservation(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.stockReservation.findUnique({ where: { id } });
      if (!r || r.organizationId !== ctx.organizationId) throw Errors.notFound('Reservation');
      this.assertCompanyInScope(ctx, r.companyId);
      if (r.status !== 'active') throw Errors.invalidInventoryTransition(r.status, 'released');
      const updated = await tx.stockReservation.update({ where: { id }, data: { status: 'released' } });
      await this.audit(tx, ctx, actorId, 'inventory.reservation_released', 'stock_reservation', id, undefined, ip);
      return { reservation: this.reservationDto(updated) };
    });
  }

  private reservationDto(r: {
    id: string; companyId: string; warehouseId: string; productId: string;
    quantity: unknown; status: string; sourceType: string | null; sourceId: string | null; createdAt: Date;
  }) {
    return {
      id: r.id, company_id: r.companyId, warehouse_id: r.warehouseId, product_id: r.productId,
      quantity: d(r.quantity).toFixed(4), status: r.status,
      source_type: r.sourceType, source_id: r.sourceId,
      created_at: r.createdAt.toISOString(),
    };
  }

  async listReservations(ctx: OrgContext, companyId: string, warehouseId?: string, productId?: string, status?: string, page = 1, perPage = 20) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (productId) where.productId = productId;
    if (status) where.status = status;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockReservation.count({ where }),
      this.prisma.stockReservation.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage,
        include: { product: { select: { sku: true, nameAr: true, nameEn: true } } },
      }),
    ]);
    return {
      data: rows.map((r) => ({ ...this.reservationDto(r), product: r.product })),
      meta: pageMeta(total, page, perPage),
    };
  }

  // ================= transfers =================

  private transferDto(t: {
    id: string; companyId: string; fromWarehouseId: string; toWarehouseId: string;
    number: string; status: string; createdAt: Date;
    lines?: Array<{ id: string; productId: string; quantity: unknown }>;
  }) {
    return {
      id: t.id, company_id: t.companyId,
      from_warehouse_id: t.fromWarehouseId, to_warehouse_id: t.toWarehouseId,
      number: t.number, status: t.status, created_at: t.createdAt.toISOString(),
      lines: (t.lines ?? []).map((l) => ({
        id: l.id, product_id: l.productId, quantity: d(l.quantity).toFixed(4),
      })),
    };
  }

  private async scopedTransfer(tx: Tx, ctx: OrgContext, id: string) {
    const t = await tx.inventoryTransfer.findUnique({
      where: { id }, include: { lines: true },
    });
    if (!t || t.organizationId !== ctx.organizationId) throw Errors.notFound('Transfer');
    this.assertCompanyInScope(ctx, t.companyId);
    return t;
  }

  async createTransfer(ctx: OrgContext, dto: InventoryTransferCreateDto, actorId: string, ip?: string) {
    if (dto.from_warehouse_id === dto.to_warehouse_id) throw Errors.sameWarehouseTransfer();
    return this.prisma.$transaction(async (tx) => {
      const from = await this.scopedWarehouse(tx, ctx, dto.from_warehouse_id);
      const to = await this.scopedWarehouse(tx, ctx, dto.to_warehouse_id);
      if (from.companyId !== to.companyId) throw Errors.accountCompanyMismatch();
      const companyId = from.companyId;

      if (dto.idempotency_key) {
        const existing = await tx.inventoryTransfer.findUnique({
          where: { idempotencyKey: dto.idempotency_key },
          include: { lines: true },
        });
        if (existing) return { transfer: this.transferDto(existing), replayed: true };
      }

      // Validate all lines are stocked products of this company.
      for (const line of dto.lines) {
        const product = await this.scopedProduct(tx, ctx, line.product_id);
        this.assertStocked(product);
        if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      }

      const number = await this.numbering.nextNumber(companyId, 'inventory_transfer');
      const transfer = await tx.inventoryTransfer.create({
        data: {
          organizationId: ctx.organizationId, companyId,
          fromWarehouseId: dto.from_warehouse_id, toWarehouseId: dto.to_warehouse_id,
          number, status: 'draft',
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: { create: dto.lines.map((l) => ({ productId: l.product_id, quantity: toDecimal(l.quantity) })) },
        },
        include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.transfer_created', 'inventory_transfer', transfer.id, { number }, ip);
      return { transfer: this.transferDto(transfer), replayed: false };
    });
  }

  async dispatchTransfer(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.scopedTransfer(tx, ctx, id);
      if (t.status !== 'draft') throw Errors.invalidInventoryTransition(t.status, 'dispatched');
      // Lock products in deterministic order to avoid deadlocks.
      const productIds = [...new Set(t.lines.map((l) => l.productId))].sort();
      for (const pid of productIds) await this.lockProduct(tx, pid);

      for (const line of t.lines) {
        const product = await this.scopedProduct(tx, ctx, line.productId);
        const qty = d(line.quantity);
        const bal = await this.balanceOf(tx, t.companyId, t.fromWarehouseId, line.productId);
        if (bal.available.lt(qty)) throw Errors.insufficientStock(product.sku, bal.available.toFixed(4), qty.toFixed(4));
        const res = this.valuation.issue({ qty: bal.onHand, avgCost: bal.avgCost }, qty);
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: ctx.organizationId, companyId: t.companyId,
            warehouseId: t.fromWarehouseId, productId: line.productId,
            movementType: 'transfer_out',
            quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
            sourceType: 'inventory_transfer', sourceId: t.id,
            movementDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'),
            createdById: actorId,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            organizationId: ctx.organizationId, companyId: t.companyId,
            warehouseId: t.fromWarehouseId, productId: line.productId, movementId: movement.id,
            quantityDelta: res.quantityDelta, costDelta: res.costDelta,
            resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
          },
        });
      }
      const updated = await tx.inventoryTransfer.update({
        where: { id }, data: { status: 'dispatched', dispatchedAt: new Date() },
        include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.transfer_dispatched', 'inventory_transfer', id, undefined, ip);
      return { transfer: this.transferDto(updated) };
    });
  }

  async receiveTransfer(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.scopedTransfer(tx, ctx, id);
      if (t.status !== 'dispatched') throw Errors.invalidInventoryTransition(t.status, 'received');
      const productIds = [...new Set(t.lines.map((l) => l.productId))].sort();
      for (const pid of productIds) await this.lockProduct(tx, pid);

      for (const line of t.lines) {
        // The dispatch movement carries the unit cost; valuation travels with the goods.
        const dispatchMov = await tx.stockMovement.findFirst({
          where: {
            sourceType: 'inventory_transfer', sourceId: t.id,
            productId: line.productId, movementType: 'transfer_out',
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!dispatchMov) throw Errors.notFound('Dispatch movement');
        const qty = d(line.quantity);
        const bal = await this.balanceOf(tx, t.companyId, t.toWarehouseId, line.productId);
        const res = this.valuation.receive({ qty: bal.onHand, avgCost: bal.avgCost }, qty, d(dispatchMov.unitCost));
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: ctx.organizationId, companyId: t.companyId,
            warehouseId: t.toWarehouseId, productId: line.productId,
            movementType: 'transfer_in',
            quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
            sourceType: 'inventory_transfer', sourceId: t.id,
            movementDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'),
            createdById: actorId,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            organizationId: ctx.organizationId, companyId: t.companyId,
            warehouseId: t.toWarehouseId, productId: line.productId, movementId: movement.id,
            quantityDelta: res.quantityDelta, costDelta: res.costDelta,
            resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
          },
        });
      }
      const updated = await tx.inventoryTransfer.update({
        where: { id }, data: { status: 'received', receivedAt: new Date() },
        include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.transfer_received', 'inventory_transfer', id, undefined, ip);
      return { transfer: this.transferDto(updated) };
    });
  }

  async cancelTransfer(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.scopedTransfer(tx, ctx, id);
      if (t.status !== 'draft') throw Errors.invalidInventoryTransition(t.status, 'cancelled');
      const updated = await tx.inventoryTransfer.update({
        where: { id }, data: { status: 'cancelled' }, include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.transfer_cancelled', 'inventory_transfer', id, undefined, ip);
      return { transfer: this.transferDto(updated) };
    });
  }

  async getTransfer(ctx: OrgContext, id: string) {
    const t = await this.prisma.$transaction(async (tx) => this.scopedTransfer(tx, ctx, id));
    return { transfer: this.transferDto(t) };
  }

  async listTransfers(ctx: OrgContext, companyId: string, status?: string, page = 1, perPage = 20) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (status) where.status = status;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryTransfer.count({ where }),
      this.prisma.inventoryTransfer.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage, include: { lines: true },
      }),
    ]);
    return { data: rows.map((t) => this.transferDto(t)), meta: pageMeta(total, page, perPage) };
  }

  // ================= adjustments =================

  private adjustmentDto(a: {
    id: string; companyId: string; warehouseId: string; number: string;
    status: string; reason: string | null; createdAt: Date;
    lines?: Array<{ id: string; productId: string; quantityDelta: unknown; unitCost: unknown | null }>;
  }) {
    return {
      id: a.id, company_id: a.companyId, warehouse_id: a.warehouseId,
      number: a.number, status: a.status, reason: a.reason,
      created_at: a.createdAt.toISOString(),
      lines: (a.lines ?? []).map((l) => ({
        id: l.id, product_id: l.productId,
        quantity_delta: d(l.quantityDelta).toFixed(4),
        unit_cost: l.unitCost == null ? null : d(l.unitCost).toFixed(4),
      })),
    };
  }

  private async scopedAdjustment(tx: Tx, ctx: OrgContext, id: string) {
    const a = await tx.inventoryAdjustment.findUnique({ where: { id }, include: { lines: true } });
    if (!a || a.organizationId !== ctx.organizationId) throw Errors.notFound('Adjustment');
    this.assertCompanyInScope(ctx, a.companyId);
    return a;
  }

  async createAdjustment(ctx: OrgContext, dto: InventoryAdjustmentCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (dto.idempotency_key) {
        const existing = await tx.inventoryAdjustment.findUnique({
          where: { idempotencyKey: dto.idempotency_key }, include: { lines: true },
        });
        if (existing) return { adjustment: this.adjustmentDto(existing), replayed: true };
      }
      for (const line of dto.lines) {
        const product = await this.scopedProduct(tx, ctx, line.product_id);
        this.assertStocked(product);
        if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
        if (toDecimal(line.quantity_delta).lt(0) && line.unit_cost === undefined) {
          // Negative adjustments are valued at current average; nothing needed.
        }
      }
      const number = await this.numbering.nextNumber(companyId, 'inventory_adjustment');
      const adjustment = await tx.inventoryAdjustment.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          number, status: 'draft', reason: dto.reason ?? null,
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.product_id,
              quantityDelta: toDecimal(l.quantity_delta),
              unitCost: l.unit_cost === undefined ? null : toDecimal(l.unit_cost),
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.adjustment_created', 'inventory_adjustment', adjustment.id, { number }, ip);
      return { adjustment: this.adjustmentDto(adjustment), replayed: false };
    });
  }

  private async transitionAdjustment(tx: Tx, ctx: OrgContext, id: string, to: string, actorId: string, ip: string | undefined, action: string) {
    const a = await this.scopedAdjustment(tx, ctx, id);
    const allowed: Record<string, string[]> = {
      draft: ['submitted', 'cancelled'],
      submitted: ['approved', 'cancelled'],
      approved: ['posted'],
    };
    if (!(allowed[a.status] ?? []).includes(to)) throw Errors.invalidInventoryTransition(a.status, to);
    if (to === 'approved') {
      const creator = await tx.inventoryAdjustment.findUnique({ where: { id }, select: { createdById: true } });
      if (creator?.createdById && creator.createdById === actorId) throw Errors.selfApprovalForbidden();
    }
    const updated = await tx.inventoryAdjustment.update({
      where: { id },
      data: { status: to, approvedById: to === 'approved' ? actorId : undefined },
      include: { lines: true },
    });
    await this.audit(tx, ctx, actorId, action, 'inventory_adjustment', id, { from: a.status, to }, ip);
    return updated;
  }

  async submitAdjustment(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const a = await this.prisma.$transaction((tx) => this.transitionAdjustment(tx, ctx, id, 'submitted', actorId, ip, 'inventory.adjustment_submitted'));
    return { adjustment: this.adjustmentDto(a) };
  }

  async approveAdjustment(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const a = await this.prisma.$transaction((tx) => this.transitionAdjustment(tx, ctx, id, 'approved', actorId, ip, 'inventory.adjustment_approved'));
    return { adjustment: this.adjustmentDto(a) };
  }

  async cancelAdjustment(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    const a = await this.prisma.$transaction(async (tx) => {
      const adj = await this.scopedAdjustment(tx, ctx, id);
      if (adj.status !== 'draft' && adj.status !== 'submitted') throw Errors.invalidInventoryTransition(adj.status, 'cancelled');
      return this.transitionAdjustment(tx, ctx, id, 'cancelled', actorId, ip, 'inventory.adjustment_cancelled');
    });
    return { adjustment: this.adjustmentDto(a) };
  }

  /** Estimated cost impact of an adjustment (for the approval threshold). */
  private async adjustmentImpact(tx: Tx, companyId: string, warehouseId: string, lines: Array<{ productId: string; quantityDelta: unknown; unitCost: unknown | null }>): Promise<Decimal> {
    let impact = new Decimal(0);
    for (const line of lines) {
      const delta = d(line.quantityDelta);
      let uc: Decimal;
      if (line.unitCost != null) {
        uc = d(line.unitCost);
      } else {
        const bal = await this.balanceOf(tx, companyId, warehouseId, line.productId);
        uc = bal.avgCost;
      }
      impact = impact.plus(delta.abs().mul(uc));
    }
    return impact;
  }

  async postAdjustment(ctx: OrgContext, id: string, actorId: string, ip?: string, postingDate?: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await this.scopedAdjustment(tx, ctx, id);
      if (a.status !== 'approved' && a.status !== 'submitted') {
        throw Errors.invalidInventoryTransition(a.status, 'posted');
      }
      const impact = await this.adjustmentImpact(tx, a.companyId, a.warehouseId, a.lines);
      if (impact.gt(ADJUSTMENT_AUTO_APPROVE_LIMIT) && a.status !== 'approved') {
        throw Errors.adjustmentApprovalRequired(impact.toFixed(2));
      }

      const productIds = [...new Set(a.lines.map((l) => l.productId))].sort();
      for (const pid of productIds) await this.lockProduct(tx, pid);

      const decimals = await this.baseDecimals(tx, a.companyId);
      const date = postingDate ?? new Date().toISOString().slice(0, 10);
      let totalGl = new Decimal(0);
      const movements: string[] = [];

      for (const line of a.lines) {
        const product = await this.scopedProduct(tx, ctx, line.productId);
        const bal = await this.balanceOf(tx, a.companyId, a.warehouseId, line.productId);
        const delta = d(line.quantityDelta);
        const res = this.valuation.adjust(
          { qty: bal.onHand, avgCost: bal.avgCost },
          delta,
          line.unitCost != null ? d(line.unitCost) : undefined,
        );
        if (bal.onHand.plus(res.quantityDelta).lt(0)) {
          throw Errors.insufficientStock(product.sku, bal.onHand.toFixed(4), delta.abs().toFixed(4));
        }
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: ctx.organizationId, companyId: a.companyId,
            warehouseId: a.warehouseId, productId: line.productId,
            movementType: 'adjustment',
            quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
            sourceType: 'inventory_adjustment', sourceId: a.id,
            movementDate: new Date(date + 'T00:00:00Z'),
            createdById: actorId,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            organizationId: ctx.organizationId, companyId: a.companyId,
            warehouseId: a.warehouseId, productId: line.productId, movementId: movement.id,
            quantityDelta: res.quantityDelta, costDelta: res.costDelta,
            resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
          },
        });
        movements.push(movement.id);
        totalGl = totalGl.plus(res.costDelta);
      }

      // GL: net cost delta. Positive → Dr Inventory / Cr 5390; negative → Dr 5390 / Cr Inventory.
      const accounts = await this.resolveAccounts(tx, a.companyId, await this.scopedProduct(tx, ctx, a.lines[0].productId));
      const net = this.money(totalGl.abs(), decimals);
      if (!net.isZero()) {
        const positive = totalGl.gt(0);
        await this.accounting.postSystemEntry(tx, ctx, {
          company_id: a.companyId, posting_date: date,
          description: `Inventory adjustment ${a.number}`,
          journal_type: 'inventory_adjustment',
          source_type: 'inventory_adjustment', source_id: a.id,
          idempotency_key: `gl:adj:${a.id}`,
          lines: positive
            ? [
              { account_id: accounts.inventory, debit: net, credit: new Decimal(0) },
              { account_id: accounts.adjustment, debit: new Decimal(0), credit: net },
            ]
            : [
              { account_id: accounts.adjustment, debit: net, credit: new Decimal(0) },
              { account_id: accounts.inventory, debit: new Decimal(0), credit: net },
            ],
        }, actorId, ip);
      }

      const updated = await tx.inventoryAdjustment.update({
        where: { id }, data: { status: 'posted', postedAt: new Date() }, include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.adjustment_posted', 'inventory_adjustment', id,
        { movements, impact: impact.toFixed(2) }, ip);
      return { adjustment: this.adjustmentDto(updated) };
    });
  }

  async getAdjustment(ctx: OrgContext, id: string) {
    const a = await this.prisma.$transaction(async (tx) => this.scopedAdjustment(tx, ctx, id));
    return { adjustment: this.adjustmentDto(a) };
  }

  async listAdjustments(ctx: OrgContext, companyId: string, status?: string, page = 1, perPage = 20) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (status) where.status = status;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryAdjustment.count({ where }),
      this.prisma.inventoryAdjustment.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage, include: { lines: true },
      }),
    ]);
    return { data: rows.map((a) => this.adjustmentDto(a)), meta: pageMeta(total, page, perPage) };
  }

  // ================= counts =================

  private countDto(c: {
    id: string; companyId: string; warehouseId: string; number: string;
    status: string; createdAt: Date;
    lines?: Array<{ id: string; productId: string; systemQty: unknown; countedQty: unknown }>;
  }) {
    return {
      id: c.id, company_id: c.companyId, warehouse_id: c.warehouseId,
      number: c.number, status: c.status, created_at: c.createdAt.toISOString(),
      lines: (c.lines ?? []).map((l) => ({
        id: l.id, product_id: l.productId,
        system_qty: d(l.systemQty).toFixed(4),
        counted_qty: d(l.countedQty).toFixed(4),
        variance: d(l.countedQty).minus(d(l.systemQty)).toFixed(4),
      })),
    };
  }

  private async scopedCount(tx: Tx, ctx: OrgContext, id: string) {
    const c = await tx.inventoryCount.findUnique({ where: { id }, include: { lines: true } });
    if (!c || c.organizationId !== ctx.organizationId) throw Errors.notFound('Count');
    this.assertCompanyInScope(ctx, c.companyId);
    return c;
  }

  async createCount(ctx: OrgContext, dto: InventoryCountCreateDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { companyId } = await this.scopedWarehouse(tx, ctx, dto.warehouse_id);
      if (dto.idempotency_key) {
        const existing = await tx.inventoryCount.findUnique({
          where: { idempotencyKey: dto.idempotency_key }, include: { lines: true },
        });
        if (existing) return { count: this.countDto(existing), replayed: true };
      }
      for (const line of dto.lines) {
        const product = await this.scopedProduct(tx, ctx, line.product_id);
        this.assertStocked(product);
        if (product.companyId !== companyId) throw Errors.accountCompanyMismatch();
      }
      const number = await this.numbering.nextNumber(companyId, 'inventory_count');
      const count = await tx.inventoryCount.create({
        data: {
          organizationId: ctx.organizationId, companyId, warehouseId: dto.warehouse_id,
          number, status: 'draft',
          idempotencyKey: dto.idempotency_key ?? null, createdById: actorId,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.product_id, systemQty: new Decimal(0), countedQty: new Decimal(0),
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.count_created', 'inventory_count', count.id, { number }, ip);
      return { count: this.countDto(count), replayed: false };
    });
  }

  async startCount(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.scopedCount(tx, ctx, id);
      if (c.status !== 'draft') throw Errors.invalidInventoryTransition(c.status, 'in_progress');
      for (const line of c.lines) {
        const bal = await this.balanceOf(tx, c.companyId, c.warehouseId, line.productId);
        await tx.inventoryCountLine.update({
          where: { id: line.id }, data: { systemQty: bal.onHand },
        });
      }
      const updated = await tx.inventoryCount.update({
        where: { id }, data: { status: 'in_progress' }, include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.count_started', 'inventory_count', id, undefined, ip);
      return { count: this.countDto(updated) };
    });
  }

  async setCountLines(ctx: OrgContext, id: string, dto: InventoryCountLinesDto, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.scopedCount(tx, ctx, id);
      if (c.status !== 'in_progress') throw Errors.invalidInventoryTransition(c.status, 'in_progress');
      const byProduct = new Map(c.lines.map((l) => [l.productId, l]));
      for (const line of dto.lines) {
        const existing = byProduct.get(line.product_id);
        if (!existing) throw Errors.notFound('Count line');
        await tx.inventoryCountLine.update({
          where: { id: existing.id }, data: { countedQty: toDecimal(line.counted_qty) },
        });
      }
      const updated = await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.audit(tx, ctx, actorId, 'inventory.count_lines_set', 'inventory_count', id, undefined, ip);
      return { count: this.countDto(updated) };
    });
  }

  async postCount(ctx: OrgContext, id: string, actorId: string, ip?: string, postingDate?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.scopedCount(tx, ctx, id);
      if (c.status !== 'in_progress') throw Errors.invalidInventoryTransition(c.status, 'posted');
      const date = postingDate ?? new Date().toISOString().slice(0, 10);
      const decimals = await this.baseDecimals(tx, c.companyId);
      const productIds = [...new Set(c.lines.map((l) => l.productId))].sort();
      for (const pid of productIds) await this.lockProduct(tx, pid);

      let netGl = new Decimal(0);
      const movements: string[] = [];
      for (const line of c.lines) {
        const variance = d(line.countedQty).minus(d(line.systemQty));
        if (variance.isZero()) continue;
        const product = await this.scopedProduct(tx, ctx, line.productId);
        const bal = await this.balanceOf(tx, c.companyId, c.warehouseId, line.productId);
        const res = this.valuation.adjust({ qty: bal.onHand, avgCost: bal.avgCost }, variance);
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: ctx.organizationId, companyId: c.companyId,
            warehouseId: c.warehouseId, productId: line.productId,
            movementType: 'adjustment',
            quantity: res.quantityDelta, unitCost: res.movementUnitCost, totalCost: res.costDelta,
            sourceType: 'inventory_count', sourceId: c.id,
            movementDate: new Date(date + 'T00:00:00Z'),
            createdById: actorId,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            organizationId: ctx.organizationId, companyId: c.companyId,
            warehouseId: c.warehouseId, productId: line.productId, movementId: movement.id,
            quantityDelta: res.quantityDelta, costDelta: res.costDelta,
            resultingQty: res.resultingQty, resultingAvgCost: res.resultingAvgCost,
          },
        });
        movements.push(movement.id);
        netGl = netGl.plus(res.costDelta);
      }

      if (!netGl.isZero()) {
        const accounts = await this.resolveAccounts(tx, c.companyId, await this.scopedProduct(tx, ctx, c.lines[0].productId));
        const net = this.money(netGl.abs(), decimals);
        const positive = netGl.gt(0);
        await this.accounting.postSystemEntry(tx, ctx, {
          company_id: c.companyId, posting_date: date,
          description: `Stock count ${c.number} variances`,
          journal_type: 'inventory_adjustment',
          source_type: 'inventory_count', source_id: c.id,
          idempotency_key: `gl:count:${c.id}`,
          lines: positive
            ? [
              { account_id: accounts.inventory, debit: net, credit: new Decimal(0) },
              { account_id: accounts.adjustment, debit: new Decimal(0), credit: net },
            ]
            : [
              { account_id: accounts.adjustment, debit: net, credit: new Decimal(0) },
              { account_id: accounts.inventory, debit: new Decimal(0), credit: net },
            ],
        }, actorId, ip);
      }

      const updated = await tx.inventoryCount.update({
        where: { id }, data: { status: 'posted', postedAt: new Date() }, include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.count_posted', 'inventory_count', id,
        { movements, variance_count: movements.length }, ip);
      return { count: this.countDto(updated) };
    });
  }

  async cancelCount(ctx: OrgContext, id: string, actorId: string, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.scopedCount(tx, ctx, id);
      if (c.status !== 'draft' && c.status !== 'in_progress') throw Errors.invalidInventoryTransition(c.status, 'cancelled');
      const updated = await tx.inventoryCount.update({
        where: { id }, data: { status: 'cancelled' }, include: { lines: true },
      });
      await this.audit(tx, ctx, actorId, 'inventory.count_cancelled', 'inventory_count', id, undefined, ip);
      return { count: this.countDto(updated) };
    });
  }

  async getCount(ctx: OrgContext, id: string) {
    const c = await this.prisma.$transaction(async (tx) => this.scopedCount(tx, ctx, id));
    return { count: this.countDto(c) };
  }

  async listCounts(ctx: OrgContext, companyId: string, status?: string, page = 1, perPage = 20) {
    this.assertCompanyInScope(ctx, companyId);
    const where: Record<string, unknown> = { organizationId: ctx.organizationId, companyId };
    if (status) where.status = status;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryCount.count({ where }),
      this.prisma.inventoryCount.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage, include: { lines: true },
      }),
    ]);
    return { data: rows.map((c) => this.countDto(c)), meta: pageMeta(total, page, perPage) };
  }

  // ================= read endpoints =================

  async listMovements(ctx: OrgContext, q: StockMovementListQuery) {
    this.assertCompanyInScope(ctx, q.company_id);
    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId, companyId: q.company_id,
    };
    if (q.warehouse_id) where.warehouseId = q.warehouse_id;
    if (q.product_id) where.productId = q.product_id;
    if (q.movement_type) where.movementType = q.movement_type;
    if (q.from || q.to) {
      where.movementDate = {
        ...(q.from ? { gte: new Date(q.from + 'T00:00:00Z') } : {}),
        ...(q.to ? { lte: new Date(q.to + 'T00:00:00Z') } : {}),
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where, orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.per_page, take: q.per_page,
        include: {
          product: { select: { sku: true, nameAr: true, nameEn: true } },
          warehouse: { select: { name: true, nameAr: true } },
        },
      }),
    ]);
    return {
      data: rows.map((m) => ({
        ...this.movementDto(m),
        product: m.product, warehouse: m.warehouse,
      })),
      meta: pageMeta(total, q.page, q.per_page),
    };
  }

  /**
   * Balances derived purely from movements + reservations — the single
   * quantity definition: available = on_hand − reserved.
   */
  async getBalances(ctx: OrgContext, q: StockBalanceQuery) {
    this.assertCompanyInScope(ctx, q.company_id);
    const prodWhere: Record<string, unknown> = {
      companyId: q.company_id, isActive: true, type: 'stocked',
    };
    if (q.product_id) prodWhere.id = q.product_id;
    const products = await this.prisma.product.findMany({
      where: prodWhere,
      select: { id: true, sku: true, nameAr: true, nameEn: true, reorderLevel: true },
      orderBy: { sku: 'asc' },
    });
    const whWhere: Record<string, unknown> = { branch: { companyId: q.company_id } };
    if (q.warehouse_id) whWhere.id = q.warehouse_id;
    const warehouses = await this.prisma.warehouse.findMany({
      where: whWhere, select: { id: true, name: true, nameAr: true },
    });

    const rows: Array<{
      product_id: string; sku: string; name_ar: string; name_en: string;
      warehouse_id: string; warehouse_name: string;
      on_hand: string; reserved: string; available: string;
      avg_cost: string; total_value: string; reorder_level: string | null;
      low_stock: boolean;
    }> = [];
    for (const w of warehouses) {
      for (const p of products) {
        const bal = await this.balanceOf(this.prisma, q.company_id, w.id, p.id);
        if (bal.onHand.isZero() && bal.reserved.isZero()) continue;
        const reorder = p.reorderLevel == null ? null : d(p.reorderLevel);
        const lowStock = reorder != null && bal.available.lt(reorder);
        if (q.low_stock_only && !lowStock) continue;
        rows.push({
          product_id: p.id, sku: p.sku, name_ar: p.nameAr, name_en: p.nameEn,
          warehouse_id: w.id, warehouse_name: w.nameAr || w.name,
          on_hand: bal.onHand.toFixed(4),
          reserved: bal.reserved.toFixed(4),
          available: bal.available.toFixed(4),
          avg_cost: bal.avgCost.toFixed(4),
          total_value: bal.onHand.mul(bal.avgCost).toFixed(4),
          reorder_level: reorder == null ? null : reorder.toFixed(4),
          low_stock: lowStock,
        });
      }
    }
    return { data: rows };
  }

  /** Valuation report: quantity × weighted-average per product/warehouse. */
  async getValuation(ctx: OrgContext, companyId: string, warehouseId?: string) {
    const { data } = await this.getBalances(ctx, { company_id: companyId, warehouse_id: warehouseId });
    const totalValue = data.reduce((acc, r) => acc.plus(d(r.total_value)), new Decimal(0));
    return {
      data,
      meta: {
        company_id: companyId,
        warehouse_id: warehouseId ?? null,
        total_value: totalValue.toFixed(4),
        line_count: data.length,
      },
    };
  }
}
