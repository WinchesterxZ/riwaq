import {
  parseCsvText, escapeFormulaValue, toCsv, requireHeaders,
  validateCustomerCsvRows, validateSupplierCsvRows, validateProductCsvRows,
  CUSTOMER_CSV_HEADERS, SUPPLIER_CSV_HEADERS, PRODUCT_CSV_HEADERS,
} from './csv';

describe('csv helpers', () => {
  it('strips the BOM and lowercases/trims headers', () => {
    const { headers, rows } = parseCsvText('﻿Name_AR , NAME_en\r\n  a , b \r\n');
    expect(headers).toEqual(['name_ar', 'name_en']);
    expect(rows).toEqual([{ name_ar: 'a', name_en: 'b' }]);
  });

  it('returns empty headers/rows for an empty file', () => {
    expect(parseCsvText('')).toEqual({ headers: [], rows: [] });
  });

  it('escapes formula-injection prefixes for export', () => {
    expect(escapeFormulaValue('=cmd|/c')).toBe("'=cmd|/c");
    expect(escapeFormulaValue('+123')).toBe("'+123");
    expect(escapeFormulaValue('-5')).toBe("'-5");
    expect(escapeFormulaValue('@user')).toBe("'@user");
    expect(escapeFormulaValue('normal text')).toBe('normal text');
    expect(escapeFormulaValue('')).toBe('');
  });

  it('builds a BOM CSV with quoting and formula escaping', () => {
    const csv = toCsv(['a', 'b'], [['x,y', '=bad']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain("'=bad");
  });

  it('flags missing required headers at row 1', () => {
    const errors = requireHeaders(['name_ar'], CUSTOMER_CSV_HEADERS);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].field).toBe('headers');
    expect(requireHeaders(CUSTOMER_CSV_HEADERS, CUSTOMER_CSV_HEADERS)).toEqual([]);
  });
});

describe('customer CSV row validation', () => {
  const lookups = {
    paymentTerms: new Map([['net 30', 'term-id-1'], ['نقدي', 'term-id-2']]),
  };

  it('accepts a fully valid row', () => {
    const { rows, errors } = validateCustomerCsvRows(
      [{ name_ar: 'عميل', name_en: 'Client', kind: 'company', tax_id: '123', payment_term: 'Net 30', credit_limit: '1000.50', status: 'active' }],
      lookups,
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name_ar: 'عميل', kind: 'company', tax_id: '123',
      payment_term_id: 'term-id-1', credit_limit: '1000.50', status: 'active',
    });
  });

  it('defaults kind/status and leaves optionals null', () => {
    const { rows, errors } = validateCustomerCsvRows(
      [{ name_ar: 'أ', name_en: 'B' }],
      lookups,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      kind: 'company', tax_id: null, payment_term_id: null,
      credit_limit: null, status: 'active',
    });
  });

  it('reports every bad row with its file row number', () => {
    const { rows, errors } = validateCustomerCsvRows(
      [
        { name_ar: '', name_en: 'NoAr' }, // row 2
        { name_ar: 'أ', name_en: 'B', kind: 'weird' }, // row 3
        { name_ar: 'أ', name_en: 'B', payment_term: 'Nope' }, // row 4
        { name_ar: 'أ', name_en: 'B', credit_limit: '-5' }, // row 5
        { name_ar: 'ok', name_en: 'Ok' }, // row 6 valid
      ],
      lookups,
    );
    expect(rows).toHaveLength(1);
    const byRow = new Map(errors.map((e) => [e.row, e.field]));
    expect(byRow.get(2)).toBe('name_ar');
    expect(byRow.get(3)).toBe('kind');
    expect(byRow.get(4)).toBe('payment_term');
    expect(byRow.get(5)).toBe('credit_limit');
    expect(errors.every((e) => e.message_ar && e.message_ar.length > 0)).toBe(true);
  });
});

describe('supplier CSV row validation', () => {
  it('validates default_currency against the currency set', () => {
    const lookups = {
      paymentTerms: new Map<string, string>(),
      currencies: new Set(['EGP', 'USD']),
    };
    const bad = validateSupplierCsvRows(
      [{ name_ar: 'م', name_en: 'S', default_currency: 'XXX' }],
      lookups,
    );
    expect(bad.errors.some((e) => e.field === 'default_currency')).toBe(true);

    const good = validateSupplierCsvRows(
      [{ name_ar: 'م', name_en: 'S', default_currency: 'usd' }],
      lookups,
    );
    expect(good.errors).toEqual([]);
    expect(good.rows[0].default_currency).toBe('USD');
  });
});

describe('product CSV row validation', () => {
  const lookups = {
    categories: new Map([['electronics', 'cat-1']]),
    uoms: new Map([['PCS', 'uom-1']]),
    taxCodes: new Map([['vat 14%', 'tax-1']]),
    existingSkus: new Set(['SKU-EXISTING']),
  };

  it('accepts a valid product row', () => {
    const { rows, errors } = validateProductCsvRows(
      [{
        sku: 'SKU-1', name_ar: 'صنف', name_en: 'Item', type: 'stocked',
        category: 'Electronics', base_uom: 'pcs', purchase_price: '10.25',
        sales_price: '15', tax_code: 'VAT 14%', reorder_level: '5', is_active: 'true',
      }],
      lookups,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      sku: 'SKU-1', category_id: 'cat-1', base_uom_id: 'uom-1',
      purchase_price: '10.25', tax_code_id: 'tax-1', is_active: true,
    });
  });

  it('rejects duplicates within the file and against the DB', () => {
    const { errors } = validateProductCsvRows(
      [
        { sku: 'SKU-A', name_ar: 'أ', name_en: 'A', base_uom: 'PCS' },
        { sku: 'sku-a', name_ar: 'ب', name_en: 'B', base_uom: 'PCS' }, // row 3: dup in file
        { sku: 'SKU-EXISTING', name_ar: 'ج', name_en: 'C', base_uom: 'PCS' }, // row 4: dup in DB
      ],
      lookups,
    );
    const skuErrors = errors.filter((e) => e.field === 'sku');
    expect(skuErrors.map((e) => e.row).sort()).toEqual([3, 4]);
  });

  it('rejects unknown uom/category/tax code and bad type', () => {
    const { errors } = validateProductCsvRows(
      [{
        sku: 'SKU-9', name_ar: 'أ', name_en: 'A', type: 'weird',
        category: 'Nope', base_uom: 'LITRE', tax_code: 'Nope',
      }],
      lookups,
    );
    const fields = new Set(errors.map((e) => e.field));
    expect(fields.has('type')).toBe(true);
    expect(fields.has('category')).toBe(true);
    expect(fields.has('base_uom')).toBe(true);
    expect(fields.has('tax_code')).toBe(true);
  });

  it('requires sku, names and base_uom', () => {
    const { errors } = validateProductCsvRows([{}], lookups);
    const fields = new Set(errors.map((e) => e.field));
    expect(fields.has('sku')).toBe(true);
    expect(fields.has('name_ar')).toBe(true);
    expect(fields.has('name_en')).toBe(true);
    expect(fields.has('base_uom')).toBe(true);
  });

  it('exports header constants covering every validated column', () => {
    expect(CUSTOMER_CSV_HEADERS).toContain('name_ar');
    expect(SUPPLIER_CSV_HEADERS).toContain('default_currency');
    expect(PRODUCT_CSV_HEADERS).toContain('base_uom');
  });
});
