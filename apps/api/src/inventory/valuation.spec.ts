import Decimal from 'decimal.js';
import { WeightedAveragePolicy, ValuationState } from './valuation';

const state = (qty: string, avg: string): ValuationState => ({
  qty: new Decimal(qty),
  avgCost: new Decimal(avg),
});

describe('WeightedAveragePolicy', () => {
  const policy = new WeightedAveragePolicy();

  it('first receipt sets quantity and average cost', () => {
    const r = policy.receive(state('0', '0'), new Decimal('10'), new Decimal('100'));
    expect(r.resultingQty.toFixed(4)).toBe('10.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('100.0000');
    expect(r.costDelta.toFixed(4)).toBe('1000.0000');
    expect(r.movementUnitCost.toFixed(4)).toBe('100.0000');
  });

  it('blends average on a second receipt at a different cost', () => {
    // 10 @ 100 then 10 @ 200 -> avg 150
    const r = policy.receive(state('10', '100'), new Decimal('10'), new Decimal('200'));
    expect(r.resultingQty.toFixed(4)).toBe('20.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('150.0000');
  });

  it('issue values COGS at current average and keeps average unchanged', () => {
    const r = policy.issue(state('20', '150'), new Decimal('5'));
    expect(r.resultingQty.toFixed(4)).toBe('15.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('150.0000');
    expect(r.costDelta.toFixed(4)).toBe('-750.0000'); // COGS 750
    expect(r.movementUnitCost.toFixed(4)).toBe('150.0000');
  });

  it('full issue zeroes quantity and average', () => {
    const r = policy.issue(state('15', '150'), new Decimal('15'));
    expect(r.resultingQty.toFixed(4)).toBe('0.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('0.0000');
  });

  it('return restocks at the original cost, not the current average', () => {
    // avg drifted to 150 after a price rise; return of goods sold at 100
    const r = policy.returnStock(state('10', '150'), new Decimal('2'), new Decimal('100'));
    // (10*150 + 2*100) / 12 = 1700/12 = 141.6666... -> 141.6667
    expect(r.resultingQty.toFixed(4)).toBe('12.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('141.6667');
  });

  it('positive adjustment behaves like a receipt at given cost', () => {
    const r = policy.adjust(state('10', '100'), new Decimal('5'), new Decimal('120'));
    expect(r.resultingQty.toFixed(4)).toBe('15.0000');
    expect(r.resultingAvgCost.toFixed(4)).toBe('106.6667'); // (1000+600)/15
  });

  it('positive adjustment without cost uses current average', () => {
    const r = policy.adjust(state('10', '100'), new Decimal('5'));
    expect(r.resultingAvgCost.toFixed(4)).toBe('100.0000');
  });

  it('negative adjustment behaves like an issue at average', () => {
    const r = policy.adjust(state('10', '100'), new Decimal('-3'));
    expect(r.resultingQty.toFixed(4)).toBe('7.0000');
    expect(r.costDelta.toFixed(4)).toBe('-300.0000');
  });

  it('float-trap: 0.1 + 0.2 style costs stay exact', () => {
    const r = policy.receive(state('0', '0'), new Decimal('3'), new Decimal('0.1'));
    const r2 = policy.receive(
      { qty: r.resultingQty, avgCost: r.resultingAvgCost },
      new Decimal('3'), new Decimal('0.2'),
    );
    expect(r2.resultingAvgCost.toFixed(4)).toBe('0.1500');
    expect(r2.costDelta.toFixed(4)).toBe('0.6000');
  });

  it('rounds half-up at the 4th decimal', () => {
    // (1 * 2.6755) / 1 -> 2.6755 exact; blended: (10*100 + 1*2.6755)/11 = 91.1523...
    const r = policy.receive(state('10', '100'), new Decimal('1'), new Decimal('2.6755'));
    expect(r.resultingAvgCost.toFixed(4)).toBe('91.1523');
  });

  it('rejects zero/negative receive and over-issue', () => {
    expect(() => policy.receive(state('0', '0'), new Decimal('0'), new Decimal('1'))).toThrow();
    expect(() => policy.issue(state('5', '10'), new Decimal('6'))).toThrow();
    expect(() => policy.adjust(state('5', '10'), new Decimal('0'))).toThrow();
  });

  it('reproduces the §27-style purchase then sale valuation', () => {
    // Buy 10 @ 100, sell 3 -> 7 @ 100, COGS 300
    const buy = policy.receive(state('0', '0'), new Decimal('10'), new Decimal('100'));
    const sell = policy.issue(
      { qty: buy.resultingQty, avgCost: buy.resultingAvgCost }, new Decimal('3'),
    );
    expect(sell.resultingQty.toFixed(4)).toBe('7.0000');
    expect(sell.resultingAvgCost.toFixed(4)).toBe('100.0000');
    expect(sell.costDelta.toFixed(4)).toBe('-300.0000');
  });
});
