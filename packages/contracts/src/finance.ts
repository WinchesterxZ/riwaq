import { z } from 'zod';
import { uuidSchema, paginationQuerySchema } from './common';
import { dateStringSchema, moneyInputSchema } from './accounting';

// ---------- bank statements (Phase 8) ----------

export const bankStatementLineInputSchema = z.object({
  value_date: dateStringSchema,
  description: z.string().min(1).max(400),
  reference: z.string().max(120).optional(),
  /** Signed amount: positive = money in, negative = money out. */
  amount: moneyInputSchema,
});
export type BankStatementLineInput = z.infer<typeof bankStatementLineInputSchema>;

export const bankStatementCreateSchema = z.object({
  company_id: uuidSchema,
  account_id: uuidSchema,
  statement_date: dateStringSchema,
  opening_balance: moneyInputSchema,
  closing_balance: moneyInputSchema,
  notes: z.string().max(2000).optional(),
  lines: z.array(bankStatementLineInputSchema).min(1).max(2000),
  idempotency_key: z.string().min(8).max(100).nullable().optional(),
});
export type BankStatementCreateDto = z.infer<typeof bankStatementCreateSchema>;

export const bankStatementListQuerySchema = paginationQuerySchema.extend({
  company_id: uuidSchema,
  account_id: uuidSchema.optional(),
  status: z.enum(['draft', 'posted']).optional(),
});
export type BankStatementListQuery = z.infer<typeof bankStatementListQuerySchema>;

export const bankMatchSchema = z.object({
  journal_entry_id: uuidSchema,
});
export type BankMatchDto = z.infer<typeof bankMatchSchema>;

// ---------- expense bills (Phase 8) ----------

export const expenseBillLineInputSchema = z.object({
  account_id: uuidSchema,
  description: z.string().min(1).max(400),
  quantity: moneyInputSchema,
  unit_price: moneyInputSchema,
  tax_rate: moneyInputSchema.default('0'),
});
export type ExpenseBillLineInput = z.infer<typeof expenseBillLineInputSchema>;

export const expenseBillCreateSchema = z.object({
  company_id: uuidSchema,
  supplier_id: uuidSchema.nullable().optional(),
  bill_date: dateStringSchema,
  due_date: dateStringSchema.nullable().optional(),
  /** supplier = credit the supplier (AP); bank|cash = pay immediately from the account. */
  pay_from: z.enum(['supplier', 'bank', 'cash']),
  bank_account_id: uuidSchema.nullable().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(expenseBillLineInputSchema).min(1).max(200),
  idempotency_key: z.string().min(8).max(100).nullable().optional(),
}).refine(
  (d) => d.pay_from === 'supplier' || !!d.bank_account_id,
  { message: 'bank_account_id is required when pay_from is bank or cash.', path: ['bank_account_id'] },
);
export type ExpenseBillCreateDto = z.infer<typeof expenseBillCreateSchema>;

export const expenseBillListQuerySchema = paginationQuerySchema.extend({
  company_id: uuidSchema,
  status: z.enum(['draft', 'submitted', 'approved', 'posted', 'rejected', 'cancelled']).optional(),
  supplier_id: uuidSchema.optional(),
});
export type ExpenseBillListQuery = z.infer<typeof expenseBillListQuerySchema>;
