/**
 * Phase 10: cross-client consistency (desktop ↔ web shared truth).
 *
 * The Tauri desktop app loads the same React bundle and talks to the same
 * NestJS API as the browser — there is no local database and no forked UI.
 * This test proves the shared-truth property at the API level: a record
 * created through the "web" path is visible through the "desktop" path,
 * because both paths are the same API.
 *
 * A full Tauri-webview drive is covered manually (screenshots in
 * docs/phase10/); driving a real webview from jest is out of scope.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestClient, resetTestDb } from './helpers';

describe('Cross-client consistency: web ↔ desktop shared truth (e2e)', () => {
  let app: INestApplication;
  let web: TestClient; // acts as the browser client
  let desktop: TestClient; // acts as the Tauri desktop client (separate session)
  let orgId: string;
  let companyId: string;
  let productId: string;

  beforeAll(async () => {
    await resetTestDb();
    const t = await createTestApp();
    app = t.app;
    web = t.client;
    desktop = new TestClient(request.agent(app.getHttpServer()));
    await desktop.initCsrf();

    // --- first-run (shared org) ---
    const fr = await web.post('/api/v1/auth/first-run', {
      organizationName: 'CrossClient Org',
      organizationNameAr: 'منظمة التكامل',
      adminName: 'Admin',
      adminEmail: 'xclient@atlas.test',
      password: 'XClient123!',
    });
    expect(fr.status).toBe(201);
    orgId = fr.body.organization.id;
    web.orgId = orgId;
    desktop.orgId = orgId;

    // desktop logs in as a SECOND session (same user, like the Tauri webview would)
    const login = await desktop.login('xclient@atlas.test', 'XClient123!');
    expect([200, 201]).toContain(login.status);

    const me = await web.get('/api/v1/auth/me');
    companyId = me.body.memberships[0].companyId ?? me.body.companies?.[0]?.id;
    if (!companyId) {
      const cos = await web.get('/api/v1/companies');
      companyId = cos.body[0]?.id ?? cos.body.data?.[0]?.id;
    }
    expect(companyId).toBeDefined();

    // fiscal year for journal posting
    await web.post('/api/v1/fiscal-years', {
      company_id: companyId, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('web creates a product; desktop sees it (shared truth)', async () => {
    const uom = await web.post('/api/v1/units-of-measure', {
      company_id: companyId, code: 'XC', name_ar: 'قطعة', name_en: 'Piece',
    });
    expect(uom.status).toBe(201);

    const prod = await web.post(
      '/api/v1/products',
      {
        company_id: companyId, sku: 'XC-001', name_ar: 'صنف تكامل', name_en: 'CrossClient Widget',
        type: 'stocked', base_uom_id: uom.body.id, purchase_price: '50', sales_price: '80',
      },
      { 'Idempotency-Key': 'xc-prod-1' },
    );
    expect(prod.status).toBe(201);
    productId = prod.body.id;

    // desktop (separate session, same API) reads the product list
    const list = await desktop.get(`/api/v1/products?company_id=${companyId}`);
    expect(list.status).toBe(200);
    const rows = list.body.data ?? list.body;
    expect(rows.some((p: any) => p.id === productId)).toBe(true);
  });

  it('desktop creates a customer; web sees it (shared truth)', async () => {
    const cust = await desktop.post(
      '/api/v1/customers',
      { company_id: companyId, name_ar: 'عميل تكامل', name_en: 'CrossClient Customer', kind: 'company' },
      { 'Idempotency-Key': 'xc-cust-1' },
    );
    expect(cust.status).toBe(201);

    const list = await web.get(`/api/v1/customers?company_id=${companyId}`);
    expect(list.status).toBe(200);
    const rows = list.body.data ?? list.body;
    expect(rows.some((c: any) => c.id === (cust.body.data?.id ?? cust.body.id))).toBe(true);
  });

  it('a journal posted from web is reflected in desktop trial balance', async () => {
    const accts = await web.get(`/api/v1/accounts?company_id=${companyId}`);
    const list = accts.body.data ?? accts.body;
    const bank = list.find((a: any) => a.code === '1110');
    const cap = list.find((a: any) => a.code === '3010');
    expect(bank && cap).toBeTruthy();

    const je = await web.post(
      '/api/v1/journal-entries',
      {
        company_id: companyId, journal_type: 'opening', posting_date: '2026-01-02',
        description: 'Cross-client opening',
        lines: [
          { account_id: bank.id, debit: '500.0000', credit: '0' },
          { account_id: cap.id, debit: '0', credit: '500.0000' },
        ],
      },
      { 'Idempotency-Key': 'xc-je-1' },
    );
    expect(je.status).toBe(201);
    await web.post(`/api/v1/journal-entries/${je.body.id}/submit`, {});
    const appr = await web.post(`/api/v1/journal-entries/${je.body.id}/approve`, {});
    expect(appr.status).toBe(200);
    const posted = await web.post(`/api/v1/journal-entries/${je.body.id}/post`, { version: 1 });
    expect(posted.status).toBe(200);

    // desktop reads the trial balance — the web-posted journal is there
    const tb = await desktop.get(
      `/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(tb.status).toBe(200);
    expect(tb.body.balanced).toBe(true);
    const bankLine = (tb.body.lines as any[]).find((l) => l.code === '1110');
    expect(bankLine).toBeDefined();
    expect(Number(bankLine.total_debit)).toBeGreaterThan(0);
  });
});
