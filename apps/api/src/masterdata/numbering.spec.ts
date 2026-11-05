import {
  formatSequenceNumber, prefixFor, resolveNextNumber, NUMBER_WIDTH,
} from './numbering';

describe('numbering (pure logic)', () => {
  it('pads numbers to 6 digits with the prefix', () => {
    expect(formatSequenceNumber('CUST-', 1)).toBe('CUST-000001');
    expect(formatSequenceNumber('CUST-', 42)).toBe('CUST-000042');
    expect(formatSequenceNumber('SUP-', 123456)).toBe('SUP-123456');
    expect(formatSequenceNumber('CUST-', 1234567)).toBe('CUST-1234567'); // overflow keeps digits
    expect(NUMBER_WIDTH).toBe(6);
  });

  it('rejects non-positive sequence numbers', () => {
    expect(() => formatSequenceNumber('CUST-', 0)).toThrow();
    expect(() => formatSequenceNumber('CUST-', -3)).toThrow();
    expect(() => formatSequenceNumber('CUST-', 1.5)).toThrow();
  });

  it('maps document types to prefixes with a DOC- fallback', () => {
    expect(prefixFor('customer')).toBe('CUST-');
    expect(prefixFor('supplier')).toBe('SUP-');
    expect(prefixFor('product')).toBe('PRD-');
    expect(prefixFor('sales_invoice')).toBe('INV-');
    expect(prefixFor('something_future')).toBe('DOC-');
  });

  it('never resets under resetPolicy=never', () => {
    const r = resolveNextNumber({ nextNumber: 41, resetPolicy: 'never', lastResetYear: 2024 }, 2026);
    expect(r).toEqual({ next: 41, lastResetYear: 2024 });
  });

  it('restarts at 1 when a yearly sequence crosses into a new year', () => {
    const r = resolveNextNumber({ nextNumber: 137, resetPolicy: 'yearly', lastResetYear: 2025 }, 2026);
    expect(r).toEqual({ next: 1, lastResetYear: 2026 });
  });

  it('keeps counting within the same year for yearly sequences', () => {
    const r = resolveNextNumber({ nextNumber: 7, resetPolicy: 'yearly', lastResetYear: 2026 }, 2026);
    expect(r).toEqual({ next: 7, lastResetYear: 2026 });
  });

  it('resets a yearly sequence that never recorded a year', () => {
    const r = resolveNextNumber({ nextNumber: 9, resetPolicy: 'yearly', lastResetYear: null }, 2026);
    expect(r).toEqual({ next: 1, lastResetYear: 2026 });
  });

  it('treats unknown policies as never-reset', () => {
    const r = resolveNextNumber({ nextNumber: 5, resetPolicy: 'whenever', lastResetYear: null }, 2026);
    expect(r).toEqual({ next: 5, lastResetYear: null });
  });
});
