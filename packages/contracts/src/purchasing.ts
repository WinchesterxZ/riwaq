import { z } from 'zod';

// ---------- shared ----------
const uuid = z.string().uuid();
const decimalStr = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Must be a decimal number with up to 4 decimals');
const posDecimalStr = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a positive decimal').refine((v) => Number(v) > 0, 'Must be greater than zero');
const nonNegDecimalStr = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a non-negative decimal');
const percentStr = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a percentage 0-100')
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Must be between 0 and 100');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const idempotencyKey = z.string().min(1).max(100).optional();

/** A priced line (PR / PO / bill). */
const pricedLine = z.object({
  product_id: uuid.optional(),
  description: z.string().min(1).max(255),
  quantity: posDecimalStr,
  unit_price: nonNegDecimalStr,
  discount_rate: percentStr.optional().default('0'),
  tax_rate: percentStr.optional().default('0'),
});

const listQuery = z.object({
  company_id: uuid,
  status: z.string().max(30).optional(),
  supplier_id: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

// ---------- purchase requests ----------
export const purchaseRequestCreateSchema = z.object({
  company_id: uuid,
  lines: z.array(pricedLine).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type PurchaseRequestCreateDto = z.infer<typeof purchaseRequestCreateSchema>;

export const purchaseRequestListQuerySchema = listQuery;
export type PurchaseRequestListQuery = z.infer<typeof purchaseRequestListQuerySchema>;

// ---------- RFQs ----------
export const rfqCreateSchema = z.object({
  company_id: uuid,
  purchase_request_id: uuid.optional(),
  lines: z.array(z.object({
    supplier_id: uuid,
    product_id: uuid.optional(),
    description: z.string().min(1).max(255),
    quantity: posDecimalStr,
    quoted_price: nonNegDecimalStr.optional(),
  })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type RfqCreateDto = z.infer<typeof rfqCreateSchema>;

export const rfqAwardSchema = z.object({
  supplier_id: uuid,
  warehouse_id: uuid,
  lines: z.array(z.object({
    rfq_line_id: uuid,
    quoted_price: nonNegDecimalStr,
  })).min(1).max(200).optional(),
});
export type RfqAwardDto = z.infer<typeof rfqAwardSchema>;

export const rfqListQuerySchema = listQuery;
export type RfqListQuery = z.infer<typeof rfqListQuerySchema>;

// ---------- purchase orders ----------
export const purchaseOrderCreateSchema = z.object({
  company_id: uuid,
  supplier_id: uuid,
  purchase_request_id: uuid.optional(),
  rfq_id: uuid.optional(),
  warehouse_id: uuid,
  lines: z.array(pricedLine.extend({ product_id: uuid })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type PurchaseOrderCreateDto = z.infer<typeof purchaseOrderCreateSchema>;

export const purchaseOrderListQuerySchema = listQuery;
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

// ---------- goods receipts ----------
export const goodsReceiptCreateSchema = z.object({
  company_id: uuid,
  purchase_order_id: uuid,
  warehouse_id: uuid.optional(),
  receipt_date: dateStr.optional(),
  lines: z.array(z.object({
    purchase_order_line_id: uuid,
    quantity: posDecimalStr,
    unit_cost: nonNegDecimalStr.optional(),
  })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type GoodsReceiptCreateDto = z.infer<typeof goodsReceiptCreateSchema>;

export const goodsReceiptListQuerySchema = listQuery;
export type GoodsReceiptListQuery = z.infer<typeof goodsReceiptListQuerySchema>;

// ---------- supplier bills ----------
export const supplierBillCreateSchema = z.object({
  company_id: uuid,
  supplier_id: uuid,
  purchase_order_id: uuid.optional(),
  goods_receipt_id: uuid.optional(),
  supplier_ref: z.string().max(60).optional(),
  bill_date: dateStr.optional(),
  due_date: dateStr.optional(),
  lines: z.array(pricedLine.extend({
    purchase_order_line_id: uuid.optional(),
    goods_receipt_line_id: uuid.optional(),
  })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type SupplierBillCreateDto = z.infer<typeof supplierBillCreateSchema>;

export const supplierBillListQuerySchema = listQuery;
export type SupplierBillListQuery = z.infer<typeof supplierBillListQuerySchema>;

// ---------- supplier payments ----------
export const supplierPaymentCreateSchema = z.object({
  company_id: uuid,
  supplier_id: uuid,
  payment_date: dateStr.optional(),
  amount: posDecimalStr,
  allocations: z.array(z.object({
    supplier_bill_id: uuid,
    amount: posDecimalStr,
  })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type SupplierPaymentCreateDto = z.infer<typeof supplierPaymentCreateSchema>;

export const supplierPaymentListQuerySchema = listQuery;
export type SupplierPaymentListQuery = z.infer<typeof supplierPaymentListQuerySchema>;
