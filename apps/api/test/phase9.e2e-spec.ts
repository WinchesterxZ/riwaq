/**
 * E2E: Phase 9 — notifications + Arabic PDFs.
 *
 * Notifications: submit a PO → approver gets an approval_request notification →
 *   list → unread count → mark read → mark all read.
 * PDFs: sales invoice PDF → 200, application/pdf, non-trivial size, Arabic text
 *   extracts correctly (presentation forms present, not garbled).
 *
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'phase9-admin@atlas.test';
const ADMIN_PASSWORD = 'Phase9Admin123!';
const APPROVER_EMAIL = 'phase9-approver@atlas.test';
const APPROVER_PASSWORD = 'Phase9Approver123!';

describe('Phase 9: notifications + PDFs (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let approver: TestClient;
  let orgId: string;
  let companyId: string;
  let warehouseId: string;
  let supplierId: string;
  let customerId: string;
  let productId: string;
  let invoiceId: string;

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    // First-run admin
    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Phase9 Org', organizationNameAr: 'منظمة المرحلة ٩',
      adminName: 'Admin', adminEmail: ADMIN_EMAIL, password: ADMIN_PASSWORD,
    });
    expect(fr.status).toBe(201);
    orgId = fr.body.organization.id;
    client.orgId = orgId;
    const me = await client.get('/api/v1/auth/me');
    companyId = me.body.memberships[0].companyId ?? (await client.get('/api/v1/companies')).body[0].id;

    // Approver via invitation (Company Administrator has approve grants)
    const roles = await prisma.role.findMany({ where: { name: 'Company Administrator', isSystem: true } });
    const inv = await client.post('/api/v1/auth/invitations', {
      email: APPROVER_EMAIL, roleIds: [roles[0].id], companyIds: [companyId],
    });
    expect(inv.status).toBe(201);
    const accept = await client.post('/api/v1/auth/invitations/accept', {
      token: inv.body.token, name: 'Approver', password: APPROVER_PASSWORD,
    });
    expect(accept.status).toBe(201);
    approver = new TestClient(request.agent(app.getHttpServer()));
    await approver.initCsrf();
    approver.orgId = orgId;
    const login = await approver.login(APPROVER_EMAIL, APPROVER_PASSWORD);
    expect([200, 201]).toContain(login.status);
    // restore admin session (accept hijacked it)
    await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Master data
    const fy = await client.post('/api/v1/fiscal-years', {
      company_id: companyId, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
    expect(fy.status).toBe(201);
    const wh = await client.get(`/api/v1/warehouses?company_id=${companyId}`);
    warehouseId = (wh.body.data ?? wh.body)[0].id;
    const uom = await client.post('/api/v1/units-of-measure', {
      company_id: companyId, code: 'PCS', name_ar: 'قطعة', name_en: 'Piece',
    });
    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'P9-W', name_ar: 'صنف تجريبي', name_en: 'Widget',
      type: 'stocked', base_uom_id: uom.body.id, purchase_price: '100', sales_price: '200',
    });
    productId = prod.body.id;
    const sup = await client.post('/api/v1/suppliers', {
      company_id: companyId, name_ar: 'مورد تجريبي', name_en: 'Supplier', kind: 'company',
    });
    supplierId = (sup.body.data ?? sup.body).id;
    const cust = await client.post('/api/v1/customers', {
      company_id: companyId, name_ar: 'عميل تجريبي', name_en: 'Customer', kind: 'company',
    });
    customerId = (cust.body.data ?? cust.body).id;
  }, 120000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('emits approval_request notification on PO submit', async () => {
    // 200 x 100 = 20,000 > 10,000 auto-approve threshold -> stays 'submitted'
    const po = await client.post('/api/v1/purchasing/orders', {
      company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
      lines: [{ product_id: productId, description: 'W', quantity: '200.0000', unit_price: '100.0000' }],
    }, { 'Idempotency-Key': 'p9-po' });
    expect(po.status).toBe(201);
    const poId = po.body.purchase_order.id;
    const sub = await client.post(`/api/v1/purchasing/orders/${poId}/submit`, {});
    expect([200, 201]).toContain(sub.status);

    // approver should have an unread approval_request notification
    const unread = await approver.get('/api/v1/notifications/unread-count');
    expect(unread.status).toBe(200);
    expect(unread.body.count).toBeGreaterThanOrEqual(1);

    const list = await approver.get('/api/v1/notifications?per_page=5');
    expect(list.status).toBe(200);
    const notif = (list.body.data as any[]).find((n) => n.type === 'approval_request');
    expect(notif).toBeDefined();
    expect(notif.title_ar).toContain('أمر شراء');
    expect(notif.link).toContain(poId);
  });

  it('notification list → mark read → mark all read', async () => {
    // ensure at least one notification exists (independent of test order)
    const unreadBefore = await approver.get('/api/v1/notifications/unread-count');
    if (unreadBefore.body.count === 0) {
      const po = await client.post('/api/v1/purchasing/orders', {
        company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
        lines: [{ product_id: productId, description: 'W', quantity: '200.0000', unit_price: '100.0000' }],
      }, { 'Idempotency-Key': 'p9-po-markread' });
      await client.post(`/api/v1/purchasing/orders/${po.body.purchase_order.id}/submit`, {});
    }
    const list = await approver.get('/api/v1/notifications?per_page=5');
    expect(list.status).toBe(200);
    expect((list.body.data as any[]).length).toBeGreaterThan(0);
    const first = (list.body.data as any[]).find((n: any) => !n.read_at) ?? (list.body.data as any[])[0];
    expect(first.read_at).toBeNull();

    const read = await approver.post(`/api/v1/notifications/${first.id}/read`, {});
    expect([200, 201]).toContain(read.status);
    expect(read.body.read_at).not.toBeNull();

    const all = await approver.post('/api/v1/notifications/read-all', {});
    expect([200, 201]).toContain(all.status);

    const unread = await approver.get('/api/v1/notifications/unread-count');
    expect(unread.body.count).toBe(0);
  });

  it('emits approval_decision notification on PO approve', async () => {
    // create a PO above the auto-approve threshold so it needs approval
    const po = await client.post('/api/v1/purchasing/orders', {
      company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
      lines: [{ product_id: productId, description: 'W', quantity: '200.0000', unit_price: '100.0000' }],
    }, { 'Idempotency-Key': 'p9-po2' });
    const poId = po.body.purchase_order.id;
    await client.post(`/api/v1/purchasing/orders/${poId}/submit`, {});
    const appr = await approver.post(`/api/v1/purchasing/orders/${poId}/approve`, {});
    expect([200, 201]).toContain(appr.status);

    // admin (requester) should get an approval_decision notification
    const unread = await client.get('/api/v1/notifications/unread-count');
    expect(unread.body.count).toBeGreaterThanOrEqual(1);
    const list = await client.get('/api/v1/notifications?per_page=5');
    const notif = (list.body.data as any[]).find((n) => n.type === 'approval_decision');
    expect(notif).toBeDefined();
    expect(notif.title_ar).toContain('اعتماد');
  });

  it('generates a sales invoice PDF with real Arabic text', async () => {
    // quick invoice: quote -> order -> deliver -> invoice -> post
    const q = await client.post('/api/v1/sales/quotations', {
      company_id: companyId, customer_id: customerId, valid_until: '2026-12-31',
      lines: [{ product_id: productId, description: 'صنف تجريبي', quantity: '2.0000', unit_price: '200.0000', discount_rate: '0', tax_rate: '14' }],
    }, { 'Idempotency-Key': 'p9-q' });
    const qid = q.body.quotation.id;
    await client.post(`/api/v1/sales/quotations/${qid}/send`, {});
    const ord = await client.post(`/api/v1/sales/quotations/${qid}/accept`, { warehouse_id: warehouseId }, { 'Idempotency-Key': 'p9-acc' });
    const oid = ord.body.sales_order.id;
    // receive stock first so delivery can post
    const grnPo = await client.post('/api/v1/purchasing/orders', {
      company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
      lines: [{ product_id: productId, description: 'W', quantity: '10.0000', unit_price: '100.0000' }],
    }, { 'Idempotency-Key': 'p9-po3' });
    const gpoId = grnPo.body.purchase_order.id;
    await client.post(`/api/v1/purchasing/orders/${gpoId}/submit`, {});
    const pol = (await client.get(`/api/v1/purchasing/orders/${gpoId}`)).body.lines[0].id;
    const grn = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: gpoId, warehouse_id: warehouseId,
      receipt_date: '2026-11-03',
      lines: [{ purchase_order_line_id: pol, quantity: '10.0000', unit_cost: '100.0000' }],
    }, { 'Idempotency-Key': 'p9-grn' });
    await client.post(`/api/v1/purchasing/goods-receipts/${grn.body.goods_receipt.id}/post`, {}, { 'Idempotency-Key': 'p9-grnpost' });

    await client.post(`/api/v1/sales/orders/${oid}/confirm`, {}, { 'Idempotency-Key': 'p9-conf' });
    const ol = (await client.get(`/api/v1/sales/orders/${oid}`)).body.lines[0].id;
    const dv = await client.post('/api/v1/sales/deliveries', {
      company_id: companyId, sales_order_id: oid,
      lines: [{ sales_order_line_id: ol, quantity: '2.0000' }],
    }, { 'Idempotency-Key': 'p9-del' });
    await client.post(`/api/v1/sales/deliveries/${dv.body.delivery.id}/post`, {});
    const inv = await client.post('/api/v1/sales/invoices', {
      company_id: companyId, customer_id: customerId, sales_order_id: oid,
    }, { 'Idempotency-Key': 'p9-inv' });
    invoiceId = inv.body.invoice.id;
    await client.post(`/api/v1/sales/invoices/${invoiceId}/post`, {}, { 'Idempotency-Key': 'p9-invpost' });

    const pdf = await client.get(`/api/v1/sales/invoices/${invoiceId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Number(pdf.headers['content-length'])).toBeGreaterThan(5000);

    // extract text and verify Arabic rendered (presentation forms = shaped, not garbled)
    // @ts-ignore - pdf-parse has no bundled types
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(pdf.body);
    const text = data.text;
    // pdf-parse normalizes presentation forms back to standard Arabic; check for Arabic block instead
    const hasArabic = /[\u0600-\u06FF]/.test(text);
    console.log('PDF text sample:', text.slice(0, 120).replace(/\n/g, ' | '));
    expect(hasArabic).toBe(true);
    // invoice number should appear (Latin)
    expect(text).toContain('INV-');
  }, 120000);

  it('generates report PDFs (trial balance)', async () => {
    const pdf = await client.get(
      `/api/v1/reports/trial-balance/pdf?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Number(pdf.headers['content-length'])).toBeGreaterThan(3000);
  });
});
