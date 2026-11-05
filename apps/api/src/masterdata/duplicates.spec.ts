import { findDuplicateWarnings } from './duplicates';

describe('duplicate detection (pure logic)', () => {
  it('warns on a matching tax_id', () => {
    const w = findDuplicateWarnings(
      { taxId: '123-456', nameAr: 'شركة جديدة', nameEn: 'New Co' },
      [{ taxId: '123-456', nameAr: 'شركة قديمة', nameEn: 'Old Co' }],
    );
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('DUPLICATE_TAX_ID');
    expect(w[0].matched_field).toBe('tax_id');
    expect(w[0].message_ar).toContain('123-456');
  });

  it('warns on a case-insensitive name match (ar and en)', () => {
    const w = findDuplicateWarnings(
      { taxId: null, nameAr: 'الشركة المتحدة', nameEn: 'UNITED co' },
      [{ taxId: '999', nameAr: 'الشركة المتحدة', nameEn: 'Something Else' }],
    );
    expect(w.some((x) => x.code === 'DUPLICATE_NAME')).toBe(true);
    expect(w.some((x) => x.code === 'DUPLICATE_TAX_ID')).toBe(false);

    const w2 = findDuplicateWarnings(
      { taxId: null, nameAr: 'أخرى', nameEn: 'united CO' },
      [{ taxId: '999', nameAr: 'مختلفة', nameEn: 'United Co' }],
    );
    expect(w2.some((x) => x.code === 'DUPLICATE_NAME')).toBe(true);
  });

  it('ignores surrounding whitespace when comparing', () => {
    const w = findDuplicateWarnings(
      { taxId: ' 123 ', nameAr: '  شركة  ', nameEn: ' x ' },
      [{ taxId: '123', nameAr: 'شركة', nameEn: 'x' }],
    );
    expect(w.map((x) => x.code).sort()).toEqual(['DUPLICATE_NAME', 'DUPLICATE_TAX_ID']);
  });

  it('returns no warnings when nothing matches', () => {
    const w = findDuplicateWarnings(
      { taxId: '111', nameAr: 'أ', nameEn: 'A' },
      [{ taxId: '222', nameAr: 'ب', nameEn: 'B' }],
    );
    expect(w).toEqual([]);
  });

  it('does not false-positive on empty tax ids', () => {
    const w = findDuplicateWarnings(
      { taxId: null, nameAr: 'أ', nameEn: 'A' },
      [{ taxId: null, nameAr: 'ب', nameEn: 'B' }],
    );
    expect(w).toEqual([]);
  });

  it('can report both tax_id and name warnings together', () => {
    const w = findDuplicateWarnings(
      { taxId: '123', nameAr: 'نفس الاسم', nameEn: 'Same' },
      [{ taxId: '123', nameAr: 'نفس الاسم', nameEn: 'Same' }],
    );
    expect(w.map((x) => x.code).sort()).toEqual(['DUPLICATE_NAME', 'DUPLICATE_TAX_ID']);
  });
});
