/**
 * CSV import/export for Phase 4 master data.
 *
 * Library choice (one line): csv-parse/sync — a server-side RFC-4180 parser
 * with proper quote/BOM handling and plain row arrays; papaparse targets
 * browsers and brings unneeded extras.
 *
 * Import contract: validate ALL rows first; any row error -> the caller must
 * abort with 422 and persist NOTHING.
 */
import { parse } from 'csv-parse/sync';

export interface CsvRowError {
  row: number; // 1-based file row (row 1 = header)
  field: string;
  message: string;
  message_ar: string;
}

export const CSV_BOM = '﻿';

const MONEY_CSV_RE = /^\d+(\.\d{1,4})?$/;

/** Parse CSV text -> lowercased headers + row objects (BOM stripped). */
export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^﻿/, '');
  const all = parse(clean, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as string[][];
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map((h) => h.trim().toLowerCase());
  const rows = all.slice(1).map((cols) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cols[i] ?? '').trim();
    });
    return rec;
  });
  return { headers, rows };
}

/**
 * Formula-injection guard for exports: any cell that starts with = + - @
 * (or tab/CR) is prefixed with a single quote so spreadsheets treat it as
 * text instead of executing it.
 */
export function escapeFormulaValue(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quoteCell(v: string): string {
  const e = escapeFormulaValue(v ?? '');
  return /[",\n\r]/.test(e) ? `"${e.replace(/"/g, '""')}"` : e;
}

/** Build a UTF-8-BOM CSV document from headers + rows of plain strings. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(quoteCell).join(',')];
  for (const r of rows) lines.push(r.map(quoteCell).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

function requiredHeadersError(missing: string[]): CsvRowError {
  return {
    row: 1,
    field: 'headers',
    message: `Missing required columns: ${missing.join(', ')}.`,
    message_ar: `أعمدة مطلوبة مفقودة: ${missing.join('، ')}.`,
  };
}

// ---------- parties (customers / suppliers) ----------

export interface PartyCsvLookups {
  /** normalized (lowercased, trimmed) payment-term name (ar or en) -> id */
  paymentTerms: Map<string, string>;
  /** ISO currency codes, for supplier default_currency */
  currencies?: Set<string>;
}

export interface ValidatedPartyRow {
  name_ar: string;
  name_en: string;
  kind: string;
  tax_id: string | null;
  payment_term_id: string | null;
  credit_limit: string | null;
  status: string;
  default_currency?: string | null;
}

const err = (row: number, field: string, message: string, message_ar: string): CsvRowError =>
  ({ row, field, message, message_ar });

function validatePartyRow(
  rec: Record<string, string>,
  rowNum: number,
  lookups: PartyCsvLookups,
  isSupplier: boolean,
): { data?: ValidatedPartyRow; errors: CsvRowError[] } {
  const errors: CsvRowError[] = [];
  const name_ar = rec['name_ar'] ?? '';
  const name_en = rec['name_en'] ?? '';
  if (!name_ar) errors.push(err(rowNum, 'name_ar', 'name_ar is required.', 'الاسم بالعربية مطلوب.'));
  if (!name_en) errors.push(err(rowNum, 'name_en', 'name_en is required.', 'الاسم بالإنجليزية مطلوب.'));

  const kind = rec['kind'] || 'company';
  if (kind !== 'individual' && kind !== 'company') {
    errors.push(err(rowNum, 'kind', 'kind must be individual or company.', 'النوع يجب أن يكون individual أو company.'));
  }

  const tax_id = rec['tax_id'] || null;
  if (tax_id && tax_id.length > 60) {
    errors.push(err(rowNum, 'tax_id', 'tax_id is too long (max 60).', 'الرقم الضريبي أطول من 60 حرفًا.'));
  }

  let payment_term_id: string | null = null;
  const pt = (rec['payment_term'] || '').trim();
  if (pt) {
    const id = lookups.paymentTerms.get(pt.toLowerCase());
    if (!id) {
      errors.push(err(rowNum, 'payment_term', `Unknown payment term "${pt}".`, `شرط دفع غير معروف "${pt}".`));
    } else {
      payment_term_id = id;
    }
  }

  let credit_limit: string | null = null;
  const cl = (rec['credit_limit'] || '').trim();
  if (cl) {
    if (!MONEY_CSV_RE.test(cl)) {
      errors.push(err(rowNum, 'credit_limit', 'credit_limit must be a non-negative number (max 4 decimals).', 'حد الائتمان يجب أن يكون رقمًا غير سالب (4 كسور عشرية كحد أقصى).'));
    } else {
      credit_limit = cl;
    }
  }

  const status = rec['status'] || 'active';
  if (status !== 'active' && status !== 'inactive') {
    errors.push(err(rowNum, 'status', 'status must be active or inactive.', 'الحالة يجب أن تكون active أو inactive.'));
  }

  let default_currency: string | null = null;
  if (isSupplier) {
    const cur = (rec['default_currency'] || '').trim().toUpperCase();
    if (cur) {
      if (!/^[A-Z]{3}$/.test(cur) || !lookups.currencies?.has(cur)) {
        errors.push(err(rowNum, 'default_currency', `Unknown currency "${cur}".`, `عملة غير معروفة "${cur}".`));
      } else {
        default_currency = cur;
      }
    }
  }

  if (errors.length > 0) return { errors };
  const data: ValidatedPartyRow = {
    name_ar, name_en, kind, tax_id, payment_term_id, credit_limit, status,
  };
  if (isSupplier) data.default_currency = default_currency;
  return { data, errors };
}

export function validateCustomerCsvRows(
  records: Record<string, string>[],
  lookups: PartyCsvLookups,
): { rows: ValidatedPartyRow[]; errors: CsvRowError[] } {
  return validatePartyCsvRows(records, lookups, false);
}

export function validateSupplierCsvRows(
  records: Record<string, string>[],
  lookups: PartyCsvLookups,
): { rows: ValidatedPartyRow[]; errors: CsvRowError[] } {
  return validatePartyCsvRows(records, lookups, true);
}

function validatePartyCsvRows(
  records: Record<string, string>[],
  lookups: PartyCsvLookups,
  isSupplier: boolean,
): { rows: ValidatedPartyRow[]; errors: CsvRowError[] } {
  const rows: ValidatedPartyRow[] = [];
  const errors: CsvRowError[] = [];
  for (let i = 0; i < records.length; i++) {
    const { data, errors: rowErrors } = validatePartyRow(records[i], i + 2, lookups, isSupplier);
    errors.push(...rowErrors);
    if (data) rows.push(data);
  }
  return { rows, errors };
}

// ---------- products ----------

export interface ProductCsvLookups {
  /** normalized category name (ar or en) -> id */
  categories: Map<string, string>;
  /** uppercase UoM code -> id */
  uoms: Map<string, string>;
  /** normalized tax-code name (ar or en) -> id */
  taxCodes: Map<string, string>;
  /** existing SKUs in the company (uppercase) */
  existingSkus: Set<string>;
}

export interface ValidatedProductRow {
  sku: string;
  name_ar: string;
  name_en: string;
  type: string;
  category_id: string | null;
  base_uom_id: string;
  purchase_price: string | null;
  sales_price: string | null;
  tax_code_id: string | null;
  reorder_level: string | null;
  is_active: boolean;
}

function moneyField(rec: Record<string, string>, field: string, rowNum: number, errors: CsvRowError[]): string | null {
  const v = (rec[field] || '').trim();
  if (!v) return null;
  if (!MONEY_CSV_RE.test(v)) {
    errors.push(err(rowNum, field, `${field} must be a non-negative number (max 4 decimals).`, `${field} يجب أن يكون رقمًا غير سالب (4 كسور عشرية كحد أقصى).`));
    return null;
  }
  return v;
}

export function validateProductCsvRows(
  records: Record<string, string>[],
  lookups: ProductCsvLookups,
): { rows: ValidatedProductRow[]; errors: CsvRowError[] } {
  const rows: ValidatedProductRow[] = [];
  const errors: CsvRowError[] = [];
  const seenSkus = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const rowNum = i + 2;
    const rec = records[i];
    const rowErrors: CsvRowError[] = [];

    const sku = (rec['sku'] || '').trim();
    if (!sku) {
      rowErrors.push(err(rowNum, 'sku', 'sku is required.', 'رمز الصنف مطلوب.'));
    } else if (sku.length > 60) {
      rowErrors.push(err(rowNum, 'sku', 'sku is too long (max 60).', 'رمز الصنف أطول من 60 حرفًا.'));
    } else if (seenSkus.has(sku.toUpperCase()) || lookups.existingSkus.has(sku.toUpperCase())) {
      rowErrors.push(err(rowNum, 'sku', `Duplicate SKU "${sku}".`, `رمز صنف مكرر "${sku}".`));
    }

    const name_ar = rec['name_ar'] ?? '';
    const name_en = rec['name_en'] ?? '';
    if (!name_ar) rowErrors.push(err(rowNum, 'name_ar', 'name_ar is required.', 'الاسم بالعربية مطلوب.'));
    if (!name_en) rowErrors.push(err(rowNum, 'name_en', 'name_en is required.', 'الاسم بالإنجليزية مطلوب.'));

    const type = rec['type'] || 'stocked';
    if (!['stocked', 'non_stock', 'service'].includes(type)) {
      rowErrors.push(err(rowNum, 'type', 'type must be stocked, non_stock or service.', 'النوع يجب أن يكون stocked أو non_stock أو service.'));
    }

    let category_id: string | null = null;
    const cat = (rec['category'] || '').trim();
    if (cat) {
      const id = lookups.categories.get(cat.toLowerCase());
      if (!id) {
        rowErrors.push(err(rowNum, 'category', `Unknown category "${cat}".`, `فئة غير معروفة "${cat}".`));
      } else {
        category_id = id;
      }
    }

    let base_uom_id = '';
    const uom = (rec['base_uom'] || '').trim().toUpperCase();
    if (!uom) {
      rowErrors.push(err(rowNum, 'base_uom', 'base_uom is required.', 'وحدة القياس الأساسية مطلوبة.'));
    } else {
      const id = lookups.uoms.get(uom);
      if (!id) {
        rowErrors.push(err(rowNum, 'base_uom', `Unknown unit of measure "${uom}".`, `وحدة قياس غير معروفة "${uom}".`));
      } else {
        base_uom_id = id;
      }
    }

    const purchase_price = moneyField(rec, 'purchase_price', rowNum, rowErrors);
    const sales_price = moneyField(rec, 'sales_price', rowNum, rowErrors);
    const reorder_level = moneyField(rec, 'reorder_level', rowNum, rowErrors);

    let tax_code_id: string | null = null;
    const tc = (rec['tax_code'] || '').trim();
    if (tc) {
      const id = lookups.taxCodes.get(tc.toLowerCase());
      if (!id) {
        rowErrors.push(err(rowNum, 'tax_code', `Unknown tax code "${tc}".`, `كود ضريبي غير معروف "${tc}".`));
      } else {
        tax_code_id = id;
      }
    }

    let is_active = true;
    const ia = (rec['is_active'] || '').trim().toLowerCase();
    if (ia === 'false' || ia === '0') is_active = false;
    else if (ia && ia !== 'true' && ia !== '1') {
      rowErrors.push(err(rowNum, 'is_active', 'is_active must be true or false.', 'is_active يجب أن تكون true أو false.'));
    }

    errors.push(...rowErrors);
    if (rowErrors.length === 0) {
      seenSkus.add(sku.toUpperCase());
      rows.push({
        sku, name_ar, name_en, type, category_id, base_uom_id,
        purchase_price, sales_price, tax_code_id, reorder_level, is_active,
      });
    }
  }
  return { rows, errors };
}

/** Header presence check; returns header-level errors (row 1) or []. */
export function requireHeaders(headers: string[], required: string[]): CsvRowError[] {
  const missing = required.filter((h) => !headers.includes(h));
  return missing.length > 0 ? [requiredHeadersError(missing)] : [];
}

export const CUSTOMER_CSV_HEADERS = [
  'name_ar', 'name_en', 'kind', 'tax_id', 'payment_term', 'credit_limit', 'status',
];
export const SUPPLIER_CSV_HEADERS = [...CUSTOMER_CSV_HEADERS, 'default_currency'];
export const PRODUCT_CSV_HEADERS = [
  'sku', 'name_ar', 'name_en', 'type', 'category', 'base_uom',
  'purchase_price', 'sales_price', 'tax_code', 'reorder_level', 'is_active',
];
