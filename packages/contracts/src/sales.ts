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

/** A priced line (quotation / order / invoice / credit note). */
const pricedLine = z.object({
  product_id: uuid.optional(),
  description: z.string().min(1).max(255),
  quantity: posDecimalStr,
  unit_price: nonNegDecimalStr,
  discount_rate: percentStr.optional().default('0'),
  tax_rate: percentStr.optional().default('0'),
});
export type PricedLineDto = z.infer<typeof pricedLine>;

const listQuery = z.object({
  company_id: uuid,
  status: z.string().max(30).optional(),
  customer_id: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

// ---------- quotations ----------
export const quotationCreateSchema = z.object({
  company_id: uuid,
  customer_id: uuid,
  valid_until: dateStr,
  lines: z.array(pricedLine).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type QuotationCreateDto = z.infer<typeof quotationCreateSchema>;

export const quotationUpdateSchema = z.object({
  valid_until: dateStr.optional(),
  lines: z.array(pricedLine).min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type QuotationUpdateDto = z.infer<typeof quotationUpdateSchema>;

export const quotationListQuerySchema = listQuery;
export type QuotationListQuery = z.infer<typeof quotationListQuerySchema>;

// ---------- sales orders ----------
export const salesOrderCreateSchema = z.object({
  company_id: uuid,
  customer_id: uuid,
  quotation_id: uuid.optional(),
  warehouse_id: uuid,
  lines: z.array(pricedLine.extend({ product_id: uuid })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type SalesOrderCreateDto = z.infer<typeof salesOrderCreateSchema>;

export const salesOrderListQuerySchema = listQuery;
export type SalesOrderListQuery = z.infer<typeof salesOrderListQuerySchema>;

// ---------- deliveries ----------
export const deliveryCreateSchema = z.object({
  company_id: uuid,
  sales_order_id: uuid,
  warehouse_id: uuid.optional(),
  delivery_date: dateStr.optional(),
  lines: z.array(z.object({
    sales_order_line_id: uuid,
    quantity: posDecimalStr,
  })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type DeliveryCreateDto = z.infer<typeof deliveryCreateSchema>;

export const deliveryListQuerySchema = listQuery.extend({
  sales_order_id: uuid.optional(),
});
export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;

// ---------- invoices ----------
export const salesInvoiceCreateSchema = z.object({
  company_id: uuid,
  customer_id: uuid,
  sales_order_id: uuid.optional(),
  /** Invoice directly from posted deliveries (their uninvoiced lines). */
  delivery_ids: z.array(uuid).max(50).optional(),
  invoice_date: dateStr.optional(),
  /** Direct/service lines (no order or delivery). At least one source of lines required. */
  lines: z.array(pricedLine.extend({ product_id: uuid })).max(200).optional(),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type SalesInvoiceCreateDto = z.infer<typeof salesInvoiceCreateSchema>;

export const salesInvoiceListQuerySchema = listQuery;
export type SalesInvoiceListQuery = z.infer<typeof salesInvoiceListQuerySchema>;

// ---------- payments ----------
export const salesPaymentCreateSchema = z.object({
  company_id: uuid,
  customer_id: uuid,
  payment_date: dateStr.optional(),
  amount: posDecimalStr,
  allocations: z.array(z.object({
    sales_invoice_id: uuid,
    amount: posDecimalStr,
  })).max(100).optional(),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type SalesPaymentCreateDto = z.infer<typeof salesPaymentCreateSchema>;

export const salesPaymentListQuerySchema = listQuery;
export type SalesPaymentListQuery = z.infer<typeof salesPaymentListQuerySchema>;

// ---------- credit notes ----------
export const creditNoteCreateSchema = z.object({
  company_id: uuid,
  customer_id: uuid,
  sales_invoice_id: uuid.optional(),
  credit_date: dateStr.optional(),
  reason: z.string().min(1).max(255),
  /** true => goods returned: stock is received back and COGS reversed. */
  is_return: z.boolean().optional().default(false),
  lines: z.array(pricedLine.extend({ product_id: uuid.optional() })).min(1).max(200),
  notes: z.string().max(2000).optional(),
  idempotency_key: idempotencyKey,
});
export type CreditNoteCreateDto = z.infer<typeof creditNoteCreateSchema>;

export const creditNoteListQuerySchema = listQuery;
export type CreditNoteListQuery = z.infer<typeof creditNoteListQuerySchema>;
