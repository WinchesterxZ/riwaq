import Decimal from 'decimal.js';
import { Errors } from '../common/errors';
import { convertToBase, sumExact, toDecimal, type DecimalLike } from './money';

/** Minimal line shape needed for balance validation. */
export interface BalanceLine {
  debit: DecimalLike;
  credit: DecimalLike;
}

export interface FunctionalTotals {
  totalDebit: Decimal;
  totalCredit: Decimal;
}

/**
 * Compute functional-currency totals: each line converted at the entry
 * exchange rate and rounded per the base currency decimals (half-up), then
 * summed exactly. Mirrors ACCOUNTING_RULES.md invariant #1.
 */
export function computeFunctionalTotals(
  lines: BalanceLine[],
  exchangeRate: DecimalLike,
  baseDecimals: number,
): FunctionalTotals {
  const totalDebit = sumExact(
    lines.map((l) => convertToBase(l.debit, exchangeRate, baseDecimals)),
  );
  const totalCredit = sumExact(
    lines.map((l) => convertToBase(l.credit, exchangeRate, baseDecimals)),
  );
  return { totalDebit, totalCredit };
}

/**
 * Assert debits == credits in functional currency.
 * Throws UNBALANCED_JOURNAL (422) with {total_debit,total_credit} details.
 */
export function assertBalanced(
  lines: BalanceLine[],
  exchangeRate: DecimalLike,
  baseDecimals: number,
): FunctionalTotals {
  const totals = computeFunctionalTotals(lines, exchangeRate, baseDecimals);
  if (!totals.totalDebit.eq(totals.totalCredit)) {
    throw Errors.unbalancedJournal(
      totals.totalDebit.toFixed(baseDecimals),
      totals.totalCredit.toFixed(baseDecimals),
    );
  }
  return totals;
}

/** Journal lifecycle states. */
export type JournalStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'reversed';

const TRANSITIONS: Record<JournalStatus, JournalStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'draft'], // approve | reject (back to draft)
  approved: ['posted'],
  posted: ['reversed'],
  reversed: [],
};

/** Pure transition check — unit-tested. */
export function canTransition(from: JournalStatus, to: JournalStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Assert a transition is legal; throws JOURNAL_INVALID_TRANSITION (422). */
export function assertTransition(from: JournalStatus, to: JournalStatus): void {
  if (!canTransition(from, to)) throw Errors.journalInvalidTransition(from, to);
}

/** Assert the entry is a draft; throws JOURNAL_NOT_DRAFT (409). */
export function assertDraft(status: string): void {
  if (status !== 'draft') throw Errors.journalNotDraft();
}

/** Period lifecycle: open -> closed -> locked; closed|locked -> open (reopen). */
export type PeriodStatus = 'open' | 'closed' | 'locked';

export function canTransitionPeriod(from: PeriodStatus, to: PeriodStatus): boolean {
  if (from === 'open') return to === 'closed';
  if (from === 'closed') return to === 'locked' || to === 'open';
  if (from === 'locked') return to === 'open';
  return false;
}

export function assertPeriodTransition(from: string, to: PeriodStatus): void {
  if (!canTransitionPeriod(from as PeriodStatus, to)) {
    throw Errors.periodInvalidTransition(from, to);
  }
}

/** Normalize a client idempotency key (body or header) for storage. */
export function normalizeIdempotencyKey(key: string): string {
  return key.trim().slice(0, 100);
}

export { toDecimal };
export { Decimal };
