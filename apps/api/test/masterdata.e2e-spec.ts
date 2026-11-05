/**
 * E2E: Phase 4 master data — numbering, parties, contacts/addresses,
 * categories, units, payment terms, products/variants, sequences,
 * attachments, CSV import/export, idempotency.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'md-admin@atlas.test';
const ADMIN_PASSWORD = 'test-admin-pass-1';

describe('Master data (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let orgId: string;
  let companyId: string;
  let pcsId: string;
  let kgId: string;
  let summaryAccountId: string; // 1000 — summary, non-postable
  let postableAccountId: string; // a postable asset account

  const multipart = (path: string) =>
    client.agent
      .post(path)
      .set('X-Organization-Id', orgId)
      .set('X-CSRF-Token', client.csrfToken ?? '');

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'MD Org',
      organizationNameAr: 'منظمة البيانات',
      adminName: 'MD Admin',
      adminEmail: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(fr.status).toBe(201);
    orgId = fr.body.organization.id;
    companyId = fr.body.company.id;
    client.orgId = orgId;

    const accounts = await client.get(`/api/v1/accounts?company_id=${companyId}`);
    expect(accounts.status).toBe(200);
    const byCode = new Map((accounts.body as Array<{ code: string; id: string; is_postable: boolean }>).map((a) => [a.code, a]));
    summaryAccountId = byCode.get('1000')!.id;
    expect(byCode.get('1000')!.is_postable).toBe(false);
    postableAccountId = (accounts.body as Array<{ code: string; id: string; is_postable: boolean }>)
      .find((a) => a.is_postable)!.id;
  }, 120000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // ---------- payment terms ----------

  it('creates, lists, updates and deactivates a payment term', async () => {
    const created = await client.post('/api/v1/payment-terms', {
      company_id: companyId, name_ar: 'نقدي', name_en: 'Cash', days: 0,
    });
    expect(created.status).toBe(201);
    expect(created.body.days).toBe(0);
    expect(created.body.is_active).toBe(true);
    const id = created.body.id;

    const list = await client.get(`/api/v1/payment-terms?company_id=${companyId}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const updated = await client.patch(`/api/v1/payment-terms/${id}`, { days: 30 });
    expect(updated.status).toBe(200);
    expect(updated.body.days).toBe(30);

    const deactivated = await client.post(`/api/v1/payment-terms/${id}/deactivate`, {});
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.is_active).toBe(false);
  });

  // ---------- customers ----------

  let customerId: string;

  it('creates a customer with an auto-allocated CUST- number', async () => {
    const res = await client.post('/api/v1/customers', {
      company_id: companyId,
      name_ar: 'عميل الاختبار',
      name_en: 'Test Customer',
      kind: 'company',
      tax_id: 'TAX-001',
      credit_limit: '5000.25',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe('CUST-000001');
    expect(res.body.data.credit_limit).toBe('5000.25');
    expect(res.body.data.status).toBe('active');
    expect(res.body.warnings).toEqual([]);
    customerId = res.body.data.id;
  });

  it('warns on duplicates but still creates (201)', async () => {
    const res = await client.post('/api/v1/customers', {
      company_id: companyId,
      name_ar: 'عميل الاختبار', // same name_ar, different case-insensitive match
      name_en: 'Totally Different',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe('CUST-000002');
    const codes = (res.body.warnings as Array<{ code: string }>).map((w) => w.code);
    expect(codes).toContain('DUPLICATE_NAME');
  });

  it('allocates 10 unique numbers under 10 parallel creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.post('/api/v1/customers', {
          company_id: companyId,
          name_ar: `عميل متوازي ${i}`,
          name_en: `Parallel Customer ${i}`,
        }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.data.number as string);
    expect(new Set(numbers).size).toBe(10);
    expect(numbers.every((n) => /^CUST-\d{6}$/.test(n))).toBe(true);
  });

  it('replays an idempotent create with the same Idempotency-Key', async () => {
    const key = 'idem-key-cust-0001';
    const first = await client.post(
      '/api/v1/customers',
      { company_id: companyId, name_ar: 'ثابت', name_en: 'Idem' },
      { 'Idempotency-Key': key },
    );
    expect(first.status).toBe(201);
    const second = await client.post(
      '/api/v1/customers',
      { company_id: companyId, name_ar: 'ثابت', name_en: 'Idem' },
      { 'Idempotency-Key': key },
    );
    expect(second.body.data.number).toBe(first.body.data.number);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('lists customers with pagination meta and search', async () => {
    const list = await client.get(`/api/v1/customers?company_id=${companyId}&page=1&per_page=5`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(5);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(13);
    expect(list.body.meta.page).toBe(1);
    expect(list.body.meta.per_page).toBe(5);

    const search = await client.get(`/api/v1/customers?company_id=${companyId}&search=Parallel Customer 3`);
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBe(1);
    expect(search.body.data[0].name_en).toBe('Parallel Customer 3');
  });

  it('updates a customer', async () => {
    const res = await client.patch(`/api/v1/customers/${customerId}`, {
      credit_limit: '7500',
      tax_id: 'TAX-001-UPDATED',
    });
    expect(res.status).toBe(200);
    expect(res.body.credit_limit).toBe('7500');
    expect(res.body.tax_id).toBe('TAX-001-UPDATED');
  });

  it('deactivates a customer (200) and it stays readable', async () => {
    const res = await client.post(`/api/v1/customers/${customerId}/deactivate`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');

    const get = await client.get(`/api/v1/customers/${customerId}`);
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('inactive');
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await client.get('/api/v1/customers/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  // ---------- suppliers ----------

  let supplierId: string;

  it('creates a supplier with SUP- numbering and company-base default currency', async () => {
    const res = await client.post('/api/v1/suppliers', {
      company_id: companyId,
      name_ar: 'مورد الاختبار',
      name_en: 'Test Supplier',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe('SUP-000001');
    expect(res.body.data.default_currency).toBe('EGP');
    supplierId = res.body.data.id;
  });

  it('creates a supplier with an explicit currency and deactivates it', async () => {
    const res = await client.post('/api/v1/suppliers', {
      company_id: companyId,
      name_ar: 'مورد دولار',
      name_en: 'USD Supplier',
      default_currency: 'USD',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.default_currency).toBe('USD');

    const de = await client.post(`/api/v1/suppliers/${res.body.data.id}/deactivate`, {});
    expect(de.status).toBe(200);
    expect(de.body.status).toBe('inactive');
  });

  it('rejects a supplier with an unknown currency', async () => {
    const res = await client.post('/api/v1/suppliers', {
      company_id: companyId,
      name_ar: 'س',
      name_en: 'S',
      default_currency: 'XXX',
    });
    expect(res.status).toBe(404);
  });

  // ---------- contacts & addresses ----------

  it('manages customer contacts (create/list/delete)', async () => {
    const created = await client.post(`/api/v1/customers/${customerId}/contacts`, {
      name: 'أحمد محمد',
      role: 'مدير مشتريات',
      phone: '+201001234567',
      email: 'ahmed@example.com',
      is_primary: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.is_primary).toBe(true);
    const contactId = created.body.id;

    const list = await client.get(`/api/v1/customers/${customerId}/contacts`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await client.delete(`/api/v1/customers/${customerId}/contacts/${contactId}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    const list2 = await client.get(`/api/v1/customers/${customerId}/contacts`);
    expect(list2.body).toHaveLength(0);
  });

  it('manages supplier addresses (create/list/delete)', async () => {
    const created = await client.post(`/api/v1/suppliers/${supplierId}/addresses`, {
      label: 'المقر الرئيسي',
      line1: 'شارع التسعين، التجمع الخامس',
      city: 'القاهرة',
      country: 'مصر',
      is_billing: true,
      is_shipping: true,
    });
    expect(created.status).toBe(201);
    const addressId = created.body.id;

    const list = await client.get(`/api/v1/suppliers/${supplierId}/addresses`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].city).toBe('القاهرة');

    const del = await client.delete(`/api/v1/suppliers/${supplierId}/addresses/${addressId}`);
    expect(del.status).toBe(200);

    const missing = await client.delete(`/api/v1/suppliers/${supplierId}/addresses/${addressId}`);
    expect(missing.status).toBe(404);
  });

  // ---------- product categories ----------

  it('builds a nested category tree and rejects parent cycles', async () => {
    const parent = await client.post('/api/v1/product-categories', {
      company_id: companyId, name_ar: 'إلكترونيات', name_en: 'Electronics',
    });
    expect(parent.status).toBe(201);
    const child = await client.post('/api/v1/product-categories', {
      company_id: companyId, name_ar: 'هواتف', name_en: 'Phones', parent_id: parent.body.id,
    });
    expect(child.status).toBe(201);

    const tree = await client.get(`/api/v1/product-categories?company_id=${companyId}`);
    expect(tree.status).toBe(200);
    const root = (tree.body as Array<{ id: string; children: unknown[] }>).find((c) => c.id === parent.body.id);
    expect(root).toBeDefined();
    expect(root!.children).toHaveLength(1);

    const cycle = await client.patch(`/api/v1/product-categories/${child.body.id}`, {
      parent_id: child.body.id,
    });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe('CATEGORY_PARENT_CYCLE');

    const de = await client.post(`/api/v1/product-categories/${child.body.id}/deactivate`, {});
    expect(de.status).toBe(200);
    expect(de.body.is_active).toBe(false);
  });

  // ---------- units of measure ----------

  it('creates units, rejects duplicate codes, and manages conversions', async () => {
    const pcs = await client.post('/api/v1/units-of-measure', {
      code: 'PCS', name_ar: 'قطعة', name_en: 'Piece',
    });
    expect(pcs.status).toBe(201);
    pcsId = pcs.body.id;

    const dup = await client.post('/api/v1/units-of-measure', {
      code: 'PCS', name_ar: 'مكرر', name_en: 'Duplicate',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');

    const kg = await client.post('/api/v1/units-of-measure', {
      code: 'KG', name_ar: 'كيلوجرام', name_en: 'Kilogram',
    });
    expect(kg.status).toBe(201);
    kgId = kg.body.id;

    const units = await client.get('/api/v1/units-of-measure');
    expect(units.status).toBe(200);
    expect((units.body as Array<{ code: string }>).some((u) => u.code === 'PCS')).toBe(true);

    const conv = await client.post('/api/v1/unit-conversions', {
      from_uom_id: pcsId, to_uom_id: kgId, factor: '0.5',
    });
    expect(conv.status).toBe(201);
    expect(conv.body.factor).toBe('0.5');
    expect(conv.body.from_uom.code).toBe('PCS');

    const dupConv = await client.post('/api/v1/unit-conversions', {
      from_uom_id: pcsId, to_uom_id: kgId, factor: '0.5',
    });
    expect(dupConv.status).toBe(409);

    const selfConv = await client.post('/api/v1/unit-conversions', {
      from_uom_id: pcsId, to_uom_id: pcsId, factor: '1',
    });
    expect(selfConv.status).toBe(400);

    const list = await client.get('/api/v1/unit-conversions');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await client.delete(`/api/v1/unit-conversions/${conv.body.id}`);
    expect(del.status).toBe(200);
  });

  // ---------- products ----------

  let productId: string;

  it('creates a product and rejects duplicate SKUs (409 DUPLICATE_SKU)', async () => {
    const res = await client.post('/api/v1/products', {
      company_id: companyId,
      sku: 'WIDGET-1',
      name_ar: 'ودجت',
      name_en: 'Widget',
      type: 'stocked',
      base_uom_id: pcsId,
      purchase_price: '10.5000',
      sales_price: '15.0000',
      inventory_account_id: postableAccountId,
    });
    expect(res.status).toBe(201);
    expect(res.body.sku).toBe('WIDGET-1');
    expect(res.body.base_uom.code).toBe('PCS');
    expect(res.body.inventory_account.id).toBe(postableAccountId);
    productId = res.body.id;

    const dup = await client.post('/api/v1/products', {
      company_id: companyId,
      sku: 'WIDGET-1',
      name_ar: 'مكرر',
      name_en: 'Duplicate',
      base_uom_id: pcsId,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_SKU');
  });

  it('rejects a product mapped to a non-postable ledger account (422)', async () => {
    const res = await client.post('/api/v1/products', {
      company_id: companyId,
      sku: 'WIDGET-BAD',
      name_ar: 'س',
      name_en: 'S',
      base_uom_id: pcsId,
      inventory_account_id: summaryAccountId, // 1000 = summary account
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACCOUNT_NOT_POSTABLE');
  });

  it('lists products with search, type filter and web-style sort params', async () => {
    await client.post('/api/v1/products', {
      company_id: companyId, sku: 'AAA-1', name_ar: 'أ', name_en: 'Aaa',
      type: 'service', base_uom_id: pcsId,
    });
    const sorted = await client.get(`/api/v1/products?company_id=${companyId}&sort=-sku`);
    expect(sorted.status).toBe(200);
    const skus = (sorted.body.data as Array<{ sku: string }>).map((p) => p.sku);
    expect(skus[0]).toBe('WIDGET-1');
    expect(skus[skus.length - 1]).toBe('AAA-1');

    const byName = await client.get(`/api/v1/products?company_id=${companyId}&sort=name`);
    expect(byName.status).toBe(200);

    const services = await client.get(`/api/v1/products?company_id=${companyId}&type=service`);
    expect(services.status).toBe(200);
    expect(services.body.data.every((p: { type: string }) => p.type === 'service')).toBe(true);

    const search = await client.get(`/api/v1/products?company_id=${companyId}&search=widget`);
    expect(search.body.data.length).toBe(1);
  });

  it('deactivates a product and it stays readable', async () => {
    const de = await client.post(`/api/v1/products/${productId}/deactivate`, {});
    expect(de.status).toBe(200);
    expect(de.body.is_active).toBe(false);
    const get = await client.get(`/api/v1/products/${productId}`);
    expect(get.status).toBe(200);
    expect(get.body.is_active).toBe(false);
  });

  it('manages product variants (create/list/update/delete)', async () => {
    const created = await client.post(`/api/v1/products/${productId}/variants`, {
      sku: 'WIDGET-1-RED',
      attributes: { color: 'red', size: 'M' },
    });
    expect(created.status).toBe(201);
    expect(created.body.attributes).toEqual({ color: 'red', size: 'M' });
    const variantId = created.body.id;

    const dup = await client.post(`/api/v1/products/${productId}/variants`, {
      sku: 'WIDGET-1-RED', attributes: {},
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_SKU');

    const list = await client.get(`/api/v1/products/${productId}/variants`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const updated = await client.patch(`/api/v1/products/${productId}/variants/${variantId}`, {
      attributes: { color: 'blue' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.attributes).toEqual({ color: 'blue' });

    const del = await client.delete(`/api/v1/products/${productId}/variants/${variantId}`);
    expect(del.status).toBe(200);
    const list2 = await client.get(`/api/v1/products/${productId}/variants`);
    expect(list2.body).toHaveLength(0);
  });

  // ---------- document sequences ----------

  it('previews, creates and lists document sequences', async () => {
    const preview = await client.get(
      `/api/v1/document-sequences/preview?company_id=${companyId}&document_type=customer`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.document_type).toBe('customer');
    expect(preview.body.prefix).toBe('CUST-');
    expect(preview.body.next_number).toBeGreaterThan(1);
    expect(preview.body.preview).toMatch(/^CUST-\d{6}$/);

    const created = await client.post('/api/v1/document-sequences', {
      company_id: companyId,
      document_type: 'sales_order',
      prefix: 'SO-',
      next_number: 100,
      reset_policy: 'never',
    });
    expect(created.status).toBe(201);
    expect(created.body.reset_policy).toBe('never');

    const soPreview = await client.get(
      `/api/v1/document-sequences/preview?company_id=${companyId}&document_type=sales_order`,
    );
    expect(soPreview.body.preview).toBe('SO-000100');

    // Switching to yearly reset: a sequence with no recorded year restarts at 1
    // for the current year (the reset rule, verified live).
    const yearly = await client.patch(`/api/v1/document-sequences/${created.body.id}`, {
      reset_policy: 'yearly',
    });
    expect(yearly.status).toBe(200);
    const yearlyPreview = await client.get(
      `/api/v1/document-sequences/preview?company_id=${companyId}&document_type=sales_order`,
    );
    expect(yearlyPreview.body.preview).toBe('SO-000001');
    expect(yearlyPreview.body.last_reset_year).toBe(new Date().getUTCFullYear());

    const list = await client.get(`/api/v1/document-sequences?company_id=${companyId}`);
    expect(list.status).toBe(200);
    expect((list.body as Array<{ document_type: string }>).some((s) => s.document_type === 'sales_order')).toBe(true);

    const patched = await client.patch(`/api/v1/document-sequences/${created.body.id}`, {
      next_number: 200,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.next_number).toBe(200);
  });

  // ---------- attachments ----------

  let attachmentId: string;
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it('uploads, lists, downloads and deletes an attachment', async () => {
    await client.initCsrf();
    const up = await multipart('/api/v1/attachments')
      .field('owner_type', 'customer')
      .field('owner_id', customerId)
      .attach('file', pngBytes, { filename: 'logo.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.file_name).toBe('logo.png');
    expect(up.body.mime).toBe('image/png');
    expect(up.body.size).toBe(pngBytes.length);
    attachmentId = up.body.id;

    const list = await client.get(`/api/v1/attachments?owner_type=customer&owner_id=${customerId}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const dl = await client.agent
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('X-Organization-Id', orgId);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toContain('inline');
    expect(Buffer.compare(dl.body as Buffer, pngBytes)).toBe(0);

    const del = await client.delete(`/api/v1/attachments/${attachmentId}`);
    expect(del.status).toBe(200);
    const dl2 = await client.agent
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('X-Organization-Id', orgId);
    expect(dl2.status).toBe(404);
  });

  it('rejects disallowed file types (422)', async () => {
    await client.initCsrf();
    const up = await multipart('/api/v1/attachments')
      .field('owner_type', 'customer')
      .field('owner_id', customerId)
      .attach('file', Buffer.from('MZ...'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(up.status).toBe(422);
    expect(up.body.code).toBe('INVALID_FILE_TYPE');
  });

  it('returns 403 when another org downloads the attachment', async () => {
    // Upload as org A admin.
    await client.initCsrf();
    const up = await multipart('/api/v1/attachments')
      .field('owner_type', 'customer')
      .field('owner_id', customerId)
      .attach('file', pngBytes, { filename: 'secret.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const otherOrgAttachment = up.body.id;

    // Build org B with its own user (Auditor: has master_data:view + customer:view).
    const orgB = await prisma.organization.create({
      data: { name: 'Org B', nameAr: 'منظمة ب', defaultCurrency: 'EGP', defaultTimezone: 'Africa/Cairo' },
    });
    const userB = await prisma.user.create({
      data: { email: 'orgb@atlas.test', passwordHash: await argon2.hash('secret123'), name: 'User B' },
    });
    const membershipB = await prisma.membership.create({
      data: { userId: userB.id, organizationId: orgB.id },
    });
    const auditor = await prisma.role.findFirstOrThrow({ where: { name: 'Auditor', isSystem: true } });
    await prisma.userRole.create({ data: { membershipId: membershipB.id, roleId: auditor.id } });

    await client.login('orgb@atlas.test', 'secret123');
    client.orgId = orgB.id;
    const dl = await client.agent
      .get(`/api/v1/attachments/${otherOrgAttachment}/download`)
      .set('X-Organization-Id', orgB.id);
    expect(dl.status).toBe(403);

    // Back to the org A admin for the remaining tests.
    await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    client.orgId = orgId;
  });

  // ---------- CSV ----------

  it('exports customers as BOM CSV with formula escaping', async () => {
    const res = await client.get(`/api/v1/customers/export?company_id=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('name_ar');
    expect(res.text).toContain('CUST-000001');
  });

  it('rejects a CSV import with one bad row (422) and persists nothing', async () => {
    const before = await client.get(`/api/v1/customers?company_id=${companyId}&per_page=1`);
    const totalBefore = before.body.meta.total;

    const csv = [
      'name_ar,name_en,kind,tax_id,payment_term,credit_limit,status',
      'عميل سليم,Valid Client,company,,100,active',
      'عميل ناقص,,company,,100,active', // row 3: name_en missing
    ].join('\n');
    await client.initCsrf();
    const res = await multipart(`/api/v1/customers/import?company_id=${companyId}`)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'import.csv', contentType: 'text/csv' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CSV_IMPORT_VALIDATION');
    expect((res.body.details.rows as Array<{ row: number }>).some((r) => r.row === 3)).toBe(true);

    const after = await client.get(`/api/v1/customers?company_id=${companyId}&per_page=1`);
    expect(after.body.meta.total).toBe(totalBefore);
  });

  it('imports a valid customer CSV', async () => {
    const csv = [
      'name_ar,name_en,kind,tax_id,payment_term,credit_limit,status',
      'عميل مستورد 1,Imported 1,company,TAX-I1,,250.5,active',
      'عميل مستورد 2,Imported 2,individual,,,,inactive',
    ].join('\n');
    await client.initCsrf();
    const res = await multipart(`/api/v1/customers/import?company_id=${companyId}`)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'import.csv', contentType: 'text/csv' });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
  });

  it('imports a valid product CSV and rejects a bad one atomically', async () => {
    const good = [
      'sku,name_ar,name_en,type,category,base_uom,purchase_price,sales_price,tax_code,reorder_level,is_active',
      'CSV-1,صنف أ,Item A,stocked,,PCS,5,7,,10,true',
      'CSV-2,صنف ب,Item B,service,,PCS,,,,,true',
    ].join('\n');
    await client.initCsrf();
    const ok = await multipart(`/api/v1/products/import?company_id=${companyId}`)
      .attach('file', Buffer.from(good, 'utf8'), { filename: 'products.csv', contentType: 'text/csv' });
    expect(ok.status).toBe(200);
    expect(ok.body.imported).toBe(2);

    const bad = [
      'sku,name_ar,name_en,type,category,base_uom,purchase_price,sales_price,tax_code,reorder_level,is_active',
      'CSV-3,صنف ج,Item C,stocked,,LITRE,5,7,,,true', // row 2: unknown uom
      'CSV-1,صنف د,Item D,stocked,,PCS,5,7,,,true', // row 3: duplicate SKU
    ].join('\n');
    await client.initCsrf();
    const fail = await multipart(`/api/v1/products/import?company_id=${companyId}`)
      .attach('file', Buffer.from(bad, 'utf8'), { filename: 'products.csv', contentType: 'text/csv' });
    expect(fail.status).toBe(422);
    expect((fail.body.details.rows as Array<{ row: number }>).map((r) => r.row).sort()).toEqual([2, 3]);

    const search = await client.get(`/api/v1/products?company_id=${companyId}&search=CSV-3`);
    expect(search.body.data).toHaveLength(0);
  });

  it('exports products as CSV', async () => {
    const res = await client.get(`/api/v1/products/export?company_id=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('CSV-1');
  });
});
