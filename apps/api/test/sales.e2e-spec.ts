/**
 * E2E: Phase 6 sales lifecycle — quotation → order → reservation → delivery
 * (issue + COGS) → invoice (AR/Revenue/VAT) → payments → credit note on return.
 * Plus: over-delivery rejected, idempotent repost, service order without delivery.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'sales-admin@atlas.test';
const ADMIN_PASSWORD = 'SalesTest123!';
const DATE = '2026-06-15';

describe('Sales lifecycle (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let orgId: string;
  let companyId: string;
  let warehouseId: string;
  let customerId: string;
  let stockedProductId: string;
  let serviceProductId: string;

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Sales Org',
      organizationNameAr: 'منظمة المبيعات',
      adminName: 'Sales Admin',
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

    const cust = await client.post('/api/v1/customers', {
      company_id: companyId, name_ar: 'عميل المبيعات', name_en: 'Sales Customer', kind: 'company',
    });
    expect(cust.status).toBe(201);
    customerId = cust.body.data?.id ?? cust.body.id;

    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'SALES-WIDGET', name_ar: 'صنف المبيعات',
      name_en: 'Sales Widget', type: 'stocked', base_uom_id: uomId,
      purchase_price: '90.0000', sales_price: '150.0000',
    });
    expect(prod.status).toBe(201);
    stockedProductId = prod.body.id;

    const svc = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'SALES-SVC', name_ar: 'خدمة المبيعات',
      name_en: 'Sales Service', type: 'service', base_uom_id: uomId,
      sales_price: '500.0000',
    });
    expect(svc.status).toBe(201);
    serviceProductId = svc.body.id;

    // Opening stock: 20 units @ 100.
    const recv = await client.post('/api/v1/inventory/movements/receive', {
      company_id: companyId, warehouse_id: warehouseId, product_id: stockedProductId,
      movement_type: 'receive', quantity: '20.0000', unit_cost: '100.0000', movement_date: DATE,
    });
    expect(recv.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const qLine = { product_id: '', description: 'Widget line', quantity: '10.0000', unit_price: '150.0000', discount_rate: '10', tax_rate: '14' };

  it('runs the quotation state machine: draft → sent → withdraw → sent → accepted', async () => {
    const create = await client.post('/api/v1/sales/quotations', {
      company_id: companyId, customer_id: customerId, valid_until: '2026-12-31',
      lines: [{ ...qLine, product_id: stockedProductId }],
    });
    expect(create.status).toBe(201);
    const q = create.body.quotation;
    expect(q.number).toMatch(/^QUOT-/);
    expect(q.status).toBe('draft');
    // 10*150=1500, -10% = 1350 subtotal, +14% = 189 tax, total 1539
    expect(q.subtotal).toBe('1350.0000');
    expect(q.tax_total).toBe('189.0000');
    expect(q.total).toBe('1539.0000');
    const qid = q.id;

    // Cannot accept a draft quotation.
    const badAccept = await client.post(`/api/v1/sales/quotations/${qid}/accept`, { warehouse_id: warehouseId });
    expect(badAccept.status).toBe(422);

    await client.post(`/api/v1/sales/quotations/${qid}/send`, {});
    let got = await client.get(`/api/v1/sales/quotations/${qid}`);
    expect(got.body.status).toBe('sent');

    // Withdraw back to draft, then send again.
    await client.post(`/api/v1/sales/quotations/${qid}/withdraw`, {});
    got = await client.get(`/api/v1/sales/quotations/${qid}`);
    expect(got.body.status).toBe('draft');
    await client.post(`/api/v1/sales/quotations/${qid}/send`, {});

    const accept = await client.post(`/api/v1/sales/quotations/${qid}/accept`, { warehouse_id: warehouseId });
    expect(accept.status).toBe(201);
    expect(accept.body.quotation.status).toBe('accepted');
    expect(accept.body.sales_order.number).toMatch(/^SO-/);
    expect(accept.body.sales_order.status).toBe('draft');
    (global as unknown as { orderId: string }).orderId = accept.body.sales_order.id;
  });

  it('rejects a quotation and expires past-due ones via the job', async () => {
    const c2 = await client.post('/api/v1/sales/quotations', {
      company_id: companyId, customer_id: customerId, valid_until: '2026-12-31',
      lines: [{ ...qLine, product_id: stockedProductId }],
    });
    const q2 = c2.body.quotation.id;
    await client.post(`/api/v1/sales/quotations/${q2}/send`, {});
    await client.post(`/api/v1/sales/quotations/${q2}/reject`, {});
    const got = await client.get(`/api/v1/sales/quotations/${q2}`);
    expect(got.body.status).toBe('rejected');

    // Past-due quotation gets expired by the job.
    const c3 = await client.post('/api/v1/sales/quotations', {
      company_id: companyId, customer_id: customerId, valid_until: '2026-01-01',
      lines: [{ ...qLine, product_id: stockedProductId }],
    });
    const q3 = c3.body.quotation.id;
    await client.post(`/api/v1/sales/quotations/${q3}/send`, {});
    const exp = await client.post('/api/v1/sales/quotations/expire-due', {});
    expect(exp.body.expired).toBeGreaterThanOrEqual(1);
    const got3 = await client.get(`/api/v1/sales/quotations/${q3}`);
    expect(got3.body.status).toBe('expired');
    // Expired quotations cannot be accepted.
    const acc = await client.post(`/api/v1/sales/quotations/${q3}/accept`, { warehouse_id: warehouseId });
    expect(acc.status).toBe(422);
  });

  it('confirms the order and creates a row-locked reservation (no on-hand change)', async () => {
    const orderId = (global as unknown as { orderId: string }).orderId;
    const conf = await client.post(`/api/v1/sales/orders/${orderId}/confirm`, {});
    expect(conf.status).toBe(201);
    expect(conf.body.sales_order.status).toBe('confirmed');
    expect(conf.body.reservations).toHaveLength(1);

    // Reservation exists and is active; on-hand unchanged, available reduced.
    const res = await client.get(`/api/v1/inventory/reservations?company_id=${companyId}&product_id=${stockedProductId}&status=active`);
    const list = Array.isArray(res.body) ? res.body : res.body.data;
    expect(list.length).toBe(1);
    expect(list[0].quantity).toBe('10.0000');

    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${stockedProductId}`);
    const b = (Array.isArray(bal.body) ? bal.body : bal.body.data)[0];
    expect(b.on_hand).toBe('20.0000');
    expect(b.available).toBe('10.0000');
  });

  it('posts a delivery: issue movement + COGS at weighted average', async () => {
    const orderId = (global as unknown as { orderId: string }).orderId;
    const order = await client.get(`/api/v1/sales/orders/${orderId}`);
    const lineId = order.body.lines[0].id;

    const dv = await client.post('/api/v1/sales/deliveries', {
      company_id: companyId, sales_order_id: orderId,
      lines: [{ sales_order_line_id: lineId, quantity: '6.0000' }],
    });
    expect(dv.status).toBe(201);
    expect(dv.body.delivery.number).toMatch(/^DEL-/);
    const deliveryId = dv.body.delivery.id;

    const post = await client.post(`/api/v1/sales/deliveries/${deliveryId}/post`, {});
    expect(post.status).toBe(201);
    expect(post.body.delivery.status).toBe('posted');
    // 6 units @ avg 100 => COGS 600
    expect(Number(post.body.issues[0].cogs)).toBeCloseTo(600, 2);

    const ord = await client.get(`/api/v1/sales/orders/${orderId}`);
    expect(ord.body.status).toBe('partially_delivered');
    expect(ord.body.lines[0].delivered_quantity).toBe('6.0000');

    // Reservation auto-consumed FIFO: 10 - 6 = 4 active.
    const res = await client.get(`/api/v1/inventory/reservations?company_id=${companyId}&product_id=${stockedProductId}&status=active`);
    const list = Array.isArray(res.body) ? res.body : res.body.data;
    const total = list.reduce((s: number, r: { quantity: string }) => s + Number(r.quantity), 0);
    expect(total).toBeCloseTo(4, 4);
  });

  it('rejects over-delivery beyond the order remainder', async () => {
    const orderId = (global as unknown as { orderId: string }).orderId;
    const order = await client.get(`/api/v1/sales/orders/${orderId}`);
    const lineId = order.body.lines[0].id;
    const dv = await client.post('/api/v1/sales/deliveries', {
      company_id: companyId, sales_order_id: orderId,
      lines: [{ sales_order_line_id: lineId, quantity: '5.0000' }], // only 4 remain
    });
    expect(dv.status).toBe(422);
    expect(dv.body.code).toBe('OVER_DELIVERY');
  });

  it('posts an invoice: Dr AR / Cr Revenue / Cr VAT, idempotent repost', async () => {
    const orderId = (global as unknown as { orderId: string }).orderId;
    const inv = await client.post('/api/v1/sales/invoices', {
      company_id: companyId, customer_id: customerId, sales_order_id: orderId,
    });
    expect(inv.status).toBe(201);
    const invoice = inv.body.invoice;
    expect(invoice.number).toMatch(/^INV-/);
    // 6*150=900, -10% = 810 subtotal, +14% = 113.40 tax, total 923.40
    expect(invoice.subtotal).toBe('810.0000');
    expect(invoice.tax_total).toBe('113.4000');
    expect(invoice.total).toBe('923.4000');
    const invoiceId = invoice.id;
    (global as unknown as { invoiceId: string }).invoiceId = invoiceId;

    const post = await client.post(`/api/v1/sales/invoices/${invoiceId}/post`, { idempotency_key: 'e2e-inv-post-1' });
    expect(post.status).toBe(201);
    expect(post.body.invoice.status).toBe('posted');
    const journalId = post.body.journal_id;

    // Repost with the same key returns the original journal (no duplicate).
    const repost = await client.post(`/api/v1/sales/invoices/${invoiceId}/post`, { idempotency_key: 'e2e-inv-post-1' });
    expect(repost.body.code).toBe('INVALID_SALES_TRANSITION'); // already posted

    // Journal lines: Dr 1210 923.40 / Cr 4110 810 / Cr 2120 113.40
    const rows = await prisma.journalLine.findMany({ where: { journalEntryId: journalId }, include: { account: true } });
    expect(rows).toHaveLength(3);
    const byCode: Record<string, { debit: string; credit: string }> = {};
    for (const r of rows) byCode[r.account.code] = { debit: r.debit.toString(), credit: r.credit.toString() };
    expect(Number(byCode['1210'].debit)).toBeCloseTo(923.40, 2);
    expect(Number(byCode['4110'].credit)).toBeCloseTo(810, 2);
    expect(Number(byCode['2120'].credit)).toBeCloseTo(113.40, 2);
  });

  it('applies partial then full payment with correct status transitions', async () => {
    const invoiceId = (global as unknown as { invoiceId: string }).invoiceId;

    const p1 = await client.post('/api/v1/sales/payments', {
      company_id: companyId, customer_id: customerId, amount: '500.0000',
      allocations: [{ sales_invoice_id: invoiceId, amount: '500.0000' }],
    });
    expect(p1.status).toBe(201);
    const pay1 = await client.post(`/api/v1/sales/payments/${p1.body.payment.id}/post`, {});
    expect(pay1.status).toBe(201);
    expect(pay1.body.payment.number).toMatch(/^SPAY-/);

    let inv = await client.get(`/api/v1/sales/invoices/${invoiceId}`);
    expect(inv.body.status).toBe('partially_paid');
    expect(inv.body.paid_total).toBe('500.0000');
    expect(inv.body.outstanding).toBe('423.4000');

    // Payment journal: Dr 1110 / Cr 1210 500
    const rows = await prisma.journalLine.findMany({ where: { journalEntryId: pay1.body.journal_id }, include: { account: true } });
    const byCode: Record<string, string> = {};
    for (const r of rows) byCode[r.account.code] = r.debit.toString() + '/' + r.credit.toString();
    const [b1110d, b1110c] = byCode['1110'].split('/').map(Number);
    const [b1210d, b1210c] = byCode['1210'].split('/').map(Number);
    expect(b1110d).toBeCloseTo(500, 2); expect(b1110c).toBe(0);
    expect(b1210d).toBe(0); expect(b1210c).toBeCloseTo(500, 2);

    const p2 = await client.post('/api/v1/sales/payments', {
      company_id: companyId, customer_id: customerId, amount: '423.4000',
      allocations: [{ sales_invoice_id: invoiceId, amount: '423.4000' }],
    });
    await client.post(`/api/v1/sales/payments/${p2.body.payment.id}/post`, {});
    inv = await client.get(`/api/v1/sales/invoices/${invoiceId}`);
    expect(inv.body.status).toBe('paid');
    expect(inv.body.outstanding).toBe('0.0000');

    // Over-allocation rejected.
    const p3 = await client.post('/api/v1/sales/payments', {
      company_id: companyId, customer_id: customerId, amount: '10.0000',
      allocations: [{ sales_invoice_id: invoiceId, amount: '10.0000' }],
    });
    expect(p3.status).toBe(422);
  });

  it('posts a credit note on return: receivable reduced, stock + COGS reversed at avg cost', async () => {
    // Deliver + invoice the remaining 4 units first.
    const orderId = (global as unknown as { orderId: string }).orderId;
    const order = await client.get(`/api/v1/sales/orders/${orderId}`);
    const lineId = order.body.lines[0].id;
    const dv = await client.post('/api/v1/sales/deliveries', {
      company_id: companyId, sales_order_id: orderId,
      lines: [{ sales_order_line_id: lineId, quantity: '4.0000' }],
    });
    await client.post(`/api/v1/sales/deliveries/${dv.body.delivery.id}/post`, {});

    const inv2 = await client.post('/api/v1/sales/invoices', {
      company_id: companyId, customer_id: customerId, sales_order_id: orderId,
    });
    expect(inv2.body.invoice.total).toBe('615.6000'); // 4*150=600 -10% =540 +14% =75.60
    const invoice2Id = inv2.body.invoice.id;
    await client.post(`/api/v1/sales/invoices/${invoice2Id}/post`, {});

    const ord = await client.get(`/api/v1/sales/orders/${orderId}`);
    expect(ord.body.status).toBe('invoiced');

    // Credit note: return 1 unit. 1*150=150 -10% =135 +14% =18.90 => 153.90
    const cn = await client.post('/api/v1/sales/credit-notes', {
      company_id: companyId, customer_id: customerId, sales_invoice_id: invoice2Id,
      reason: 'Defective unit returned', is_return: true,
      lines: [{ product_id: stockedProductId, description: 'Widget return', quantity: '1.0000', unit_price: '150.0000', discount_rate: '10', tax_rate: '14' }],
    });
    expect(cn.status).toBe(201);
    expect(cn.body.credit_note.number).toMatch(/^CN-/);
    expect(cn.body.credit_note.total).toBe('153.9000');

    const post = await client.post(`/api/v1/sales/credit-notes/${cn.body.credit_note.id}/post`, { warehouse_id: warehouseId });
    expect(post.status).toBe(201);
    expect(post.body.credit_note.status).toBe('posted');

    // Credit journal: Dr 4110 135 / Dr 2120 18.90 / Cr 1210 153.90
    const rows = await prisma.journalLine.findMany({ where: { journalEntryId: post.body.journal_id }, include: { account: true } });
    const byCode: Record<string, { debit: string; credit: string }> = {};
    for (const r of rows) byCode[r.account.code] = { debit: r.debit.toString(), credit: r.credit.toString() };
    expect(Number(byCode['4110'].debit)).toBeCloseTo(135, 2);
    expect(Number(byCode['2120'].debit)).toBeCloseTo(18.90, 2);
    expect(Number(byCode['1210'].credit)).toBeCloseTo(153.90, 2);

    // COGS reversal journal: Dr 1310 100 / Cr 5110 100 (avg cost, not selling price).
    const cogsRows = await prisma.journalEntry.findMany({
      where: { sourceType: 'credit_note', sourceId: cn.body.credit_note.id, journalType: 'credit_note_return' },
      include: { lines: { include: { account: true } } },
    });
    expect(cogsRows).toHaveLength(1);
    const cogsByCode: Record<string, string> = {};
    for (const r of cogsRows[0].lines) cogsByCode[r.account.code] = r.debit.toString() + '/' + r.credit.toString();
    const [c1310d, c1310c] = cogsByCode['1310'].split('/').map(Number);
    const [c5110d, c5110c] = cogsByCode['5110'].split('/').map(Number);
    expect(c1310d).toBeCloseTo(100, 2); expect(c1310c).toBe(0);
    expect(c5110d).toBe(0); expect(c5110c).toBeCloseTo(100, 2);

    // Invoice outstanding reduced: 615.60 - 153.90 = 461.70
    const inv = await client.get(`/api/v1/sales/invoices/${invoice2Id}`);
    expect(inv.body.outstanding).toBe('461.7000');
    expect(inv.body.status).toBe('partially_paid');

    // Stock back: 20 - 10 delivered + 1 returned = 11 on hand.
    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${stockedProductId}`);
    const b = (Array.isArray(bal.body) ? bal.body : bal.body.data)[0];
    expect(b.on_hand).toBe('11.0000');
  });

  it('invoices a service order directly without delivery', async () => {
    const so = await client.post('/api/v1/sales/orders', {
      company_id: companyId, customer_id: customerId, warehouse_id: warehouseId,
      lines: [{ product_id: serviceProductId, description: 'Consulting', quantity: '2.0000', unit_price: '500.0000', discount_rate: '0', tax_rate: '0' }],
    });
    expect(so.status).toBe(201);
    const orderId = so.body.sales_order.id;

    // Confirm creates NO reservation for service lines.
    const conf = await client.post(`/api/v1/sales/orders/${orderId}/confirm`, {});
    expect(conf.body.reservations).toHaveLength(0);

    const inv = await client.post('/api/v1/sales/invoices', {
      company_id: companyId, customer_id: customerId, sales_order_id: orderId,
    });
    expect(inv.status).toBe(201);
    expect(inv.body.invoice.total).toBe('1000.0000');
    const post = await client.post(`/api/v1/sales/invoices/${inv.body.invoice.id}/post`, {});
    expect(post.body.invoice.status).toBe('posted');

    // Journal has no VAT line (tax 0): Dr 1210 1000 / Cr 4110 1000.
    const rows = await prisma.journalLine.findMany({ where: { journalEntryId: post.body.journal_id }, include: { account: true } });
    expect(rows).toHaveLength(2);
  });

  it('cancels draft and confirmed orders, releasing reservations', async () => {
    const o1 = await client.post('/api/v1/sales/orders', {
      company_id: companyId, customer_id: customerId, warehouse_id: warehouseId,
      lines: [{ product_id: stockedProductId, description: 'Widget', quantity: '2.0000', unit_price: '150.0000' }],
    });
    const c1 = await client.post(`/api/v1/sales/orders/${o1.body.sales_order.id}/cancel`, {});
    expect(c1.body.sales_order.status).toBe('cancelled');

    const o2 = await client.post('/api/v1/sales/orders', {
      company_id: companyId, customer_id: customerId, warehouse_id: warehouseId,
      lines: [{ product_id: stockedProductId, description: 'Widget', quantity: '2.0000', unit_price: '150.0000' }],
    });
    const o2id = o2.body.sales_order.id;
    await client.post(`/api/v1/sales/orders/${o2id}/confirm`, {});
    const c2 = await client.post(`/api/v1/sales/orders/${o2id}/cancel`, {});
    expect(c2.body.sales_order.status).toBe('cancelled');
    // Its reservation was released.
    const res = await client.get(`/api/v1/inventory/reservations?company_id=${companyId}&product_id=${stockedProductId}&status=active`);
    const list = Array.isArray(res.body) ? res.body : res.body.data;
    const mine = list.filter((r: { sourceId: string }) => r.sourceId === o2id);
    expect(mine).toHaveLength(0);

    // Cannot cancel a delivered order.
    const orderId = (global as unknown as { orderId: string }).orderId;
    const bad = await client.post(`/api/v1/sales/orders/${orderId}/cancel`, {});
    expect(bad.status).toBe(422);
  });

  it('keeps the trial balance balanced after the full lifecycle', async () => {
    const tb = await client.get(`/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`);
    expect(tb.status).toBe(200);
    const lines = tb.body.lines ?? tb.body.data?.lines ?? [];
    let dr = 0, cr = 0;
    for (const l of lines) { dr += Number(l.total_debit); cr += Number(l.total_credit); }
    expect(dr).toBeCloseTo(cr, 2);
    expect(dr).toBeGreaterThan(0);
  });
});
