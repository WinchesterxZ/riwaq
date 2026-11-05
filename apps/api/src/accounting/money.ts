import Decimal from 'decimal.js';

/**
 * Money arithmetic. RULE: zero binary-float arithmetic on money paths.
 * Every value enters Decimal through its exact decimal string representation
 * (Decimal(String(v))), never through float operations.
 */

export type DecimalLike = Decimal | string | number;

/** Construct an exact Decimal from string | number | Decimal. */
export function toDecimal(value: DecimalLike): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(String(value));
}

/**
 * Round half-up to the given number of decimals (the standard cash rounding).
 * Classic float trap this fixes: (2.675).toFixed(2) === '2.67',
 * but new Decimal('2.675').toDecimalPlaces(2, ROUND_HALF_UP) === '2.68'.
 */
export function roundMoney(value: DecimalLike, decimals: number): Decimal {
  return toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/** Exact sum of decimal values (no float error: 0.1 + 0.2 === 0.3). */
export function sumExact(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/**
 * Convert a transaction-currency amount to functional (base) currency and
 * round per the base currency's decimals, half-up.
 */
export function convertToBase(
  amount: DecimalLike,
  exchangeRate: DecimalLike,
  baseDecimals: number,
): Decimal {
  return roundMoney(toDecimal(amount).mul(toDecimal(exchangeRate)), baseDecimals);
}

/** Canonical string form for API envelopes / error details. */
export function moneyString(value: DecimalLike, decimals: number): string {
  return roundMoney(value, decimals).toFixed(decimals);
}
