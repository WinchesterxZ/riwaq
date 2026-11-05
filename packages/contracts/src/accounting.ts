import { z } from 'zod';

/**
 * Phase 3 accounting contracts.
 * Conventions: snake_case keys (per the Phase 3 API contract), money amounts as
 * decimal strings or numbers (never binary floats on the money path — the API
 * converts through Decimal from the exact decimal representation).
 */

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

const MONEY_RE = /^\d+(\.\d{1,6})?$/;
/** Non-negative amount; normalized to a decimal string for Decimal(). */
export const moneyInputSchema = z
  .union([z.number(), z.string()])
  .refine((v) => {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0;
    return MONEY_RE.test(v.trim());
  }, { message: 'Amount must be a non-negative number.' })
  .transform((v) => String(v).trim());
export type MoneyInput = z.infer<typeof moneyInputSchema>;

const uuidSchema = z.string().uuid();

// ---------- chart of accounts ----------

export const accountCreateSchema = z.object({
  company_id: uuidSchema,
  code: z.string().min(1).max(30),
  name_ar: z.string().min(1).max(160),
  name_en: z.string().min(1).max(160),
  /**
   * Account-type CODE ('ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')
   * or the type row UUID. Resolved code-first, id-fallback, server-side.
   */
  account_type_id: z.string().min(1).max(40),
  parent_id: uuidSchema.nullable().optional(),
  is_postable: z.boolean().default(true),
  description: z.string().max(2000).nullable().optional(),
});
export type AccountCreateDto = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name_ar: z.string().min(1).max(160).optional(),
  name_en: z.string().min(1).max(160).optional(),
  account_type_id: z.string().min(1).max(40).optional(),
  parent_id: uuidSchema.nullable().optional(),
  is_postable: z.boolean().optional(),
  is_active: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type AccountUpdateDto = z.infer<typeof accountUpdateSchema>;

export const accountListQuerySchema = z.object({
  company_id: uuidSchema,
  is_active: z.coerce.boolean().optional(),
  is_postable: z.coerce.boolean().optional(),
});
export type AccountListQuery = z.infer<typeof accountListQuerySchema>;

// ---------- fiscal years / periods ----------

function monthsBetweenWhole(start: string, end: string): number | null {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  // Start must be the 1st of a month; end must be the last day of a month.
  if (s.getUTCDate() !== 1) return null;
  const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  if (e.getUTCDate() !== lastDay) return null;
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
}

export const fiscalYearCreateSchema = z.object({
  company_id: uuidSchema,
  name: z.string().min(1).max(80),
  start_date: dateStringSchema,
  end_date: dateStringSchema,
}).refine(
  (d) => d.start_date < d.end_date && monthsBetweenWhole(d.start_date, d.end_date) === 12,
  { message: 'A fiscal year must span exactly 12 whole calendar months (start on the 1st, end on the last day of a month).' },
);
export type FiscalYearCreateDto = z.infer<typeof fiscalYearCreateSchema>;

export const fiscalYearListQuerySchema = z.object({ company_id: uuidSchema });
export type FiscalYearListQuery = z.infer<typeof fiscalYearListQuerySchema>;

export const periodListQuerySchema = z.object({ fiscal_year_id: uuidSchema });
export type PeriodListQuery = z.infer<typeof periodListQuerySchema>;

// ---------- journal ----------

export const journalStatusSchema = z.enum(['draft', 'submitted', 'approved', 'posted', 'reversed']);

export const journalLineInputSchema = z.object({
  account_id: uuidSchema,
  debit: moneyInputSchema.default('0'),
  credit: moneyInputSchema.default('0'),
  description: z.string().max(2000).nullable().optional(),
  cost_center: z.string().max(80).nullable().optional(),
  tax_code_id: uuidSchema.nullable().optional(),
}).refine(
  (l) => {
    const d = Number(l.debit);
    const c = Number(l.credit);
    // DB CHECK: debit>=0 AND credit>=0 AND (debit>0 OR credit>0);
    // one side per line (a line is either a debit or a credit).
    return d >= 0 && c >= 0 && (d > 0) !== (c > 0);
  },
  { message: 'Each line must have exactly one of debit or credit greater than zero.' },
);
export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalEntryCreateSchema = z.object({
  company_id: uuidSchema,
  posting_date: dateStringSchema,
  currency: z.string().length(3).optional(),
  exchange_rate: moneyInputSchema.optional(),
  description: z.string().min(1).max(4000),
  lines: z.array(journalLineInputSchema).min(2).max(500),
  idempotency_key: z.string().min(8).max(100).nullable().optional(),
});
export type JournalEntryCreateDto = z.infer<typeof journalEntryCreateSchema>;

