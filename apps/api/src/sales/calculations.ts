import Decimal from 'decimal.js';
import { toDecimal, roundMoney } from '../accounting/money';

const d = (v: unknown): Decimal => toDecimal(String(v ?? 0));

export interface PricedLineInput {
  quantity: unknown;
  unit_price: unknown;
  discount_rate?: unknown;
  tax_rate?: unknown;
}

export interface LineAmounts {
  net: Decimal;   // qty * price * (1 - discount)
  tax: Decimal;   // net * tax_rate
  total: Decimal; // net + tax
}

/**
 * Amounts for one priced line, rounded to the document currency decimals.
 * Discount and tax rates are percentages (0-100).
 */
export function lineAmounts(line: PricedLineInput, decimals: number): LineAmounts {
  const qty = d(line.quantity);
  const price = d(line.unit_price);
  const disc = d(line.discount_rate).div(100);
  const tax = d(line.tax_rate).div(100);
  const net = roundMoney(qty.mul(price).mul(new Decimal(1).minus(disc)), decimals);
  const taxAmt = roundMoney(net.mul(tax), decimals);
  return { net, tax: taxAmt, total: net.plus(taxAmt) };
}

export interface DocTotals {
  subtotal: Decimal; // sum of line nets
  taxTotal: Decimal; // sum of line taxes
  total: Decimal;    // subtotal + taxTotal
}

/** Document totals from priced lines (all rounded to currency decimals). */
export function docTotals(lines: PricedLineInput[], decimals: number): DocTotals {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  for (const l of lines) {
    const a = lineAmounts(l, decimals);
    subtotal = subtotal.plus(a.net);
    taxTotal = taxTotal.plus(a.tax);
  }
  const total = subtotal.plus(taxTotal);
  return { subtotal, taxTotal, total };
}

/**
 * Apply a payment allocation against an invoice outstanding.
 * Returns the new outstanding. Throws when the allocation exceeds it.
 */
export function applyAllocation(outstanding: unknown, amount: unknown, decimals: number): Decimal {
  const out = d(outstanding);
  const amt = d(amount);
  if (amt.lte(0)) throw new Error('Allocation amount must be positive');
  if (amt.gt(out)) throw new Error(`Allocation ${amt.toFixed(decimals)} exceeds outstanding ${out.toFixed(decimals)}`);
  return roundMoney(out.minus(amt), decimals);
}

/** Invoice payment status from outstanding vs total. */
export function invoicePayStatus(outstanding: Decimal, total: Decimal): 'posted' | 'partially_paid' | 'paid' {
  if (outstanding.lte(0)) return 'paid';
  if (outstanding.lt(total)) return 'partially_paid';
  return 'posted';
}
