/**
 * E2E: Phase 5 inventory engine — movement ledger, reservations, weighted-average
 * valuation, transfers, adjustments, counts, COGS/GRNI postings, concurrency.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'inv-admin@atlas.test';
const ADMIN_PASSWORD = 'InvAdmin123!';
const DATE = '2026-06-15';

describe('Inventory engine (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let orgId: string;
  let companyId: string;
  let warehouseId: string;
  let warehouse2Id: string;
  let productId: string;
  let serviceProductId: string;

  const recv = (product_id: string, quantity: string, unit_cost: string, extra: object = {}) =>
    client.post('/api/v1/inventory/movements/receive', {
      company_id: companyId, warehouse_id: warehouseId, product_id,
      movement_type: 'receive', quantity, unit_cost, movement_date: DATE, ...extra,
    });

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Inv Org',
      organizationNameAr: 'منظمة المخزون',
      adminName: 'Inv Admin',
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

    // Second warehouse for transfers.
    const br2 = await client.post('/api/v1/branches', {
      companyId, name: 'Branch 2', nameAr: 'الفرع الثاني',
    });
    expect(br2.status).toBe(201);
    const wh2 = await client.post('/api/v1/warehouses', {
      branchId: br2.body.id ?? br2.body.data?.id, name: 'Warehouse 2', nameAr: 'المخزن الثاني',
    });
    expect(wh2.status).toBe(201);
    warehouse2Id = wh2.body.id ?? wh2.body.data?.id;

    const uom = await client.post('/api/v1/units-of-measure', {
      code: 'PCS', name_ar: 'قطعة', name_en: 'Piece',
    });
    expect(uom.status).toBe(201);
    const uomId = uom.body.id;

    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'INV-WIDGET', name_ar: 'صنف مخزني',
      name_en: 'Stocked Widget', type: 'stocked', base_uom_id: uomId,
      purchase_price: '90.0000', sales_price: '150.0000', reorder_level: '5.0000',
    });
    expect(prod.status).toBe(201);
    productId = prod.body.id;

    const svc = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'INV-SERVICE', name_ar: 'خدمة',
      name_en: 'Service Item', type: 'service', base_uom_id: uomId,
    });
    expect(svc.status).toBe(201);
    serviceProductId = svc.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('receives stock and derives balances from movements', async () => {
    const res = await recv(productId, '10.0000', '100.0000', { idempotency_key: 'recv-1' });
    expect(res.status).toBe(201);
    expect(res.body.movement.quantity).toBe('10.0000');
    expect(res.body.journal_id).toBeTruthy();

    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    expect(bal.status).toBe(200);
    const row = bal.body.data[0];
    expect(row.on_hand).toBe('10.0000');
    expect(row.reserved).toBe('0.0000');
    expect(row.available).toBe('10.0000');
    expect(row.avg_cost).toBe('100.0000');
  });

  it('replays a duplicate receipt idempotently (no double movement)', async () => {
    const res = await recv(productId, '10.0000', '100.0000', { idempotency_key: 'recv-1' });
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(true);
    const count = await prisma.stockMovement.count({
      where: { productId, movementType: 'receive' },
    });
    expect(count).toBe(1);
  });

  it('posts Dr Inventory / Cr GRNI for the receipt (ACCOUNTING_RULES template)', async () => {
    const journals = await prisma.journalEntry.findMany({
      where: { sourceType: 'stock_movement', journalType: 'inventory_receipt' },
      include: { lines: { include: { account: true } } },
    });
    expect(journals).toHaveLength(1);
    const lines = journals[0].lines;
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.debit.toFixed(2) === '1000.00')!;
    const cr = lines.find((l) => l.credit.toFixed(2) === '1000.00')!;
    expect(dr.account.code).toBe('1310');
    expect(cr.account.code).toBe('1320');
  });

  it('reserves stock and rejects over-reservation (422 INSUFFICIENT_STOCK)', async () => {
    const r = await client.post('/api/v1/inventory/reservations', {
      company_id: companyId, warehouse_id: warehouseId, product_id: productId,
      quantity: '4.0000', source_type: 'test',
    });
    expect(r.status).toBe(201);

    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    expect(bal.body.data[0].available).toBe('6.0000');
    expect(bal.body.data[0].reserved).toBe('4.0000');

    const over = await client.post('/api/v1/inventory/reservations', {
      company_id: companyId, warehouse_id: warehouseId, product_id: productId,
      quantity: '7.0000',
    });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('INSUFFICIENT_STOCK');
    expect(over.body.message_ar).toBeTruthy();
  });

  it('never oversells under concurrent reservations (race-safe)', async () => {
    // Fresh product with exactly 10 units.
    const uom = await client.post('/api/v1/units-of-measure', { code: 'BX', name_ar: 'علبة', name_en: 'Box' });
    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'RACE-ITEM', name_ar: 'صنف السباق',
      name_en: 'Race Item', type: 'stocked', base_uom_id: uom.body.id,
    });
    await recv(prod.body.id, '10.0000', '50.0000');

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        client.post('/api/v1/inventory/reservations', {
          company_id: companyId, warehouse_id: warehouseId, product_id: prod.body.id,
          quantity: '3.0000', idempotency_key: `race-${i}`,
        }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 201);
    const rejected = attempts.filter((r) => r.status === 422 && r.body.code === 'INSUFFICIENT_STOCK');
    // 3 × 3 = 9 reserved; the 4th and 5th must fail (would exceed 10).
    expect(ok).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    const bal = await client.get(
      `/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${prod.body.id}`,
    );
    expect(bal.body.data[0].reserved).toBe('9.0000');
    expect(bal.body.data[0].available).toBe('1.0000');
  });

  it('issues stock with COGS at weighted average and consumes the reservation', async () => {
    // Release the earlier 4-unit reservation first to simplify.
    const list = await client.get(`/api/v1/inventory/reservations?company_id=${companyId}&product_id=${productId}&status=active`);
    for (const r of list.body.data) {
      await client.post(`/api/v1/inventory/reservations/${r.id}/release`, {});
    }
    const r2 = await client.post('/api/v1/inventory/reservations', {
      company_id: companyId, warehouse_id: warehouseId, product_id: productId, quantity: '4.0000',
    });
    const reservationId = r2.body.reservation.id;

    const issue = await client.post('/api/v1/inventory/movements/issue', {
      company_id: companyId, warehouse_id: warehouseId, product_id: productId,
      movement_type: 'issue', quantity: '3.0000', unit_cost: '0.0000',
      movement_date: DATE, reservation_id: reservationId,
    });
    expect(issue.status).toBe(201);
    expect(issue.body.cogs).toBe('300.00'); // 3 × 100 avg

    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    const row = bal.body.data[0];
    expect(row.on_hand).toBe('7.0000');
    expect(row.reserved).toBe('1.0000'); // 4 - 3 consumed (named reservation)
    expect(row.available).toBe('6.0000');

    // GL: Dr COGS / Cr Inventory 300
    const journals = await prisma.journalEntry.findMany({
      where: { journalType: 'inventory_issue' },
      include: { lines: { include: { account: true } } },
    });
    expect(journals.length).toBeGreaterThanOrEqual(1);
    const j = journals[journals.length - 1];
    const dr = j.lines.find((l) => l.debit.toFixed(2) === '300.00')!;
    const cr = j.lines.find((l) => l.credit.toFixed(2) === '300.00')!;
    expect(dr.account.code).toBe('5110');
    expect(cr.account.code).toBe('1310');
  });

  it('rejects issuing more than available (422)', async () => {
    const res = await client.post('/api/v1/inventory/movements/issue', {
      company_id: companyId, warehouse_id: warehouseId, product_id: productId,
      movement_type: 'issue', quantity: '999.0000', unit_cost: '0.0000', movement_date: DATE,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects stock movements on service products (422 PRODUCT_NOT_STOCKED)', async () => {
    const res = await recv(serviceProductId, '5.0000', '10.0000');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRODUCT_NOT_STOCKED');
  });

  it('blends the weighted average across receipts (movement-by-movement check)', async () => {
    // Current: 7 @ 100 avg. Receive 10 @ 200 -> (700 + 2000)/17 = 158.8235
    const res = await recv(productId, '10.0000', '200.0000', { idempotency_key: 'recv-2' });
    expect(res.status).toBe(201);

    const entries = await prisma.inventoryValuationEntry.findMany({
      where: { productId, warehouseId },
      orderBy: { createdAt: 'asc' },
      include: { movement: true },
    });
    // Replay the ledger in order and verify each step.
    let qty = 0;
    let value = 0;
    for (const e of entries) {
      const dq = Number(e.quantityDelta);
      const dc = Number(e.costDelta);
      if (dq > 0) {
        value += dc;
        qty += dq;
      } else {
        value += dc; // negative
        qty += dq;
      }
      const expectedAvg = qty === 0 ? 0 : value / qty;
      expect(Number(e.resultingQty)).toBeCloseTo(qty, 4);
      expect(Number(e.resultingAvgCost)).toBeCloseTo(expectedAvg, 3);
    }
    expect(qty).toBeCloseTo(17, 4);
    expect(value / qty).toBeCloseTo(158.8235, 3);

    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    expect(bal.body.data[0].avg_cost).toBe('158.8235');
  });

  it('transfers stock between warehouses keeping company totals', async () => {
    const before1 = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    const before2 = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouse2Id}&product_id=${productId}`);
    const q1 = Number(before1.body.data[0]?.on_hand ?? 0);

    const tr = await client.post('/api/v1/inventory/transfers', {
      company_id: companyId, from_warehouse_id: warehouseId, to_warehouse_id: warehouse2Id,
      lines: [{ product_id: productId, quantity: '2.0000' }],
    });
    expect(tr.status).toBe(201);
    expect(tr.body.transfer.status).toBe('draft');
    const transferId = tr.body.transfer.id;

    const bad = await client.post(`/api/v1/inventory/transfers/${transferId}/receive`, {});
    expect(bad.status).toBe(422); // must dispatch first

    const disp = await client.post(`/api/v1/inventory/transfers/${transferId}/dispatch`, {});
    expect(disp.status).toBe(201);
    expect(disp.body.transfer.status).toBe('dispatched');

    const mid1 = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    expect(Number(mid1.body.data[0].on_hand)).toBeCloseTo(q1 - 2, 4);

    const recvT = await client.post(`/api/v1/inventory/transfers/${transferId}/receive`, {});
    expect(recvT.status).toBe(201);
    expect(recvT.body.transfer.status).toBe('received');

    const after1 = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    const after2 = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouse2Id}&product_id=${productId}`);
    expect(Number(after1.body.data[0].on_hand)).toBeCloseTo(q1 - 2, 4);
    expect(Number(after2.body.data[0]?.on_hand ?? 0)).toBeCloseTo(2, 4);
    // Company total unchanged.
    const totalBefore = q1 + Number(before2.body.data[0]?.on_hand ?? 0);
    const totalAfter = Number(after1.body.data[0].on_hand) + Number(after2.body.data[0].on_hand);
    expect(totalAfter).toBeCloseTo(totalBefore, 4);
    // Destination got the source's unit cost (valuation travels).
    expect(after2.body.data[0].avg_cost).toBe(after1.body.data[0].avg_cost);
  });

  it('rejects same-warehouse transfers', async () => {
    const res = await client.post('/api/v1/inventory/transfers', {
      company_id: companyId, from_warehouse_id: warehouseId, to_warehouse_id: warehouseId,
      lines: [{ product_id: productId, quantity: '1.0000' }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SAME_WAREHOUSE_TRANSFER');
  });

  it('runs the adjustment approval flow and posts GL', async () => {
    const adj = await client.post('/api/v1/inventory/adjustments', {
      company_id: companyId, warehouse_id: warehouseId,
      reason: 'Found extra units', lines: [{ product_id: productId, quantity_delta: '5.0000', unit_cost: '120.0000' }],
    });
    expect(adj.status).toBe(201);
    const adjId = adj.body.adjustment.id;

    const sub = await client.post(`/api/v1/inventory/adjustments/${adjId}/submit`, {});
    expect(sub.status).toBe(201);

    // Self-approval is forbidden.
    const selfApprove = await client.post(`/api/v1/inventory/adjustments/${adjId}/approve`, {});
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    // Under the 10k threshold: posts from submitted without approval.
    const post = await client.post(`/api/v1/inventory/adjustments/${adjId}/post`, {});
    expect(post.status).toBe(201);
    expect(post.body.adjustment.status).toBe('posted');

    // GL: Dr 1310 / Cr 5390 for 600.00
    const journals = await prisma.journalEntry.findMany({
      where: { journalType: 'inventory_adjustment', sourceId: adjId },
      include: { lines: { include: { account: true } } },
    });
    expect(journals).toHaveLength(1);
    const dr = journals[0].lines.find((l) => l.debit.toFixed(2) === '600.00')!;
    const cr = journals[0].lines.find((l) => l.credit.toFixed(2) === '600.00')!;
    expect(dr.account.code).toBe('1310');
    expect(cr.account.code).toBe('5390');
  });

  it('requires approval for high-value adjustments', async () => {
    const adj = await client.post('/api/v1/inventory/adjustments', {
      company_id: companyId, warehouse_id: warehouseId,
      reason: 'Big gain', lines: [{ product_id: productId, quantity_delta: '100.0000', unit_cost: '200.0000' }],
    });
    const adjId = adj.body.adjustment.id;
    await client.post(`/api/v1/inventory/adjustments/${adjId}/submit`, {});
    const post = await client.post(`/api/v1/inventory/adjustments/${adjId}/post`, {});
    expect(post.status).toBe(403);
    expect(post.body.code).toBe('ADJUSTMENT_APPROVAL_REQUIRED');
  });

  it('posts a stock count and creates variance movements', async () => {
    const before = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    const onHand = Number(before.body.data[0].on_hand);

    const cnt = await client.post('/api/v1/inventory/counts', {
      company_id: companyId, warehouse_id: warehouseId,
      lines: [{ product_id: productId }],
    });
    expect(cnt.status).toBe(201);
    const countId = cnt.body.count.id;

    const start = await client.post(`/api/v1/inventory/counts/${countId}/start`, {});
    expect(start.status).toBe(201);
    expect(Number(start.body.count.lines[0].system_qty)).toBeCloseTo(onHand, 4);

    const counted = Math.max(0, onHand - 2);
    await client.patch(`/api/v1/inventory/counts/${countId}/lines`, {
      lines: [{ product_id: productId, counted_qty: counted.toFixed(4) }],
    });
    const post = await client.post(`/api/v1/inventory/counts/${countId}/post`, {});
    expect(post.status).toBe(201);

    const after = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    expect(Number(after.body.data[0].on_hand)).toBeCloseTo(counted, 4);

    const varMovs = await prisma.stockMovement.count({
      where: { sourceType: 'inventory_count', sourceId: countId },
    });
    expect(varMovs).toBe(1);
  });

  it('allows opening stock only on a clean product', async () => {
    const uom = await client.post('/api/v1/units-of-measure', { code: 'LT', name_ar: 'لتر', name_en: 'Litre' });
    const prod = await client.post('/api/v1/products', {
      company_id: companyId, sku: 'OPEN-ITEM', name_ar: 'صنف افتتاحي',
      name_en: 'Opening Item', type: 'stocked', base_uom_id: uom.body.id,
    });
    const open = await client.post('/api/v1/inventory/movements/opening', {
      company_id: companyId, warehouse_id: warehouseId, product_id: prod.body.id,
      movement_type: 'opening', quantity: '50.0000', unit_cost: '10.0000', movement_date: DATE,
    });
    expect(open.status).toBe(201);

    const again = await client.post('/api/v1/inventory/movements/opening', {
      company_id: companyId, warehouse_id: warehouseId, product_id: prod.body.id,
      movement_type: 'opening', quantity: '5.0000', unit_cost: '10.0000', movement_date: DATE,
    });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('OPENING_STOCK_EXISTS');
  });

  it('keeps the trial balance balanced after all inventory postings', async () => {
    const tb = await client.get(`/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`);
    expect(tb.status).toBe(200);
    expect(tb.body.balanced).toBe(true);
    expect(Number(tb.body.total_debit)).toBeCloseTo(Number(tb.body.total_credit), 2);
  });

  it('exposes the valuation report with reconciling totals', async () => {
    const val = await client.get(`/api/v1/inventory/valuation?company_id=${companyId}`);
    expect(val.status).toBe(200);
    const lines = val.body.data as Array<{ total_value: string }>;
    const sum = lines.reduce((a, l) => a + Number(l.total_value), 0);
    expect(sum).toBeCloseTo(Number(val.body.meta.total_value), 2);

    // Cross-check against raw SQL: sum(movements) per product/warehouse.
    const rows = await prisma.$queryRaw<Array<{ product_id: string; warehouse_id: string; qty: number; val: number }>>`
      SELECT product_id, warehouse_id,
             SUM(quantity)::float AS qty,
             SUM(total_cost)::float AS val
      FROM stock_movements GROUP BY product_id, warehouse_id`;
    for (const r of rows) {
      const line = lines.find((l) => (l as unknown as { product_id: string }).product_id === r.product_id
        && (l as unknown as { warehouse_id: string }).warehouse_id === r.warehouse_id);
      expect(line).toBeTruthy();
      expect(Number((line as unknown as { on_hand: string }).on_hand)).toBeCloseTo(r.qty, 3);
    }
  });

  it('rejects cross-organization access to inventory', async () => {
    const realOrg = client.orgId;
    client.orgId = '00000000-0000-0000-0000-000000000000';
    try {
      const res = await client.get(`/api/v1/inventory/balances?company_id=${companyId}`);
      expect([401, 403]).toContain(res.status);
    } finally {
      client.orgId = realOrg;
    }
  });

  it('lists movement history with filters', async () => {
    const res = await client.get(
      `/api/v1/inventory/movements?company_id=${companyId}&movement_type=receive&product_id=${productId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    for (const m of res.body.data) {
      expect(m.movement_type).toBe('receive');
    }
  });

  it('flags low-stock products from reorder levels', async () => {
    // INV-WIDGET has reorder_level 5; release reservations then drain on_hand below 5 in warehouse 1.
    const actives = await client.get(`/api/v1/inventory/reservations?company_id=${companyId}&product_id=${productId}&status=active`);
    for (const r of actives.body.data) {
      await client.post(`/api/v1/inventory/reservations/${r.id}/release`, {});
    }
    const bal = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&warehouse_id=${warehouseId}&product_id=${productId}`);
    const onHand = Number(bal.body.data[0].on_hand);
    if (onHand > 4) {
      const issue = await client.post('/api/v1/inventory/movements/issue', {
        company_id: companyId, warehouse_id: warehouseId, product_id: productId,
        movement_type: 'issue', quantity: (onHand - 4).toFixed(4),
        unit_cost: '0.0000', movement_date: DATE,
      });
      expect(issue.status).toBe(201);
    }
    const low = await client.get(`/api/v1/inventory/balances?company_id=${companyId}&low_stock_only=true`);
    expect(low.status).toBe(200);
    const flagged = (low.body.data as Array<{ sku: string; low_stock: boolean; warehouse_id: string }>)
      .filter((r) => r.sku === 'INV-WIDGET' && r.warehouse_id === warehouseId);
    expect(flagged.length).toBe(1);
    expect(flagged[0].low_stock).toBe(true);
  });
});
