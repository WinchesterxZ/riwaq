import { z } from 'zod';

// ---------- shared ----------
const uuid = z.string().uuid();
const decimalStr = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Must be a decimal number with up to 4 decimals');
const posDecimalStr = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal').refine((v) => Number(v) > 0, 'Must be greater than zero');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const idempotencyKey = z.string().min(1).max(100).optional();

// ---------- movements ----------
export const stockMovementCreateSchema = z.object({
  company_id: uuid,
  warehouse_id: uuid,
  location_id: uuid.optional(),
  product_id: uuid,
  movement_type: z.enum(['receive', 'issue', 'return', 'opening']),
  quantity: posDecimalStr,
  unit_cost: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a non-negative decimal'),
  /** For returns: the original cost the goods left at (defaults to unit_cost). */
  original_unit_cost: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  movement_date: dateStr.optional(),
  source_type: z.string().max(40).optional(),
  source_id: uuid.optional(),
  idempotency_key: idempotencyKey,
});
export type StockMovementCreateDto = z.infer<typeof stockMovementCreateSchema>;

export const stockMovementListQuerySchema = z.object({
  company_id: uuid,
  warehouse_id: uuid.optional(),
  product_id: uuid.optional(),
  movement_type: z.enum(['receive', 'issue', 'transfer_in', 'transfer_out', 'adjustment', 'return', 'opening']).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});
export type StockMovementListQuery = z.infer<typeof stockMovementListQuerySchema>;

// ---------- reservations ----------
export const stockReservationCreateSchema = z.object({
  company_id: uuid,
  warehouse_id: uuid,
  product_id: uuid,
  quantity: posDecimalStr,
  source_type: z.string().max(40).optional(),
  source_id: uuid.optional(),
  idempotency_key: idempotencyKey,
});
export type StockReservationCreateDto = z.infer<typeof stockReservationCreateSchema>;

// ---------- balances / valuation ----------
export const stockBalanceQuerySchema = z.object({
  company_id: uuid,
  warehouse_id: uuid.optional(),
  product_id: uuid.optional(),
  low_stock_only: z.coerce.boolean().optional(),
});
export type StockBalanceQuery = z.infer<typeof stockBalanceQuerySchema>;

// ---------- transfers ----------
export const transferLineSchema = z.object({
  product_id: uuid,
  quantity: posDecimalStr,
});
export const inventoryTransferCreateSchema = z.object({
  company_id: uuid,
  from_warehouse_id: uuid,
  to_warehouse_id: uuid,
  lines: z.array(transferLineSchema).min(1),
  idempotency_key: idempotencyKey,
});
export type InventoryTransferCreateDto = z.infer<typeof inventoryTransferCreateSchema>;

// ---------- adjustments ----------
export const adjustmentLineSchema = z.object({
  product_id: uuid,
  quantity_delta: decimalStr.refine((v) => Number(v) !== 0, 'Quantity delta cannot be zero'),
  unit_cost: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
});
export const inventoryAdjustmentCreateSchema = z.object({
  company_id: uuid,
  warehouse_id: uuid,
  reason: z.string().max(500).optional(),
  lines: z.array(adjustmentLineSchema).min(1),
  idempotency_key: idempotencyKey,
});
export type InventoryAdjustmentCreateDto = z.infer<typeof inventoryAdjustmentCreateSchema>;

// ---------- counts ----------
export const countLineSchema = z.object({
  product_id: uuid,
  counted_qty: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a non-negative decimal'),
});
export const inventoryCountCreateSchema = z.object({
  company_id: uuid,
  warehouse_id: uuid,
  lines: z.array(z.object({ product_id: uuid })).min(1),
  idempotency_key: idempotencyKey,
});
export type InventoryCountCreateDto = z.infer<typeof inventoryCountCreateSchema>;

export const inventoryCountLinesSchema = z.object({
  lines: z.array(countLineSchema).min(1),
});
export type InventoryCountLinesDto = z.infer<typeof inventoryCountLinesSchema>;
