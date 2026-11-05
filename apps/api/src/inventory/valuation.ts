import Decimal from 'decimal.js';
import { toDecimal, roundMoney } from '../accounting/money';

/**
 * Inventory valuation policies.
 *
 * RULE: zero binary-float arithmetic on cost paths. Every value enters Decimal
 * through its exact decimal string representation.
 *
 * The ValuationPolicy interface is the seam for future FIFO: implement it and
 * swap the policy per product/company without touching InventoryService.
 * WeightedAverage is the Phase 5 policy (perpetual).
 */

export interface ValuationState {
  /** On-hand quantity before this movement. */
  qty: Decimal;
  /** Weighted-average unit cost before this movement. */
  avgCost: Decimal;
}

export interface ValuationResult {
  /** Quantity delta actually applied (signed). */
  quantityDelta: Decimal;
  /** Cost delta applied to inventory value (signed). */
  costDelta: Decimal;
  /** Resulting on-hand quantity. */
  resultingQty: Decimal;
  /** Resulting average unit cost. */
  resultingAvgCost: Decimal;
  /** Unit cost used for the movement line (e.g. COGS cost on issues). */
  movementUnitCost: Decimal;
}

export interface ValuationPolicy {
  readonly name: string;
  receive(state: ValuationState, qty: Decimal, unitCost: Decimal): ValuationResult;
  issue(state: ValuationState, qty: Decimal): ValuationResult;
  /** Customer/supplier return restocked at its original cost. */
  returnStock(state: ValuationState, qty: Decimal, originalUnitCost: Decimal): ValuationResult;
  adjust(state: ValuationState, qtyDelta: Decimal, unitCost?: Decimal): ValuationResult;
}

/**
 * Perpetual weighted-average costing.
 *
 * receive: newAvg = (qty*avg + inQty*inCost) / (qty + inQty)
 * issue:   COGS at current avg; avg unchanged; qty decreases.
 * adjust+: treated as a receipt at the given cost (or current avg when absent).
 * adjust-: treated as an issue at current avg.
 */
export class WeightedAveragePolicy implements ValuationPolicy {
  readonly name = 'weighted_average';
  /** Quantity scale kept in the DB: NUMERIC(19,4). */
  private static Q = 4;
  /** Cost scale: NUMERIC(19,4). */
  private static C = 4;

  private q(v: Decimal): Decimal {
    return v.toDecimalPlaces(WeightedAveragePolicy.Q, Decimal.ROUND_HALF_UP);
  }
  private c(v: Decimal): Decimal {
    return v.toDecimalPlaces(WeightedAveragePolicy.C, Decimal.ROUND_HALF_UP);
  }

  receive(state: ValuationState, qty: Decimal, unitCost: Decimal): ValuationResult {
    const q = this.q(toDecimal(qty));
    const uc = this.c(toDecimal(unitCost));
    if (q.lte(0)) throw new Error('receive quantity must be positive');
    if (uc.lt(0)) throw new Error('unit cost cannot be negative');
    const oldValue = state.qty.mul(state.avgCost);
    const inValue = q.mul(uc);
    const newQty = this.q(state.qty.plus(q));
    const newAvg = newQty.isZero()
      ? new Decimal(0)
      : this.c(oldValue.plus(inValue).div(newQty));
    return {
      quantityDelta: q,
      costDelta: this.c(inValue),
      resultingQty: newQty,
      resultingAvgCost: newAvg,
      movementUnitCost: uc,
    };
  }

  issue(state: ValuationState, qty: Decimal): ValuationResult {
    const q = this.q(toDecimal(qty));
    if (q.lte(0)) throw new Error('issue quantity must be positive');
    if (q.gt(state.qty)) throw new Error('issue exceeds on-hand quantity');
    const cogs = this.c(q.mul(state.avgCost));
    const newQty = this.q(state.qty.minus(q));
    return {
      quantityDelta: q.neg(),
      costDelta: cogs.neg(),
      resultingQty: newQty,
      resultingAvgCost: newQty.isZero() ? new Decimal(0) : this.c(state.avgCost),
      movementUnitCost: this.c(state.avgCost),
    };
  }

  returnStock(state: ValuationState, qty: Decimal, originalUnitCost: Decimal): ValuationResult {
    // A return restocks at its ORIGINAL cost (the cost it left at).
    return this.receive(state, qty, originalUnitCost);
  }

  adjust(state: ValuationState, qtyDelta: Decimal, unitCost?: Decimal): ValuationResult {
    const d = this.q(toDecimal(qtyDelta));
    if (d.isZero()) throw new Error('adjustment quantity cannot be zero');
    if (d.gt(0)) {
      return this.receive(state, d, unitCost === undefined ? state.avgCost : unitCost);
    }
    return this.issue(state, d.abs());
  }
}

/** Money rounding for journal postings derived from cost math (base currency). */
export function costMoney(value: Decimal, decimals: number): Decimal {
  return roundMoney(value, decimals);
}
