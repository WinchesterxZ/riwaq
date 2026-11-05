import { STANDARD_COA } from './coa-seed';

describe('STANDARD_COA (Egyptian standard chart)', () => {
  it('has 5 summary parents + 13 postable leaves', () => {
    const parents = STANDARD_COA.filter((a) => !a.parentCode);
    const leaves = STANDARD_COA.filter((a) => a.parentCode);
    expect(parents).toHaveLength(5);
    expect(leaves).toHaveLength(14);
    expect(parents.every((p) => p.isPostable === false)).toBe(true);
    expect(leaves.every((l) => l.isPostable === true)).toBe(true);
  });

  it('summary parents are 1000/2000/3000/4000/5000 with the right types', () => {
    const byCode = new Map(STANDARD_COA.map((a) => [a.code, a]));
    expect(byCode.get('1000')!.type).toBe('ASSET');
    expect(byCode.get('2000')!.type).toBe('LIABILITY');
    expect(byCode.get('3000')!.type).toBe('EQUITY');
    expect(byCode.get('4000')!.type).toBe('REVENUE');
    expect(byCode.get('5000')!.type).toBe('EXPENSE');
  });

  it('contains the required leaf codes from ACCOUNTING_RULES.md §1', () => {
    const codes = new Set(STANDARD_COA.map((a) => a.code));
    for (const c of ['1100', '1110', '1210', '1230', '1310', '1320', '2110', '2120', '3010', '3020', '4110', '5110', '5210']) {
      expect(codes.has(c)).toBe(true);
    }
  });

  it('every leaf references an existing parent and codes are unique', () => {
    const codes = new Set(STANDARD_COA.map((a) => [a.code, a.parentCode]));
    const codeSet = new Set(STANDARD_COA.map((a) => a.code));
    expect(codeSet.size).toBe(STANDARD_COA.length);
    for (const [code, parentCode] of codes) {
      if (parentCode) expect(codeSet.has(parentCode as string)).toBe(true);
    }
  });

  it('has Arabic and English names for every account', () => {
    for (const a of STANDARD_COA) {
      expect(a.nameAr.length).toBeGreaterThan(0);
      expect(a.nameEn.length).toBeGreaterThan(0);
    }
  });
});
