import Decimal from 'decimal.js';
import {
  matchLine, approvalRequired, billPayStatus, applyBillAllocation,
  MATCH_QTY_TOLERANCE_PCT, MATCH_PRICE_TOLERANCE_PCT, PURCHASE_APPROVAL_THRESHOLD,
} from './calculations';

describe('purchasing calculations', () => {
  it('passes matching within tolerance', () => {
    const r = matchLine(
      { quantity: '10.0000', unit_price: '100.0000' },
      { quantity: '10.0000', unit_price: '100.0000' },
    );
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('fails quantity variance beyond 5% tolerance', () => {
    const r = matchLine(
      { quantity: '10.6000', unit_price: '100.0000' },
      { quantity: '10.0000', unit_price: '100.0000' },
    );
    expect(r.ok).toBe(false);
    expect(r.qtyVariancePct.toFixed(2)).toBe('6.00');
    expect(r.reasons[0]).toMatch(/quantity variance/);
  });

  it('fails price variance beyond 2% tolerance', () => {
    const r = matchLine(
      { quantity: '10.0000', unit_price: '103.0000' },
      { quantity: '10.0000', unit_price: '100.0000' },
    );
    expect(r.ok).toBe(false);
    expect(r.priceVariancePct.toFixed(2)).toBe('3.00');
    expect(r.reasons[0]).toMatch(/price variance/);
  });

  it('passes small variances inside tolerance', () => {
    const r = matchLine(
      { quantity: '10.4000', unit_price: '101.5000' },
      { quantity: '10.0000', unit_price: '100.0000' },
    );
    expect(r.ok).toBe(true);
  });

  it('requires approval at or above the 10,000 threshold', () => {
    expect(approvalRequired('9999.99')).toBe(false);
    expect(approvalRequired('10000.00')).toBe(true);
    expect(approvalRequired('25000.00')).toBe(true);
    expect(PURCHASE_APPROVAL_THRESHOLD.toFixed(2)).toBe('10000.00');
  });

  it('derives bill payment status', () => {
    expect(billPayStatus(new Decimal('923.40'), new Decimal('923.40'))).toBe('posted');
    expect(billPayStatus(new Decimal('423.40'), new Decimal('923.40'))).toBe('partially_paid');
    expect(billPayStatus(new Decimal('0'), new Decimal('923.40'))).toBe('paid');
  });

  it('applies bill allocations and rejects over-allocation', () => {
    const r = applyBillAllocation('923.4000', '0.0000', '500.0000', 2);
    expect(r.outstanding.toFixed(2)).toBe('423.40');
    expect(r.paidTotal.toFixed(2)).toBe('500.00');
    expect(() => applyBillAllocation('423.40', '500.00', '500.00', 2)).toThrow(/exceeds outstanding/);
    expect(() => applyBillAllocation('423.40', '500.00', '0', 2)).toThrow(/positive/);
  });

  it('exposes the documented tolerance constants', () => {
    expect(MATCH_QTY_TOLERANCE_PCT.toFixed(0)).toBe('5');
    expect(MATCH_PRICE_TOLERANCE_PCT.toFixed(0)).toBe('2');
  });
});
