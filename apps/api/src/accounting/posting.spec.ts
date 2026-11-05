import {
  assertBalanced, assertDraft, assertPeriodTransition, assertTransition,
  canTransition, canTransitionPeriod, computeFunctionalTotals,
  normalizeIdempotencyKey,
} from './posting';
import { AppException, Errors } from '../common/errors';

describe('posting (pure validation logic)', () => {
  describe('computeFunctionalTotals / assertBalanced', () => {
    const lines = [
      { debit: '1000.00', credit: '0' },
      { debit: '0', credit: '1000.00' },
    ];

    it('balances equal debits and credits at rate 1', () => {
      const t = assertBalanced(lines, '1', 2);
      expect(t.totalDebit.toFixed(2)).toBe('1000.00');
      expect(t.totalCredit.toFixed(2)).toBe('1000.00');
    });

    it('throws UNBALANCED_JOURNAL with bilingual details', () => {
      let caught: unknown;
      try {
        assertBalanced(
          [{ debit: '100', credit: '0' }, { debit: '0', credit: '99.99' }],
          '1', 2,
        );
      } catch (e) {
        caught = e;
      }
      const ex = caught as AppException & { details: { total_debit: string; total_credit: string } };
      expect(ex).toBeDefined();
      expect(ex.code).toBe('UNBALANCED_JOURNAL');
      expect(ex.getStatus()).toBe(422);
      expect(ex.details.total_debit).toBe('100.00');
      expect(ex.details.total_credit).toBe('99.99');
      expect(ex.messageAr).toContain('المدين');
    });

    it('converts each line at the exchange rate before comparing', () => {
      // 20 USD debit @ 50 = 1000 EGP; 1000 EGP credit @ 1... use same rate both sides:
      // entry currency USD, rate 50: Dr 20 USD -> 1000, Cr 20 USD -> 1000
      const t = computeFunctionalTotals(
        [{ debit: '20', credit: '0' }, { debit: '0', credit: '20' }],
        '50', 2,
      );
      expect(t.totalDebit.toFixed(2)).toBe('1000.00');
      expect(t.totalCredit.toFixed(2)).toBe('1000.00');
    });

    it('catches rounding-driven imbalance after conversion', () => {
      // 10 units @ 0.335 -> 3.35 debit vs 9.99 @ 0.335 -> 3.35 credit? no:
      // 10*0.335 = 3.35 ; 9.99*0.335 = 3.34665 -> 3.35. Use 9.9: 3.3165 -> 3.32.
      let caught: unknown;
      try {
        assertBalanced(
          [{ debit: '10', credit: '0' }, { debit: '0', credit: '9.9' }],
          '0.335', 2,
        );
      } catch (e) {
        caught = e;
      }
      expect((caught as { code: string }).code).toBe('UNBALANCED_JOURNAL');
    });

    it('sums exactly — no float drift on many lines', () => {
      const many = Array.from({ length: 10 }, () => ({ debit: '0.1', credit: '0' }))
        .concat(Array.from({ length: 10 }, () => ({ debit: '0', credit: '0.1' })));
      expect(() => assertBalanced(many, '1', 2)).not.toThrow();
    });
  });

  describe('journal state transitions', () => {
    it.each([
      ['draft', 'submitted', true],
      ['draft', 'approved', false],
      ['submitted', 'approved', true],
      ['submitted', 'draft', true], // reject
      ['submitted', 'posted', false],
      ['approved', 'posted', true],
      ['approved', 'draft', false],
      ['posted', 'reversed', true],
      ['posted', 'draft', false],
      ['reversed', 'draft', false],
    ])('%s -> %s allowed=%s', (from, to, allowed) => {
      expect(canTransition(from as never, to as never)).toBe(allowed);
    });

    it('throws JOURNAL_INVALID_TRANSITION (422) on illegal moves', () => {
      expect(() => assertTransition('draft', 'posted')).toThrow(
        expect.objectContaining({ code: 'JOURNAL_INVALID_TRANSITION', status: 422 }),
      );
      expect(() => assertTransition('draft', 'submitted')).not.toThrow();
    });

    it('assertDraft throws JOURNAL_NOT_DRAFT (409) for non-drafts', () => {
      expect(() => assertDraft('posted')).toThrow(
        expect.objectContaining({ code: 'JOURNAL_NOT_DRAFT', status: 409 }),
      );
      expect(() => assertDraft('submitted')).toThrow(
        expect.objectContaining({ code: 'JOURNAL_NOT_DRAFT', status: 409 }),
      );
      expect(() => assertDraft('draft')).not.toThrow();
    });
  });

  describe('period state transitions', () => {
    it.each([
      ['open', 'closed', true],
      ['open', 'locked', false],
      ['closed', 'locked', true],
      ['closed', 'open', true], // reopen
      ['locked', 'open', true], // reopen
      ['locked', 'closed', false],
      ['open', 'open', false],
    ])('%s -> %s allowed=%s', (from, to, allowed) => {
      expect(canTransitionPeriod(from as never, to as never)).toBe(allowed);
    });

    it('throws PERIOD_INVALID_TRANSITION (422)', () => {
      expect(() => assertPeriodTransition('open', 'locked')).toThrow(
        expect.objectContaining({ code: 'PERIOD_INVALID_TRANSITION', status: 422 }),
      );
    });
  });

  describe('normalizeIdempotencyKey', () => {
    it('trims and caps length at 100', () => {
      expect(normalizeIdempotencyKey('  abc12345  ')).toBe('abc12345');
      expect(normalizeIdempotencyKey('x'.repeat(200))).toHaveLength(100);
    });
  });

  describe('error catalog', () => {
    it('exposes all Phase 3 codes with bilingual messages', () => {
      const cases: Array<[() => AppException, string, number]> = [
        [() => Errors.unbalancedJournal('1', '2'), 'UNBALANCED_JOURNAL', 422],
        [() => Errors.journalTooFewLines(), 'JOURNAL_TOO_FEW_LINES', 422],
        [() => Errors.accountNotPostable('1000'), 'ACCOUNT_NOT_POSTABLE', 422],
        [() => Errors.glAccountInactive('1100'), 'ACCOUNT_INACTIVE', 422],
        [() => Errors.accountCompanyMismatch(), 'ACCOUNT_COMPANY_MISMATCH', 422],
        [() => Errors.accountHasPostings(), 'ACCOUNT_HAS_POSTINGS', 409],
        [() => Errors.periodClosed('2026-01'), 'PERIOD_CLOSED', 423],
        [() => Errors.periodNotDefined('2026-01-01'), 'PERIOD_NOT_DEFINED', 422],
        [() => Errors.journalNotDraft(), 'JOURNAL_NOT_DRAFT', 409],
        [() => Errors.journalNotPostable(), 'JOURNAL_NOT_POSTABLE', 422],
        [() => Errors.concurrentModification(), 'CONCURRENT_MODIFICATION', 409],
        [() => Errors.makerCheckerViolation(), 'MAKER_CHECKER_VIOLATION', 403],
      ];
      for (const [make, code, status] of cases) {
        const e = make();
        expect(e.code).toBe(code);
        expect(e.getStatus()).toBe(status);
        expect(e.messageAr.length).toBeGreaterThan(0);
      }
    });
  });
});
