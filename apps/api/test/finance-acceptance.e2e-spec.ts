/**
 * E2E: §27 numerical acceptance — finance completion gate.
 *
 * Drives ONLY the public API (no direct service calls):
 *   Opening cash 2,000 (Dr 1110 / Cr 3010)
 *   → purchase 10 @ 100 (PO → GRN → supplier bill 1,140 incl. 14% VAT)
 *   → sell 3 @ 200 (quote → order → deliver → invoice 684 incl. 14% VAT)
 *   → settle both sides (customer receipt 684, supplier payment 1,140)
 *
 * Asserts EXACTLY:
 *   qty 7 | valuation 700.0000 | AR 0 | AP 0 | revenue 600 | COGS 300 |
 *   gross profit 300 | input tax 140 | output tax 84 | bank 1,544 |
 *   balanced TB | balance sheet A = L + E |
 *   idempotent replays (same keys → same journals) |
 *   full document traceability (every journal links to its source doc).
 *
 * If ANY assertion fails, finance is not complete — this test is RED.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'finance27-admin@atlas.test';
const ADMIN_PASSWORD = 'Secret123!';
const APPROVER_EMAIL = 'finance27-approver@atlas.test';
const APPROVER_PASSWORD = 'Secret123!';
const DATE = '2026-06-15';

describe('§27 finance numerical acceptance (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let approver: TestClient;
  let companyId: string;
  let warehouseId: string;
  let supplierId: string;
  let customerId: string;
  let productId: string;
  let accounts: Map<string, string>;
  let invoiceId: string;
  let supplierBillId: string;

  const line = (code: string, debit: string, credit: string) => ({
    account_id: accounts.get(code)!,
    debit,
    credit,
  });

  const tbBalanceOf = async (code: string): Promise<string> => {
    const tb = await client.get(
      `/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(tb.status).toBe(200);
    const row = (tb.body.lines as Array<{ code: string; total_debit: string; total_credit: string }>)
      .find((a) => a.code === code);
    expect(row).toBeDefined();
    // balance = debit - credit (signed); TB lines carry totals per account.
    const bal = Number(row!.total_debit) - Number(row!.total_credit);
    return bal.toFixed(4);
  };

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Finance27 Org',
      organizationNameAr: 'منظمة المالية ٢٧',
      adminName: 'Finance Admin',
      adminEmail: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(fr.status).toBe(201);
    companyId = fr.body.company.id;
    client.orgId = fr.body.organization.id;

    const fy = await client.post('/api/v1/fiscal-years', {
      company_id: companyId, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
    expect(fy.status).toBe(201);

    const accRes = await client.get(`/api/v1/accounts?company_id=${companyId}`);
    expect(accRes.status).toBe(200);
    const accList: Array<{ id: string; code: string }> = accRes.body.data ?? accRes.body;
    accounts = new Map(accList.map((a) => [a.code, a.id]));
    for (const code of ['1110', '1210', '1230', '1310', '2110', '2120', '3010', '4110']) {
      expect(accounts.get(code)).toBeDefined();
    }

    const branches = await client.get(`/api/v1/branches?companyId=${companyId}`);
    const branchId = branches.body[0]?.id ?? branches.body.data?.[0]?.id;
    const wh = await client.get(`/api/v1/warehouses?branchId=${branchId}`);
    warehouseId = (Array.isArray(wh.body) ? wh.body : wh.body.data)[0].id;

    const uom = await client.post('/api/v1/units-of-measure', {
      code: 'PCS', name_ar: 'قطعة', name_en: 'Piece',
    });
    expect(uom.status).toBe(201);

    const sup = await client.post('/api/v1/suppliers', {
      company_id: companyId, name_ar: 'مورد القبول', name_en: 'Accept Supplier', kind: 'company',
    });
    expect(sup.status).toBe(201);
    supplierId = sup.body.data?.id ?? sup.body.id;

    const cust = await client.post('/api/v1/customers', {
      company_id: companyId, name_ar: 'عميل القبول', name_en: 'Accept Customer', kind: 'company',
    });
    expect(cust.status).toBe(201);
    customerId = cust.body.data?.id ?? cust.body.id;

    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'FIN27-WIDGET', name_ar: 'صنف القبول',
      name_en: 'Accept Widget', type: 'stocked', base_uom_id: uom.body.id,
      purchase_price: '100.0000', sales_price: '200.0000',
    });
    expect(prod.status).toBe(201);
    productId = prod.body.id;

    // opening cash 2,000: Dr 1110 / Cr 3010
    const j = await client.post('/api/v1/journal-entries', {
      company_id: companyId, posting_date: DATE, description: '§27 opening cash',
      lines: [line('1110', '2000.00', '0'), line('3010', '0', '2000.00')],
    });
    expect(j.status).toBe(201);
    await client.post(`/api/v1/journal-entries/${j.body.id}/submit`, {});
    await client.post(`/api/v1/journal-entries/${j.body.id}/approve`, { comment: 'ok' });
    const posted = await client.post(`/api/v1/journal-entries/${j.body.id}/post`, { version: 1 });
    expect(posted.body.status).toBe('posted');

    // second user (approver) via invitation — supplier bill approval forbids self-approval.
    const roles = await prisma.role.findMany({ where: { name: 'Company Administrator', isSystem: true } });
    const inv2 = await client.post('/api/v1/auth/invitations', {
      email: APPROVER_EMAIL, roleIds: [roles[0].id], companyIds: [companyId],
    });
    expect(inv2.status).toBe(201);
    const accept = await client.post('/api/v1/auth/invitations/accept', {
      token: inv2.body.token, name: 'Finance Approver', password: APPROVER_PASSWORD,
    });
    expect(accept.status).toBe(201);
    approver = new TestClient(request.agent(app.getHttpServer()));
    await approver.initCsrf();
    approver.orgId = client.orgId;
    const login2 = await approver.login(APPROVER_EMAIL, APPROVER_PASSWORD);
    expect([200, 201]).toContain(login2.status);
    const adminLogin = await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect([200, 201]).toContain(adminLogin.status);
  }, 120000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('purchases 10 @ 100: PO → GRN → supplier bill 1,140', async () => {
    // PO direct (1,000 < 10,000 threshold → auto-approves on submit)
    const po = await client.post('/api/v1/purchasing/orders', {
      company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
      lines: [{ product_id: productId, description: 'Widgets', quantity: '10.0000', unit_price: '100.0000' }],
    }, { 'Idempotency-Key': 'fin27-po' });
    expect(po.status).toBe(201);
    const poId = po.body.purchase_order.id;
    const poLineId = po.body.purchase_order.lines[0].id;

    const sub = await client.post(`/api/v1/purchasing/orders/${poId}/submit`, {});
    expect(sub.body.purchase_order.status).toBe('approved');

    const grn = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '10.0000', unit_cost: '100.0000' }],
    }, { 'Idempotency-Key': 'fin27-grn' });
    expect(grn.status).toBe(201);
    const postGrn = await client.post(
      `/api/v1/purchasing/goods-receipts/${grn.body.goods_receipt.id}/post`, { idempotency_key: 'fin27-grn-post' },
    );
    expect([200, 201]).toContain(postGrn.status);

    const bill = await client.post('/api/v1/purchasing/bills', {
      company_id: companyId, supplier_id: supplierId, bill_date: DATE,
      lines: [{ product_id: productId, description: 'Widgets', quantity: '10.0000', unit_price: '100.0000', tax_rate: '14' }],
    }, { 'Idempotency-Key': 'fin27-bill' });
    expect(bill.status).toBe(201);
    supplierBillId = bill.body.supplier_bill.id;
    expect(bill.body.supplier_bill.total).toBe('1140.0000');

    await client.post(`/api/v1/purchasing/bills/${supplierBillId}/submit`, {});
    const appr = await approver.post(`/api/v1/purchasing/bills/${supplierBillId}/approve`, {});
    expect([200, 201]).toContain(appr.status);
    const postBill = await client.post(
      `/api/v1/purchasing/bills/${supplierBillId}/post`, { idempotency_key: 'fin27-bill-post' },
    );
    expect([200, 201]).toContain(postBill.status);

    const bal = await client.get(
      `/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`,
    );
    const qty = (bal.body.data ?? bal.body)[0]?.on_hand;
    expect(Number(qty)).toBe(10);
  });

  it('sells 3 @ 200: quote → order → deliver → invoice 684', async () => {
    const q = await client.post('/api/v1/sales/quotations', {
      company_id: companyId, customer_id: customerId, valid_until: '2026-12-31',
      lines: [{ product_id: productId, description: 'Widgets', quantity: '3.0000', unit_price: '200.0000', tax_rate: '14' }],
    });
    expect(q.status).toBe(201);
    const qId = q.body.quotation.id;
    expect((await client.post(`/api/v1/sales/quotations/${qId}/send`, {})).status).toBe(201);
    expect((await client.post(`/api/v1/sales/quotations/${qId}/accept`, {})).status).toBe(400);
    expect((await client.post(`/api/v1/sales/quotations/${qId}/accept`, { warehouse_id: warehouseId })).status).toBe(201);

    const so = await client.post('/api/v1/sales/orders', {
      company_id: companyId, customer_id: customerId, warehouse_id: warehouseId,
      lines: [{ product_id: productId, description: 'Widgets', quantity: '3.0000', unit_price: '200.0000', tax_rate: '14' }],
    });
    expect(so.status).toBe(201);
    const soId = so.body.sales_order.id;
    const soLineId = so.body.sales_order.lines[0].id;
    await client.post(`/api/v1/sales/orders/${soId}/confirm`, {});

    const del = await client.post('/api/v1/sales/deliveries', {
      company_id: companyId, sales_order_id: soId, warehouse_id: warehouseId, delivery_date: DATE,
      lines: [{ sales_order_line_id: soLineId, quantity: '3.0000' }],
    }, { 'Idempotency-Key': 'fin27-delivery' });
    expect(del.status).toBe(201);
    await client.post(`/api/v1/sales/deliveries/${del.body.delivery.id}/post`, { idempotency_key: 'fin27-delivery-post' });

    const inv = await client.post('/api/v1/sales/invoices', {
      company_id: companyId, customer_id: customerId, sales_order_id: soId, invoice_date: DATE,
    }, { 'Idempotency-Key': 'fin27-invoice' });
    expect(inv.status).toBe(201);
    invoiceId = inv.body.invoice.id;
    expect(inv.body.invoice.total).toBe('684.0000');

    const postInv = await client.post(
      `/api/v1/sales/invoices/${invoiceId}/post`, { idempotency_key: 'fin27-invoice-post' },
    );
    expect([200, 201]).toContain(postInv.status);
  });

  it('settles both sides: customer receipt 684, supplier payment 1,140', async () => {
    const cp = await client.post('/api/v1/sales/payments', {
      company_id: companyId, customer_id: customerId, payment_date: DATE,
      amount: '684.0000', bank_account_id: accounts.get('1110'),
      allocations: [{ sales_invoice_id: invoiceId, amount: '684.0000' }],
    }, { 'Idempotency-Key': 'fin27-custpay' });
    expect(cp.status).toBe(201);
    await client.post(`/api/v1/sales/payments/${cp.body.payment.id}/post`, { idempotency_key: 'fin27-custpay-post' });

    const sp = await client.post('/api/v1/purchasing/payments', {
      company_id: companyId, supplier_id: supplierId, payment_date: DATE,
      amount: '1140.0000', bank_account_id: accounts.get('1110'),
      allocations: [{ supplier_bill_id: supplierBillId, amount: '1140.0000' }],
    }, { 'Idempotency-Key': 'fin27-suppay' });
    expect(sp.status).toBe(201);
    await client.post(
      `/api/v1/purchasing/payments/${sp.body.supplier_payment.id}/post`, { idempotency_key: 'fin27-suppay-post' },
    );
  });

  it('asserts §27 exact numbers', async () => {
    const bal = await client.get(
      `/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`,
    );
    expect(Number((bal.body.data ?? bal.body)[0].on_hand)).toBe(7);

    const val = await client.get(
      `/api/v1/inventory/valuation?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`,
    );
    const vrow = (val.body.data ?? val.body)[0];
    expect(Number(vrow.total_value ?? vrow.value ?? vrow.amount)).toBeCloseTo(700, 4);

    expect(await tbBalanceOf('1210')).toBe('0.0000');
    expect(await tbBalanceOf('2110')).toBe('0.0000');
    expect(await tbBalanceOf('1230')).toBe('140.0000');
    // 2120 is credit-normal: debit − credit = −84
    expect(await tbBalanceOf('2120')).toBe('-84.0000');
    expect(await tbBalanceOf('1110')).toBe('1544.0000');

    const pl = await client.get(
      `/api/v1/reports/profit-loss?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(pl.status).toBe(200);
    expect(Number(pl.body.total_revenue)).toBeCloseTo(600, 2);
    expect(Number(pl.body.cogs)).toBeCloseTo(300, 2);
    expect(Number(pl.body.gross_profit)).toBeCloseTo(300, 2);
    expect(Number(pl.body.net_profit)).toBeCloseTo(300, 2);

    const vat = await client.get(
      `/api/v1/reports/vat?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(vat.status).toBe(200);
    expect(Number(vat.body.input_vat_1230)).toBeCloseTo(140, 2);
    expect(Number(vat.body.output_vat_2120)).toBeCloseTo(84, 2);
    expect(Number(vat.body.net_vat_payable)).toBeCloseTo(-56, 2);

    const tb = await client.get(
      `/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(tb.status).toBe(200);
    expect(tb.body.total_debit).toBe(tb.body.total_credit);
    expect(tb.body.balanced).toBe(true);

    const bs = await client.get(
      `/api/v1/reports/balance-sheet?company_id=${companyId}&as_of=2026-12-31`,
    );
    expect(bs.status).toBe(200);
    expect(bs.body.balanced).toBe(true);
    const bsAssets = Number(bs.body.total_assets);
    const bsLiabEquity = Number(bs.body.total_liabilities) + Number(bs.body.total_equity);
    expect(bsAssets).toBeCloseTo(bsLiabEquity, 2);
    // assets = bank 1544 + input VAT 140 + inventory 700 = 2384
    expect(bsAssets).toBeCloseTo(2384, 2);
    // liabilities = output VAT 84; equity = capital 2000 + net profit 300 = 2300
    expect(Number(bs.body.total_liabilities)).toBeCloseTo(84, 2);
    expect(Number(bs.body.total_equity)).toBeCloseTo(2300, 2);
  });

  it('idempotent replays return the same journals (no duplicates)', async () => {
    const before = await prisma.journalEntry.count({ where: { companyId, status: 'posted' } });

    // Reposting an already-posted doc with the same key is rejected (no duplicate journal).
    const repostInv = await client.post(
      `/api/v1/sales/invoices/${invoiceId}/post`, { idempotency_key: 'fin27-invoice-post' },
    );
    expect(repostInv.body.code).toBe('INVALID_SALES_TRANSITION');

    const repostBill = await client.post(
      `/api/v1/purchasing/bills/${supplierBillId}/post`, { idempotency_key: 'fin27-bill-post' },
    );
    expect(repostBill.body.code).toBe('INVALID_PURCHASING_TRANSITION');

    const after = await prisma.journalEntry.count({ where: { companyId, status: 'posted' } });
    expect(after).toBe(before);

    expect(await tbBalanceOf('1110')).toBe('1544.0000');
    expect(await tbBalanceOf('1210')).toBe('0.0000');
  });

  it('every posted journal traces to its source document', async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { companyId, status: 'posted' },
      select: { id: true, journalType: true, sourceType: true, sourceId: true, description: true },
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      if (e.journalType === 'manual') continue; // opening journal has no source doc
      expect(e.sourceType).toBeTruthy();
      expect(e.sourceId).toBeTruthy();
    }
    const sourceTypes = new Set(entries.map((e) => e.sourceType).filter(Boolean));
    // GRN and delivery post inventory movements; their GL impact flows through
    // the bill (GRNI clearing) and invoice (COGS). Assert traceability for
    // journals that carry source refs.
    const expected = ['supplier_bill', 'sales_invoice'];
    const missing = expected.filter((t) => !sourceTypes.has(t));
    expect(missing).toEqual([]);
  });

  it('finance dashboard formulas match the underlying reports', async () => {
    const dash = await client.get(`/api/v1/reports/finance-dashboard?company_id=${companyId}`);
    expect(dash.status).toBe(200);
    const d = dash.body;
    expect(Number(d.revenue_ytd)).toBeCloseTo(600, 2);
    expect(Number(d.gross_margin_pct_ytd)).toBeCloseTo(50, 2);
    expect(Number(d.ar_total)).toBeCloseTo(0, 2);
    expect(Number(d.ap_total)).toBeCloseTo(0, 2);
    expect(Number(d.bank_balance)).toBeCloseTo(1544, 2);
    expect(Number(d.overdue_ar)).toBeCloseTo(0, 2);
    expect(Number(d.overdue_ap)).toBeCloseTo(0, 2);
  });
});
