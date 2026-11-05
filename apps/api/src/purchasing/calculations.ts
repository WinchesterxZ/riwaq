import Decimal from 'decimal.js';
import { toDecimal, roundMoney } from '../accounting/money';
import { lineAmounts, docTotals } from '../sales/calculations';

const d = (v: unknown): Decimal => toDecimal(String(v ?? 0));

export { lineAmounts, docTotals };

/** Purchase approval policy: orders at or above this total need a separate approver. */
export const PURCHASE_APPROVAL_THRESHOLD = new Decimal(10000);

/** 3-way/2-way matching tolerances (percent). */
export const MATCH_QTY_TOLERANCE_PCT = new Decimal(5);
export const MATCH_PRICE_TOLERANCE_PCT = new Decimal(2);

export interface MatchLineInput {
  quantity: unknown;
  unit_price: unknown;
}

export interface MatchResult {
  ok: boolean;
  qtyVariancePct: Decimal;
  priceVariancePct: Decimal;
  reasons: string[];
}

/**
 * Validate one bill line against its reference (PO line for 2-way, GRN line for 3-way).
 * Variances are measured against the reference; anything beyond tolerance fails.
 */
export function matchLine(
  bill: MatchLineInput,
  ref: MatchLineInput,
  qtyTolPct: Decimal = MATCH_QTY_TOLERANCE_PCT,
  priceTolPct: Decimal = MATCH_PRICE_TOLERANCE_PCT,
): MatchResult {
  const bQty = d(bill.quantity);
  const rQty = d(ref.quantity);
  const bPrice = d(bill.unit_price);
  const rPrice = d(ref.unit_price);
  const reasons: string[] = [];

  const qtyVar = rQty.isZero() ? new Decimal(bQty.isZero() ? 0 : 100) : bQty.minus(rQty).abs().div(rQty).mul(100);
  const priceVar = rPrice.isZero() ? new Decimal(bPrice.isZero() ? 0 : 100) : bPrice.minus(rPrice).abs().div(rPrice).mul(100);

  if (qtyVar.gt(qtyTolPct)) reasons.push(`quantity variance ${qtyVar.toFixed(2)}% exceeds tolerance ${qtyTolPct.toFixed(2)}%`);
  if (priceVar.gt(priceTolPct)) reasons.push(`price variance ${priceVar.toFixed(2)}% exceeds tolerance ${priceTolPct.toFixed(2)}%`);
  return { ok: reasons.length === 0, qtyVariancePct: qtyVar, priceVariancePct: priceVar, reasons };
}

/** Does this purchase order total require a separate approver? */
export function approvalRequired(total: unknown, threshold: Decimal = PURCHASE_APPROVAL_THRESHOLD): boolean {
  return d(total).gte(threshold);
}

/** Supplier-bill payment status from outstanding vs total. */
export function billPayStatus(outstanding: Decimal, total: Decimal): 'posted' | 'partially_paid' | 'paid' {
  if (outstanding.lte(0)) return 'paid';
  if (outstanding.lt(total)) return 'partially_paid';
  return 'posted';
}

/** Recompute bill outstanding/paid totals after an allocation. */
export function applyBillAllocation(
  outstanding: unknown, paidTotal: unknown, amount: unknown, decimals: number,
): { outstanding: Decimal; paidTotal: Decimal } {
  const out = d(outstanding);
  const amt = d(amount);
  if (amt.lte(0)) throw new Error('Allocation amount must be positive');
  if (amt.gt(out)) throw new Error(`Allocation ${amt.toFixed(decimals)} exceeds outstanding ${out.toFixed(decimals)}`);
  return {
    outstanding: roundMoney(out.minus(amt), decimals),
    paidTotal: roundMoney(d(paidTotal).plus(amt), decimals),
  };
}
