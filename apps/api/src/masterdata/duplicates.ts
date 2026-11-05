/**
 * Duplicate detection for parties (customers / suppliers).
 * Same company + (same tax_id OR same name_ar/name_en, case-insensitive)
 * produces warnings — the record is still created. Pure logic, no DB.
 */

export interface PartyLike {
  taxId?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
}

export interface DuplicateWarning {
  code: string;
  message: string;
  message_ar: string;
  matched_field: 'tax_id' | 'name';
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

export function findDuplicateWarnings(
  candidate: PartyLike,
  existing: PartyLike[],
): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = [];

  const taxId = (candidate.taxId ?? '').trim();
  if (taxId) {
    const hit = existing.some((e) => (e.taxId ?? '').trim() === taxId && taxId !== '');
    if (hit) {
      warnings.push({
        code: 'DUPLICATE_TAX_ID',
        message: `Another record already uses tax ID ${taxId}.`,
        message_ar: `يوجد سجل آخر بنفس الرقم الضريبي ${taxId}.`,
        matched_field: 'tax_id',
      });
    }
  }

  const ar = norm(candidate.nameAr);
  const en = norm(candidate.nameEn);
  const hit = existing.some(
    (e) => (ar !== '' && norm(e.nameAr) === ar) || (en !== '' && norm(e.nameEn) === en),
  );
  if (hit) {
    warnings.push({
      code: 'DUPLICATE_NAME',
      message: 'Another record already uses the same name.',
      message_ar: 'يوجد سجل آخر بنفس الاسم.',
      matched_field: 'name',
    });
  }

  return warnings;
}
