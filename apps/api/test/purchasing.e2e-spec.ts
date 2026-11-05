/**
 * E2E: Phase 7 purchasing lifecycle — PR → PO (approval threshold + self-approval 403)
 * → goods receipt (stock + Dr1310/Cr1320) → supplier bill (3-way match, GRNI cleared)
 * → payments → TB balanced. Plus: over-receipt rejected, duplicate receipt idempotency,
 * variance-beyond-tolerance bill blocked, over-allocation rejected.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'purchasing-admin@atlas.test';
const ADMIN_PASSWORD='TestPass123!'
const BUYER_EMAIL = 'buyer@atlas.test';
const BUYER_PASSWORD='TestPass123!'
const DATE = '2026-06-15';

describe('Purchasing lifecycle (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let buyer: TestClient;
  let orgId: string;
  let companyId: string;
  let warehouseId: string;
  let supplierId: string;
  let stockedProductId: string;
  let poId: string;
  let poLineId: string;
  let billId: string;

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Purch Org',
      organizationNameAr: 'منظمة المشتريات',
      adminName: 'Purch Admin',
      adminEmail: ADMIN_EMAIL,
password: ADMIN_PASSWORD,
    });
    expect(fr.status).toBe(201);
    orgId = fr.body.organization.id;
    companyId = fr.body.company.id;
    client.orgId = orgId;

    const fy = await client.post('/api/v1/fiscal-years', {
      company_id: companyId, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31',
    });
    expect(fy.status).toBe(201);

    const branches = await client.get(`/api/v1/branches?companyId=${companyId}`);
    const branchId = branches.body[0]?.id ?? branches.body.data?.[0]?.id;
    const wh = await client.get(`/api/v1/warehouses?branchId=${branchId}`);
    const whList = Array.isArray(wh.body) ? wh.body : wh.body.data;
    warehouseId = whList[0].id;

    const uom = await client.post('/api/v1/units-of-measure', {
      code: 'PCS', name_ar: 'قطعة', name_en: 'Piece',
    });
    expect(uom.status).toBe(201);
    const uomId = uom.body.id;

    const sup = await client.post('/api/v1/suppliers', {
      company_id: companyId, name_ar: 'مورد المشتريات', name_en: 'Purch Supplier', kind: 'company',
    });
    expect(sup.status).toBe(201);
    supplierId = sup.body.data?.id ?? sup.body.id;

    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'PURCH-WIDGET', name_ar: 'صنف المشتريات',
      name_en: 'Purch Widget', type: 'stocked', base_uom_id: uomId,
      purchase_price: '90.0000', sales_price: '150.0000',
    });
    expect(prod.status).toBe(201);
    stockedProductId = prod.body.id;

    // Second user (buyer/approver) via invitation.
    const roles = await prisma.role.findMany({ where: { name: 'Company Administrator', isSystem: true } });
    const inv = await client.post('/api/v1/auth/invitations', {
      email: BUYER_EMAIL, roleIds: [roles[0].id], companyIds: [companyId],
    });
    expect(inv.status).toBe(201);
    const accept = await client.post('/api/v1/auth/invitations/accept', {
token: inv.body.token, name: 'Buyer', password: BUYER_PASSWORD,
    });
    expect(accept.status).toBe(201);
    buyer = new TestClient(request.agent(app.getHttpServer()));
    await buyer.initCsrf();
    buyer.orgId = orgId;
    const login = await buyer.login(BUYER_EMAIL, BUYER_PASSWORD);
    expect([200, 201]).toContain(login.status);
    // Invitation accept hijacked the admin's session cookie; restore it.
    const adminLogin = await client.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect([200, 201]).toContain(adminLogin.status);
  }, 120000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('runs the PR lifecycle: draft → submitted → approved → converted to PO', async () => {
    const pr = await client.post('/api/v1/purchasing/purchase-requests', {
      company_id: companyId,
      lines: [{ product_id: stockedProductId, description: 'Widgets', quantity: '10.0000', unit_price: '90.0000' }],
    });
    expect(pr.status).toBe(201);
    expect(pr.body.purchase_request.number).toMatch(/^PR-/);
    expect(pr.body.purchase_request.total).toBe('900.0000');
    const prId = pr.body.purchase_request.id;

    const sub = await client.post(`/api/v1/purchasing/purchase-requests/${prId}/submit`, {});
    expect(sub.body.purchase_request.status).toBe('submitted');

    // Self-approval is forbidden.
    const selfApprove = await client.post(`/api/v1/purchasing/purchase-requests/${prId}/approve`, {});
    expect(selfApprove.status).toBe(403);

    const approve = await buyer.post(`/api/v1/purchasing/purchase-requests/${prId}/approve`, {});
    expect(approve.status).toBe(201);
    expect(approve.body.purchase_request.status).toBe('approved');

    const conv = await client.post(`/api/v1/purchasing/purchase-requests/${prId}/convert`, {
      supplier_id: supplierId, warehouse_id: warehouseId,
    });
    expect(conv.status).toBe(201);
    expect(conv.body.purchase_order.number).toMatch(/^PO-/);
    poId = conv.body.purchase_order.id;

    const prAfter = await client.get(`/api/v1/purchasing/purchase-requests/${prId}`);
    expect(prAfter.body.status).toBe('ordered');
  });

  it('auto-approves a below-threshold PO on submit', async () => {
    // poId is below 10,000 → submit auto-approves.
    const sub = await client.post(`/api/v1/purchasing/orders/${poId}/submit`, {});
    expect(sub.status).toBe(201);
    expect(sub.body.purchase_order.status).toBe('approved');
    poLineId = sub.body.purchase_order.lines[0].id;
  });

  it('requires separate approval above the threshold (self-approve → 403)', async () => {
    const big = await client.post('/api/v1/purchasing/orders', {
      company_id: companyId, supplier_id: supplierId, warehouse_id: warehouseId,
      lines: [{ product_id: stockedProductId, description: 'Big lot', quantity: '200.0000', unit_price: '90.0000' }],
    });
    expect(big.status).toBe(201);
    const bigId = big.body.purchase_order.id;
    expect(big.body.purchase_order.total).toBe('18000.0000');

    const sub = await client.post(`/api/v1/purchasing/orders/${bigId}/submit`, {});
    expect(sub.body.purchase_order.status).toBe('submitted');

    const selfApprove = await client.post(`/api/v1/purchasing/orders/${bigId}/approve`, {});
    expect(selfApprove.status).toBe(403);

    const approve = await buyer.post(`/api/v1/purchasing/orders/${bigId}/approve`, {});
    expect(approve.status).toBe(201);
    expect(approve.body.purchase_order.status).toBe('approved');
  });

  it('posts a goods receipt: stock + valuation + Dr1310/Cr1320', async () => {
    const grn = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '6.0000', unit_cost: '90.0000' }],
    });
    expect(grn.status).toBe(201);
    expect(grn.body.goods_receipt.number).toMatch(/^GRN-/);
    const grnId = grn.body.goods_receipt.id;

    const post = await client.post(`/api/v1/purchasing/goods-receipts/${grnId}/post`, {}, { 'Idempotency-Key': 'grn-post-1' });
    expect(post.status).toBe(201);
    expect(post.body.goods_receipt.status).toBe('posted');

    // Stock movement created (immutable).
    const movements = await prisma.stockMovement.findMany({ where: { sourceId: grnId } });
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe('receive');
    expect(Number(movements[0].quantity)).toBeCloseTo(6, 4);

    // GL: Dr 1310 / Cr 1320 for 540.00.
    const journals = await prisma.journalEntry.findMany({
      where: { sourceType: 'stock_movement', sourceId: movements[0].id },
      include: { lines: { include: { account: true } } },
    });
    expect(journals).toHaveLength(1);
    const byCode: Record<string, { d: string; c: string }> = {};
    for (const l of journals[0].lines) byCode[l.account.code] = { d: String(l.debit), c: String(l.credit) };
    expect(Number(byCode['1310'].d)).toBeCloseTo(540, 2);
    expect(Number(byCode['1320'].c)).toBeCloseTo(540, 2);

    // PO line received quantity + PO status.
    const po = await client.get(`/api/v1/purchasing/orders/${poId}`);
    expect(po.body.lines[0].received_quantity).toBe('6.0000');
    expect(po.body.status).toBe('partially_received');
  });

  it('replays a duplicate receipt idempotently and rejects over-receipt', async () => {
    // Same idempotency key → replayed, no second receipt.
    const dup = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '6.0000', unit_cost: '90.0000' }],
      idempotency_key: 'dup-grn-1',
    });
    expect(dup.status).toBe(201);
    const dup2 = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '6.0000', unit_cost: '90.0000' }],
      idempotency_key: 'dup-grn-1',
    });
    expect(dup2.body.replayed).toBe(true);
    expect(dup2.body.goods_receipt.id).toBe(dup.body.goods_receipt.id);

    // Over-receipt: 4 remain (10 ordered - 6 received), requesting 5 → 422.
    const over = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '5.0000' }],
    });
    expect(over.status).toBe(201);
    const overPost = await client.post(`/api/v1/purchasing/goods-receipts/${over.body.goods_receipt.id}/post`, {});
    expect(overPost.status).toBe(422);
    expect(overPost.body.code).toBe('OVER_RECEIPT');
  });

  it('posts a supplier bill with 3-way match: GRNI cleared, AP created', async () => {
    // Receive the remaining 4 first so the bill can 3-way match the full 10.
    const grn2 = await client.post('/api/v1/purchasing/goods-receipts', {
      company_id: companyId, purchase_order_id: poId, warehouse_id: warehouseId,
      receipt_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, quantity: '4.0000', unit_cost: '90.0000' }],
    });
    const grn2Post = await client.post(`/api/v1/purchasing/goods-receipts/${grn2.body.goods_receipt.id}/post`, {});
    expect(grn2Post.body.goods_receipt.status).toBe('posted');

    const grnLines = await prisma.goodsReceiptLine.findMany({
      where: { goodsReceipt: { purchaseOrderId: poId, status: 'posted' } },
      include: { goodsReceipt: true },
    });
    grnLines.sort((a, b) => a.goodsReceipt.createdAt.getTime() - b.goodsReceipt.createdAt.getTime());
    expect(grnLines).toHaveLength(2);

    // Bill the full 10 @ 90 + 14% VAT = 900 + 126 = 1026.
    const bill = await client.post('/api/v1/purchasing/bills', {
      company_id: companyId, supplier_id: supplierId, purchase_order_id: poId,
      bill_date: DATE,
      lines: [
        { purchase_order_line_id: poLineId, goods_receipt_line_id: grnLines[0].id, product_id: stockedProductId, description: 'Widgets', quantity: '6.0000', unit_price: '90.0000', tax_rate: '14' },
        { purchase_order_line_id: poLineId, goods_receipt_line_id: grnLines[1].id, product_id: stockedProductId, description: 'Widgets', quantity: '4.0000', unit_price: '90.0000', tax_rate: '14' },
      ],
    });
    expect(bill.status).toBe(201);
    expect(bill.body.supplier_bill.number).toMatch(/^BILL-/);
    expect(bill.body.supplier_bill.total).toBe('1026.0000');
    billId = bill.body.supplier_bill.id;

    const sub = await client.post(`/api/v1/purchasing/bills/${billId}/submit`, {});
    expect(sub.body.supplier_bill.status).toBe('submitted');
    const approve = await buyer.post(`/api/v1/purchasing/bills/${billId}/approve`, {});
    expect(approve.body.supplier_bill.status).toBe('approved');

    const post = await client.post(`/api/v1/purchasing/bills/${billId}/post`, {}, { 'Idempotency-Key': 'bill-post-1' });
    expect(post.status).toBe(201);
    expect(post.body.supplier_bill.status).toBe('posted');

    // GL: Dr 1320 900 / Dr 1230 126 / Cr 2110 1026.
    const journals = await prisma.journalEntry.findMany({
      where: { sourceType: 'supplier_bill', sourceId: billId },
      include: { lines: { include: { account: true } } },
    });
    expect(journals).toHaveLength(1);
    const byCode: Record<string, { d: string; c: string }> = {};
    for (const l of journals[0].lines) byCode[l.account.code] = { d: String(l.debit), c: String(l.credit) };
    expect(Number(byCode['1320'].d)).toBeCloseTo(900, 2);
    expect(Number(byCode['1230'].d)).toBeCloseTo(126, 2);
    expect(Number(byCode['2110'].c)).toBeCloseTo(1026, 2);

    // GRNI nets to zero (900 received, 900 cleared); inventory debited once.
    const grniBalance = await prisma.$queryRaw<Array<{ bal: string }>>`
      SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS bal
      FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE a.company_id = ${companyId}::uuid AND a.code = '1320'`;
    expect(Number(grniBalance[0].bal)).toBe(0);

    // PO fully billed.
    const po = await client.get(`/api/v1/purchasing/orders/${poId}`);
    expect(po.body.status).toBe('billed');
  });

  it('blocks a bill whose price variance exceeds tolerance', async () => {
    const bad = await client.post('/api/v1/purchasing/bills', {
      company_id: companyId, supplier_id: supplierId, purchase_order_id: poId,
      bill_date: DATE,
      lines: [{ purchase_order_line_id: poLineId, product_id: stockedProductId, description: 'Widgets', quantity: '10.0000', unit_price: '95.0000', tax_rate: '14' }],
    });
    expect(bad.status).toBe(201);
    const badId = bad.body.supplier_bill.id;
    await client.post(`/api/v1/purchasing/bills/${badId}/submit`, {});
    await buyer.post(`/api/v1/purchasing/bills/${badId}/approve`, {});
    const post = await client.post(`/api/v1/purchasing/bills/${badId}/post`, {});
    expect(post.status).toBe(422);
    expect(post.body.code).toBe('MATCH_VARIANCE_BLOCKED');
  });

  it('pays the bill partially then fully: partially_paid → paid', async () => {
    const p1 = await client.post('/api/v1/purchasing/payments', {
      company_id: companyId, supplier_id: supplierId, amount: '500.0000',
      allocations: [{ supplier_bill_id: billId, amount: '500.0000' }],
    });
    expect(p1.status).toBe(201);
    expect(p1.body.supplier_payment.number).toMatch(/^PPAY-/);
    const pay1 = await client.post(`/api/v1/purchasing/payments/${p1.body.supplier_payment.id}/post`, {});
    expect(pay1.status).toBe(201);

    let bill = await client.get(`/api/v1/purchasing/bills/${billId}`);
    expect(bill.body.status).toBe('partially_paid');
    expect(bill.body.outstanding).toBe('526.0000');

    // Over-allocation rejected.
    const over = await client.post('/api/v1/purchasing/payments', {
      company_id: companyId, supplier_id: supplierId, amount: '600.0000',
      allocations: [{ supplier_bill_id: billId, amount: '600.0000' }],
    });
    expect(over.status).toBe(422);

    const p2 = await client.post('/api/v1/purchasing/payments', {
      company_id: companyId, supplier_id: supplierId, amount: '526.0000',
      allocations: [{ supplier_bill_id: billId, amount: '526.0000' }],
    });
    const pay2 = await client.post(`/api/v1/purchasing/payments/${p2.body.supplier_payment.id}/post`, {});
    expect(pay2.status).toBe(201);

    bill = await client.get(`/api/v1/purchasing/bills/${billId}`);
    expect(bill.body.status).toBe('paid');
    expect(bill.body.outstanding).toBe('0.0000');

    // Payment GL: Dr 2110 / Cr 1110.
    const journals = await prisma.journalEntry.findMany({
      where: { sourceType: 'supplier_payment', sourceId: p2.body.supplier_payment.id },
      include: { lines: { include: { account: true } } },
    });
    const byCode: Record<string, { d: string; c: string }> = {};
    for (const l of journals[0].lines) byCode[l.account.code] = { d: String(l.debit), c: String(l.credit) };
    expect(Number(byCode['2110'].d)).toBeCloseTo(526, 2);
    expect(Number(byCode['1110'].c)).toBeCloseTo(526, 2);
  });

  it('keeps the trial balance balanced after the full purchasing cycle', async () => {
    const tb = await client.get(
      `/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(tb.status).toBe(200);
    const lines = tb.body.lines as Array<{ total_debit: string; total_credit: string; code: string }>;
    const dr = lines.reduce((s, l) => s + Number(l.total_debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.total_credit), 0);
    expect(dr).toBeCloseTo(cr, 2);
    expect(dr).toBeGreaterThan(0);
  });

  it('rejects cross-organization access to purchasing', async () => {
    const realOrg = client.orgId;
    client.orgId = '00000000-0000-0000-0000-000000000000';
    const res = await client.get(`/api/v1/purchasing/orders?company_id=${companyId}`);
    expect([401, 403]).toContain(res.status);
    client.orgId = realOrg;
  });
});
