import Decimal from 'decimal.js';
import { convertToBase, moneyString, roundMoney, sumExact, toDecimal } from './money';

describe('money (decimal-only arithmetic)', () => {
  it('rounds 2.675 to 2.68 half-up (binary float gives 2.67)', () => {
    // The classic float trap: (2.675).toFixed(2) === '2.67' in JS.
    expect((2.675).toFixed(2)).toBe('2.67');
    expect(roundMoney('2.675', 2).toFixed(2)).toBe('2.68');
    expect(roundMoney(2.675, 2).toFixed(2)).toBe('2.68');
  });

  it('sums 0.1 + 0.2 exactly (float gives 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumExact(['0.1', '0.2']).eq(new Decimal('0.3'))).toBe(true);
    expect(sumExact([0.1, 0.2]).eq('0.3')).toBe(true);
  });

  it('toDecimal never goes through float arithmetic', () => {
    expect(toDecimal('19.99').mul('3').toString()).toBe('59.97');
    expect(toDecimal(0.07).plus(0.01).toString()).toBe('0.08');
  });

  it('rounds half-up at the boundary', () => {
    expect(roundMoney('1.005', 2).toString()).toBe('1.01');
    expect(roundMoney('1.004', 2).toString()).toBe('1');
    expect(roundMoney('2.5', 0).toString()).toBe('3');
  });

  it('converts at the exchange rate then rounds per base decimals', () => {
    // 100 USD @ 48.5 EGP = 4850.00
    expect(convertToBase('100', '48.5', 2).toFixed(2)).toBe('4850.00');
    // 10 / 3 style fractions round half-up: 33.333 * 1 -> 33.33
    expect(convertToBase('33.333', '1', 2).toFixed(2)).toBe('33.33');
    expect(convertToBase('33.335', '1', 2).toFixed(2)).toBe('33.34');
  });

  it('moneyString formats with fixed decimals', () => {
    expect(moneyString('5', 2)).toBe('5.00');
    expect(moneyString('5.1', 2)).toBe('5.10');
  });
});
