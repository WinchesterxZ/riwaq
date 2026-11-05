import Decimal from 'decimal.js';
import { lineAmounts, docTotals, applyAllocation, invoicePayStatus } from './calculations';

describe('sales calculations (pure logic)', () => {
  describe('lineAmounts', () => {
    it('computes net/tax/total with discount and VAT', () => {
      // 10 x 100, 10% discount, 14% VAT, 2 decimals (EGP)
      const a = lineAmounts({ quantity: '10', unit_price: '100', discount_rate: '10', tax_rate: '14' }, 2);
      expect(a.net.toFixed(2)).toBe('900.00');
      expect(a.tax.toFixed(2)).toBe('126.00');
      expect(a.total.toFixed(2)).toBe('1026.00');
    });

    it('handles zero discount and zero tax', () => {
      const a = lineAmounts({ quantity: '3', unit_price: '50.5' }, 2);
      expect(a.net.toFixed(2)).toBe('151.50');
      expect(a.tax.toFixed(2)).toBe('0.00');
      expect(a.total.toFixed(2)).toBe('151.50');
    });

    it('rounds half-up at currency decimals', () => {
      // 1 x 10.005 -> 10.01 at 2dp
      const a = lineAmounts({ quantity: '1', unit_price: '10.005' }, 2);
      expect(a.net.toFixed(2)).toBe('10.01');
    });
  });

  describe('docTotals', () => {
    it('sums line nets and taxes', () => {
      const t = docTotals([
        { quantity: '10', unit_price: '100', discount_rate: '10', tax_rate: '14' }, // net 900, tax 126
        { quantity: '5', unit_price: '200', discount_rate: '0', tax_rate: '14' },   // net 1000, tax 140
      ], 2);
      expect(t.subtotal.toFixed(2)).toBe('1900.00');
      expect(t.taxTotal.toFixed(2)).toBe('266.00');
      expect(t.total.toFixed(2)).toBe('2166.00');
    });

    it('returns zeros for an empty line list', () => {
      const t = docTotals([], 2);
      expect(t.total.eq(0)).toBe(true);
    });
  });

  describe('applyAllocation', () => {
    it('reduces outstanding by the allocation', () => {
      const out = applyAllocation('1000.00', '400.00', 2);
      expect(out.toFixed(2)).toBe('600.00');
    });

    it('allows allocating the full outstanding', () => {
      const out = applyAllocation('600.00', '600.00', 2);
      expect(out.toFixed(2)).toBe('0.00');
    });

    it('rejects over-allocation', () => {
      expect(() => applyAllocation('600.00', '600.01', 2)).toThrow();
    });

    it('rejects non-positive allocations', () => {
      expect(() => applyAllocation('600.00', '0', 2)).toThrow();
      expect(() => applyAllocation('600.00', '-5', 2)).toThrow();
    });
  });

  describe('invoicePayStatus', () => {
    it('is paid when outstanding is zero', () => {
      expect(invoicePayStatus(new Decimal(0), new Decimal(1000))).toBe('paid');
    });

    it('is partially_paid when some outstanding remains', () => {
      expect(invoicePayStatus(new Decimal(400), new Decimal(1000))).toBe('partially_paid');
    });

    it('stays posted when nothing was paid', () => {
      expect(invoicePayStatus(new Decimal(1000), new Decimal(1000))).toBe('posted');
    });
  });
});