export const journalEntryUpdateSchema = z.object({
  description: z.string().min(1).max(4000).optional(),
  posting_date: dateStringSchema.optional(),
  currency: z.string().length(3).optional(),
  exchange_rate: moneyInputSchema.optional(),
  lines: z.array(journalLineInputSchema).min(2).max(500),
});
export type JournalEntryUpdateDto = z.infer<typeof journalEntryUpdateSchema>;

export const journalPostSchema = z.object({
  version: z.coerce.number().int().min(1),
});
export type JournalPostDto = z.infer<typeof journalPostSchema>;

export const journalApproveSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});
export type JournalApproveDto = z.infer<typeof journalApproveSchema>;

export const journalRejectSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});
export type JournalRejectDto = z.infer<typeof journalRejectSchema>;

export const journalReverseSchema = z.object({
  description: z.string().max(4000).nullable().optional(),
});
export type JournalReverseDto = z.infer<typeof journalReverseSchema>;

export const journalListQuerySchema = z.object({
  company_id: uuidSchema,
  status: journalStatusSchema.optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});
export type JournalListQuery = z.infer<typeof journalListQuerySchema>;

// ---------- tax codes ----------

export const taxCodeTypeSchema = z.enum(['input', 'output', 'exempt', 'zero']);

export const taxCodeCreateSchema = z.object({
  company_id: uuidSchema,
  name_ar: z.string().min(1).max(120),
  name_en: z.string().min(1).max(120),
  rate: moneyInputSchema,
  type: taxCodeTypeSchema,
  tax_account_id: uuidSchema.nullable().optional(),
});
export type TaxCodeCreateDto = z.infer<typeof taxCodeCreateSchema>;

export const taxCodeUpdateSchema = z.object({
  name_ar: z.string().min(1).max(120).optional(),
  name_en: z.string().min(1).max(120).optional(),
  rate: moneyInputSchema.optional(),
  type: taxCodeTypeSchema.optional(),
  tax_account_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
});
export type TaxCodeUpdateDto = z.infer<typeof taxCodeUpdateSchema>;

export const taxCodeListQuerySchema = z.object({ company_id: uuidSchema });
export type TaxCodeListQuery = z.infer<typeof taxCodeListQuerySchema>;

// ---------- trial balance ----------

export const trialBalanceQuerySchema = z.object({
  company_id: uuidSchema,
  from: dateStringSchema,
  to: dateStringSchema,
}).refine((d) => d.from <= d.to, { message: 'from must be on or before to.' });
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

// ---------- financial reports (Phase 8) ----------

const periodQueryBase = {
  company_id: uuidSchema,
  from: dateStringSchema,
  to: dateStringSchema,
};
const periodRefine = (d: { from: string; to: string }) => d.from <= d.to;

export const generalLedgerQuerySchema = z.object({
  ...periodQueryBase,
  account_id: uuidSchema.optional(),
}).refine(periodRefine, { message: 'from must be on or before to.' });
export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  company_id: uuidSchema,
  as_of: dateStringSchema,
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

export const profitLossQuerySchema = z.object(periodQueryBase)
  .refine(periodRefine, { message: 'from must be on or before to.' });
export type ProfitLossQuery = z.infer<typeof profitLossQuerySchema>;

export const cashFlowQuerySchema = z.object(periodQueryBase)
  .refine(periodRefine, { message: 'from must be on or before to.' });
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;

export const agingQuerySchema = z.object({
  company_id: uuidSchema,
  as_of: dateStringSchema,
});
export type AgingQuery = z.infer<typeof agingQuerySchema>;

export const vatReportQuerySchema = z.object(periodQueryBase)
  .refine(periodRefine, { message: 'from must be on or before to.' });
export type VatReportQuery = z.infer<typeof vatReportQuerySchema>;

export const financeDashboardQuerySchema = z.object({ company_id: uuidSchema });
export type FinanceDashboardQuery = z.infer<typeof financeDashboardQuerySchema>;
