/**
 * E2E: negative security tests (Phase 11).
 * Each test is an ATTACK that must be REJECTED. A passing test means the
 * system correctly refused the malicious action.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, resetTestDb } from './helpers';

describe('Security negative tests (e2e)', () => {
  let app: INestApplication;
  let admin: TestClient;
  let orgId: string;
  let companyId: string;

  beforeAll(async () => {
    resetTestDb();
    const boot = await createTestApp();
    app = boot.app;
    admin = boot.client;
    const first = await admin.post('/api/v1/auth/first-run', {
      organizationName: 'Sec Org',
      organizationNameAr: 'منظمة أمن',
      adminName: 'Sec Admin',
      adminEmail: 'sec-admin@atlas.test',
      password: 'SecAdmin123!',
    });
    expect(first.status).toBe(201);
    orgId = first.body.organization.id;
    admin.orgId = orgId;
    await admin.initCsrf();
    const cos = await admin.get('/api/v1/companies');
    companyId = cos.body[0].id;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  async function makeAccountant(): Promise<TestClient> {
    const { app: a2, client } = await createTestApp();
    const roles = await admin.get('/api/v1/roles');
    const acct = (roles.body as Array<{ id: string; name: string }>).find(
      (r) => r.name === 'Accountant',
    );
    expect(acct).toBeDefined();
    const inv = await admin.post('/api/v1/auth/invitations', {
      email: 'sec-acct@atlas.test',
      roleIds: [acct!.id],
      companyIds: [companyId],
    });
    expect(inv.status).toBe(201);
    await client.post('/api/v1/auth/invitations/accept', {
      token: inv.body.token,
      name: 'Sec Accountant',
      password: 'SecAcct123!',
    });
    await client.login('sec-acct@atlas.test', 'SecAcct123!');
    client.orgId = orgId;
    await client.initCsrf();
    (client as any).__app = a2;
    return client;
  }

  it('(1) unauthenticated access to a protected endpoint -> 401', async () => {
    const { app: a2, client } = await createTestApp();
    try {
      const res = await client.get('/api/v1/companies');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    } finally {
      await a2.close();
    }
  });

  it('(2) privilege escalation: accountant calls admin-only endpoint -> 403', async () => {
    const acct = await makeAccountant();
    try {
      // user:manage is admin-only; accountant must be rejected
      const res = await acct.post('/api/v1/auth/invitations', {
        email: 'evil@atlas.test',
        roleIds: [],
      });
      expect(res.status).toBe(403);
    } finally {
      await (acct as any).__app.close();
    }
  });

  it('(3) CSRF token missing on state-changing request -> 403', async () => {
    const { app: a2, client } = await createTestApp();
    try {
      await client.login('sec-admin@atlas.test', 'SecAdmin123!');
      client.orgId = orgId;
      // deliberately NOT calling initCsrf - but the agent has the atlas_csrf cookie from login
      // clear the header by ensuring csrfToken is null
      client.csrfToken = null;
      const res = await client.post('/api/v1/fiscal-years', {
        company_id: companyId,
        name: 'NoCsrf',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      });
      // The CSRF guard requires X-CSRF-Token header matching the atlas_csrf cookie.
      // Without the header, it must be rejected.
      expect([403]).toContain(res.status);
      if (res.status === 403) expect(res.body.code).toBe('CSRF_INVALID');
    } finally {
      await a2.close();
    }
  });

  it('(4) tampered session cookie -> 401', async () => {
    const { app: a2, client } = await createTestApp();
    try {
      // don't login; just present a forged session cookie
      const res = await client.agent
        .get('/api/v1/companies')
        .set('Cookie', 'atlas_session=forged-value-here; atlas_csrf=forged-csrf')
        .set('X-CSRF-Token', 'forged-csrf');
      expect([401, 403]).toContain(res.status);
    } finally {
      await a2.close();
    }
  });

  it('(5) idempotency replay with a DIFFERENT body -> returns original, no duplicate', async () => {
    const key = 'sec-idem-1';
    const base = {
      company_id: companyId,
      name: 'IdemTest',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    };
    const r1 = await admin.post('/api/v1/fiscal-years', base, {
      'Idempotency-Key': key,
    });
    expect([200, 201]).toContain(r1.status);
    // same key, different body: the interceptor replays the ORIGINAL response.
    // No duplicate record must be created.
    const r2 = await admin.post(
      '/api/v1/fiscal-years',
      { ...base, name: 'IdemTestEVIL' },
      { 'Idempotency-Key': key },
    );
    // either replays original (200/201 with same id) or rejects - but NEVER creates a duplicate
    const list = await admin.get(`/api/v1/fiscal-years?company_id=${companyId}`);
    const matches = (list.body as any[]).filter((f: any) =>
      f.name.startsWith('IdemTest'),
    );
    expect(matches.length).toBe(1);
    expect(matches[0].name).toBe('IdemTest');
  });

  it('(6) SQL injection in search param -> safe (200, no leak)', async () => {
    const res = await admin.get(
      `/api/v1/products?company_id=${companyId}&search=' OR '1'='1'; DROP TABLE products; --`,
    );
    expect(res.status).toBe(200);
    // products table still exists
    const check = await admin.get(`/api/v1/products?company_id=${companyId}`);
    expect(check.status).toBe(200);
  });

  it('(7) posting a journal to a closed period -> 422', async () => {
    // create FY + close its first period
    const fy = await admin.post('/api/v1/fiscal-years', {
      company_id: companyId,
      name: 'SecFY',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    expect([200, 201]).toContain(fy.status);
    const periods = await admin.get(
      `/api/v1/accounting-periods?fiscal_year_id=${fy.body.id}`,
    );
    const periodList = (periods.body.data ?? periods.body) as any[];
    const p1 = periodList.find((p: any) => p.id);
    expect(p1).toBeDefined();
    const close = await admin.post(`/api/v1/accounting-periods/${p1.id}/close`, {});
    expect(close.status).toBe(200);
    // now try to post a journal dated inside the closed period
    const accts = await admin.get(`/api/v1/accounts?company_id=${companyId}`);
    const list = (accts.body.data ?? accts.body) as any[];
    const bank = list.find((a: any) => a.code === '1110');
    const cap = list.find((a: any) => a.code === '3010');
    const je = await admin.post('/api/v1/journal-entries', {
      company_id: companyId,
      journal_type: 'general',
      posting_date: '2026-01-15',
      description: 'attack closed period',
      lines: [
        { account_id: bank.id, debit: '10.0000', credit: '0' },
        { account_id: cap.id, debit: '0', credit: '10.0000' },
      ],
    });
    // creation may succeed (draft) but posting must fail
    if ([200, 201].includes(je.status)) {
      await admin.post(`/api/v1/journal-entries/${je.body.id}/submit`, {});
      await admin.post(`/api/v1/journal-entries/${je.body.id}/approve`, {});
      const post = await admin.post(
        `/api/v1/journal-entries/${je.body.id}/post`,
        { version: je.body.version },
      );
      // 423 Locked - the period is closed, posting is rejected
      expect(post.status).toBe(423);
      expect(post.body.code).toBe('PERIOD_CLOSED');
    } else {
      expect(je.status).toBe(422);
    }
  });

  it('(8) self-approval of a purchase order above threshold -> 403', async () => {
    // create supplier + product + warehouse via admin
    const uom = await admin.post('/api/v1/units-of-measure', {
      company_id: companyId,
      code: 'SEC',
      name_ar: 'وحدة',
      name_en: 'Unit',
    });
    const prod = await admin.post('/api/v1/products', {
      company_id: companyId,
      sku: 'SEC-1',
      name_ar: 'صنف',
      name_en: 'Item',
      type: 'stocked',
      base_uom_id: uom.body.id,
      purchase_price: '6000',
      sales_price: '7000',
    });
    const sup = await admin.post('/api/v1/suppliers', {
      company_id: companyId,
      name_ar: 'مورد',
      name_en: 'Supplier',
      kind: 'company',
    });
    const wh = await admin.get(`/api/v1/warehouses?company_id=${companyId}`);
    const whId = (wh.body.data ?? wh.body)[0].id;
    // PO above 10,000 approval threshold, created by admin
    const po = await admin.post('/api/v1/purchasing/orders', {
      company_id: companyId,
      supplier_id: sup.body.data.id,
      warehouse_id: whId,
      lines: [
        {
          product_id: prod.body.id,
          description: 'x',
          quantity: '2.0000',
          unit_price: '6000.0000',
        },
      ],
    });
    expect([200, 201]).toContain(po.status);
    const poId = po.body.purchase_order.id;
    await admin.post(`/api/v1/purchasing/orders/${poId}/submit`, {});
    // admin tries to approve their own PO -> 403
    const appr = await admin.post(`/api/v1/purchasing/orders/${poId}/approve`, {});
    expect(appr.status).toBe(403);
  });

  it('(9) negative and zero quantities rejected -> 422', async () => {
    const uom = await admin.post('/api/v1/units-of-measure', {
      company_id: companyId,
      code: 'SEC2',
      name_ar: 'وحدة',
      name_en: 'Unit',
    });
    const neg = await admin.post('/api/v1/products', {
      company_id: companyId,
      sku: 'SEC-NEG',
      name_ar: 'صنف',
      name_en: 'Item',
      type: 'stocked',
      base_uom_id: uom.body.id,
      purchase_price: '-5',
      sales_price: '10',
    });
    // rejected by validation (400) or business rule (422) - either is a rejection
    expect([400, 422]).toContain(neg.status);
    const wh = await admin.get(`/api/v1/warehouses?company_id=${companyId}`);
    const whId = (wh.body.data ?? wh.body)[0].id;
    const issue = await admin.post('/api/v1/inventory/movements/issue', {
      company_id: companyId,
      warehouse_id: whId,
      lines: [],
    });
    // empty lines or zero qty must not succeed silently
    expect([400, 422]).toContain(issue.status);
  });

  it('(10) cross-company access within org denied for scoped user -> 403/404', async () => {
    // create a second company in the same org
    const co2 = await admin.post('/api/v1/companies', {
      organizationId: orgId,
      name: 'SecCo2',
      nameAr: 'شركة ٢',
      baseCurrency: 'EGP',
    });
    expect([200, 201]).toContain(co2.status);
    const co2Id = co2.body.id;
    // accountant scoped to company 1 tries to read company 2's products
    const acct = await makeAccountant();
    try {
      const res = await acct.get(`/api/v1/products?company_id=${co2Id}`);
      expect([403, 404]).toContain(res.status);
    } finally {
      await (acct as any).__app.close();
    }
  });
});
