/**
 * ATLAS ERP — Phase 12 demo data seed ("Atlas Business Group").
 *
 * Drives the REAL API (HTTP) through domain lifecycles. Deterministic via a
 * seeded PRNG (mulberry32). NEVER run against dev/test — the guard below
 * refuses unless DATABASE_URL points at atlas_erp_demo.
 *
 * Usage (from apps/api):
 *   set -a && source .env && set +a
 *   DEMO_API=http://localhost:3001 pnpm exec tsx ../../scripts/demo/seed-demo.ts
 */
import { readFileSync } from 'node:fs';

// ---------- guard ----------
const dbUrl = process.env.DEMO_DATABASE_URL || process.env.DATABASE_URL || '';
const dbName = (dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '').toLowerCase();
if (dbName === 'atlas_erp_dev' || dbName === 'atlas_erp_test' || !dbName.includes('demo')) {
  console.error(`REFUSING: target DB "${dbName}" is not the demo database.`);
  process.exit(2);
}
const BASE = (process.env.DEMO_API || 'http://localhost:3001') + '/api/v1';
console.log(`Seeding demo data into "${dbName}" via ${BASE}`);

// ---------- deterministic PRNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261103);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const money = (v: number) => v.toFixed(4);

// ---------- HTTP client ----------
let cookieJar: Record<string, string> = {};
let csrf = '';
let orgId = '';
function storeCookies(res: Response) {
  // fetch exposes combined set-cookie; split carefully on known cookie names
  const raw = res.headers.get('set-cookie') || '';
  // split on ", " followed by a cookie name pattern (atlas_* or sid)
  const parts = raw.split(/,(?=\s*(atlas_|sid|connect)[^=]*=)/);
  for (const p of parts) {
    const m = p.trim().match(/^([^=]+)=([^;]*)/);
    if (m) cookieJar[m[1].trim()] = m[2].trim();
  }
}
function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function refreshCsrf() {
  const r = await rawApi('GET', '/auth/csrf');
  csrf = r.csrfToken;
}
async function api(method: string, path: string, body?: any, idem?: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await rawApi(method, path, body, idem);
    } catch (e: any) {
      if (e.message.includes('CSRF_INVALID') && attempt === 0) {
        await refreshCsrf();
        continue;
      }
      throw e;
    }
  }
  throw new Error('unreachable');
}
async function rawApi(method: string, path: string, body?: any, idem?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: cookieHeader() };
  if (orgId) headers['X-Organization-Id'] = orgId;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(BASE + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} ${method} ${path}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}
const get = (p: string) => api('GET', p);
const post = (p: string, b?: any, idem?: string) => api('POST', p, b, idem);

async function main() {
// ---------- setup ----------
console.log('== first-run ==');
const fr = await post('/auth/first-run', {
  organizationName: 'Atlas Business Group',
  organizationNameAr: 'مجموعة أطلس للأعمال',
  adminName: 'Demo Admin', adminEmail: 'demo@atlas.test', password: 'Demo12345!',
});
orgId = fr.organization.id;
const company1 = fr.company.id;
// explicit login to ensure full permission set in session
cookieJar = {};
await rawApi('POST', '/auth/login', { email: 'demo@atlas.test', password: 'Demo12345!' });
const csrfR2 = await rawApi('GET', '/auth/csrf');
csrf = csrfR2.csrfToken;
console.log('org:', orgId.slice(0, 8), 'company1:', company1.slice(0, 8));

const csrfR = await get('/auth/csrf');
csrf = csrfR.csrfToken;

// fiscal year
await post('/fiscal-years', { company_id: company1, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31' });

// second company
const co2 = await post('/companies', { organizationId: orgId, name: 'Atlas Trading - Alexandria', nameAr: 'أطلس للتجارة - الإسكندرية' });
const company2 = co2.id;
await post('/fiscal-years', { company_id: company2, name: 'FY2026', start_date: '2026-01-01', end_date: '2026-12-31' });
console.log('company2:', company2.slice(0, 8));

// branches & warehouses (first-run creates a default branch + warehouse per company)
async function mainWarehouse(companyId: string): Promise<string> {
  const br = await get('/branches');
  const list = (Array.isArray(br) ? br : br.data).filter((b: any) => (b.companyId ?? b.company_id) === companyId);
  if (!list.length) {
    // create a branch for company2
    const nb = await post('/branches', { companyId, name: 'Alexandria Branch', nameAr: 'فرع الإسكندرية' });
    list.push(nb);
  }
  const wh = await get('/warehouses');
  const wlist = (Array.isArray(wh) ? wh : wh.data).filter((w: any) => (w.branchId ?? w.branch_id) === (list[0].id ?? list[0].data?.id));
  const branchId = list[0].id ?? list[0].data?.id;
  if (!wlist.length) {
    const nw = await post('/warehouses', { branchId, name: 'Main Warehouse', nameAr: 'المخزن الرئيسي' });
    return nw.id ?? nw.data?.id;
  }
  return wlist[0].id;
}
const wh1 = await mainWarehouse(company1);
const wh2 = await mainWarehouse(company2);
// two more warehouses for company1
const br1 = await get('/branches');
const br1list = (Array.isArray(br1) ? br1 : br1.data).filter((b: any) => (b.companyId ?? b.company_id) === company1);
const br1id = br1list[0].id;
const whExtra1 = await post('/warehouses', { branchId: br1id, name: 'Returns Warehouse', nameAr: 'مخزن المرتجعات' });
const whExtra2 = await post('/warehouses', { branchId: br1id, name: 'Bulk Storage', nameAr: 'مخزن الجملة' });
const warehouses = [wh1, whExtra1.id, whExtra2.id];
console.log('warehouses:', warehouses.length);

// approver user
const roles = await get('/roles');
const rlist = Array.isArray(roles) ? roles : roles.data;
const adminRole = rlist.find((r: any) => r.name === 'Company Administrator');
const finRole = rlist.find((r: any) => r.name === 'Finance Manager');
const inv = await post('/auth/invitations', { email: 'approver@atlas.test', roleIds: [adminRole.id, finRole.id], companyIds: [company1, company2] });
await post('/auth/invitations/accept', { token: inv.token, name: 'Approver', password: 'Approver1234!' });
// approver client
let aJar: Record<string, string> = {};
let aCsrf = '';
async function aapi(method: string, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Organization-Id': orgId };
  headers['Cookie'] = Object.entries(aJar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (aCsrf) headers['X-CSRF-Token'] = aCsrf;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = res.headers.get('set-cookie') || '';
  for (const p of raw.split(/,(?=\s*(atlas_|sid|connect)[^=]*=)/)) {
    const m = p.trim().match(/^([^=]+)=([^;]*)/);
    if (m) aJar[m[1].trim()] = m[2].trim();
  }
  const data = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`HTTP ${res.status} ${method} ${path}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
await aapi('POST', '/auth/login', { email: 'approver@atlas.test', password: 'Approver1234!' });
aCsrf = (await aapi('GET', '/auth/csrf')).csrfToken;
console.log('approver ready');
// re-login main user (approver flow invalidates main session permissions)
cookieJar = {};
await rawApi('POST', '/auth/login', { email: 'demo@atlas.test', password: 'Demo12345!' });
csrf = (await rawApi('GET', '/auth/csrf')).csrfToken;

// ---------- master data ----------
const uomPcs = (await post('/units-of-measure', { code: 'PCS', name_ar: 'قطعة', name_en: 'Piece' })).id;
const uomBox = (await post('/units-of-measure', { code: 'BOX', name_ar: 'علبة', name_en: 'Box' })).id;
const uomKg = (await post('/units-of-measure', { code: 'KG', name_ar: 'كيلو', name_en: 'Kilo' })).id;
const uoms = [uomPcs, uomBox, uomKg];

const categories: string[] = [];
for (const [en, ar, code] of [['Electronics', 'إلكترونيات', 'ELEC'], ['Home Appliances', 'أجهزة منزلية', 'HOME'], ['Office Supplies', 'مستلزمات مكتبية', 'OFFC'], ['Industrial Tools', 'عدد صناعية', 'TOOL']]) {
  const c = await post('/product-categories', { company_id: company1, name_en: en, name_ar: ar, code });
  categories.push(c.id);
}

const prodNames: [string, string][] = [
  ['LED TV 43"', 'شاشة LED 43 بوصة'], ['Bluetooth Speaker', 'سماعة بلوتوث'], ['Wireless Mouse', 'ماوس لاسلكي'],
  ['USB-C Hub', 'موزع USB-C'], ['Power Bank 20000', 'باور بانك 20000'], ['Desk Lamp LED', 'مصباح مكتب LED'],
  ['Electric Kettle', 'غلاية كهربائية'], ['Stand Fan', 'مروحة ستاند'],
  ['Air Fryer', 'قلاية هوائية'], ['Vacuum Cleaner', 'مكنسة كهربائية'], ['Iron Steam', 'مكواة بخار'],
  ['Blender Pro', 'خلاط برو'], ['Microwave 20L', 'ميكروويف 20 لتر'],
  ['A4 Paper Box', 'علبة ورق A4'], ['Ballpoint Pens 50', 'أقلام جاف 50'], ['Stapler Heavy', 'دباسة ثقيلة'],
  ['Notebook Hardcover', 'نوت بوك غلاف صلب'], ['Toner Cartridge', 'حبارة طابعة'], ['Filing Cabinet', 'دولاب ملفات'],
  ['Desk Organizer', 'منظم مكتب'], ['Whiteboard 120', 'سبورة بيضاء 120'],
  ['Drill 13mm', 'شنيور 13مم'], ['Angle Grinder', 'صاروخ تقطيع'], ['Wrench Set 12', 'طقم مفاتيح 12'],
  ['Screwdriver Set', 'طقم مفكات'], ['Measuring Tape 5m', 'متر قياس 5م'], ['Safety Helmet', 'خوذة أمان'],
  ['Work Gloves', 'جوانتي شغل'], ['Toolbox 3-Tray', 'شنطة عدة 3 دور'],
];
const products: { id: string; buy: number; sell: number }[] = [];
for (let i = 0; i < prodNames.length; i++) {
  const [en, ar] = prodNames[i];
  const cat = categories[Math.floor(i / 8) % 4];
  const buy = int(80, 2500);
  const sell = Math.round(buy * (1.25 + rand() * 0.35));
  const p = await post('/products', {
    company_id: company1, sku: `ATL-${String(i + 1).padStart(3, '0')}`,
    name_en: en, name_ar: ar, type: 'stocked', base_uom_id: pick(uoms),
    category_id: cat, purchase_price: money(buy), sales_price: money(sell),
  });
  products.push({ id: p.id, buy, sell });
}
console.log('products:', products.length);

const custNames: [string, string][] = [
  ['Cairo Retail Co', 'شركة القاهرة للتجزئة'], ['Nile Markets', 'أسواق النيل'], ['Delta Traders', 'تجار الدلتا'],
  ['Sphinx Electronics', 'سفنكس للإلكترونيات'], ['Pyramids Home', 'بيراميدز للمنزل'],
  ['Alexandria Stores', 'محلات الإسكندرية'], ['Giza Supplies', 'مستلزمات الجيزة'],
  ['New Cairo Mall', 'مول القاهرة الجديدة'], ['Tanta Wholesale', 'طنطا للجملة'],
  ['Mansoura Retail', 'المنصورة للتجزئة'], ['Luxor Gifts', 'الأقصر للهدايا'],
  ['Aswan Trading', 'أسوان للتجارة'], ['Port Said Shops', 'محلات بورسعيد'],
  ['Suez Outlets', 'منافذ السويس'], ['Fayoum Markets', 'أسواق الفيوم'],
];
const customers: string[] = [];
for (const [en, ar] of custNames) {
  const c = await post('/customers', { company_id: company1, name_en: en, name_ar: ar, kind: 'company' });
  customers.push(c.data?.id ?? c.id);
}
const supNames: [string, string][] = [
  ['El Sewedy Supply', 'السويدي للتوريدات'], ['Arab Contractors Trade', 'المقاولون العرب للتجارة'],
  ['Misr Import Co', 'شركة مصر للاستيراد'], ['Gulf Parts', 'الخليج لقطع الغيار'],
  ['TechSource Egypt', 'تك سورس مصر'], ['Medina Wholesale', 'المدينة للجملة'],
  ['Horizon Goods', 'هورايزون للبضائع'], ['Alpha Distributors', 'ألفا للتوزيع'],
  ['Cairo Bulk Trade', 'القاهرة لتجارة الجملة'], ['Nile Import House', 'بيت النيل للاستيراد'],
];
const suppliers: string[] = [];
for (const [en, ar] of supNames) {
  const s = await post('/suppliers', { company_id: company1, name_en: en, name_ar: ar, kind: 'company' });
  suppliers.push(s.data?.id ?? s.id);
}
console.log('customers:', customers.length, 'suppliers:', suppliers.length);

// ---------- helpers ----------
let docCount = 0;
const purchasedProducts = new Set<string>();
const monthDate = (m: number, day?: number) => `2026-${String(m + 1).padStart(2, '0')}-${String(day ?? int(2, 26)).padStart(2, '0')}`;

async function purchaseCycle(m: number, i: number) {
  const tag = `demo-po-${m}-${i}`;
  const sup = pick(suppliers);
  const wh = wh1;
  const nLines = int(2, 3);
  const lines = [];
  for (let l = 0; l < nLines; l++) {
    const p = pick(products);
    lines.push({ product_id: p.id, description: 'demo', quantity: money(int(30, 120)), unit_price: money(p.buy) });
  }
  const po = (await post('/purchasing/orders', { company_id: company1, supplier_id: sup, warehouse_id: wh, lines }, tag)).purchase_order;
  for (const l of lines) purchasedProducts.add(l.product_id);
  await post(`/purchasing/orders/${po.id}/submit`, {});
  // big orders need approver
  const poFull = await get(`/purchasing/orders/${po.id}`);
  if (poFull.status === 'submitted') {
    await aapi('POST', `/purchasing/orders/${po.id}/approve`, {});
  }
  const poLines = (await get(`/purchasing/orders/${po.id}`)).lines;
  const grnLines = poLines.map((pl: any) => ({ purchase_order_line_id: pl.id, quantity: pl.quantity, unit_cost: pl.unit_price }));
  const grn = (await post('/purchasing/goods-receipts', {
    company_id: company1, purchase_order_id: po.id, warehouse_id: wh,
    receipt_date: monthDate(m), lines: grnLines,
  }, tag + '-grn')).goods_receipt;
  await post(`/purchasing/goods-receipts/${grn.id}/post`, {}, tag + '-grnpost');
  const grnFull = await get(`/purchasing/goods-receipts/${grn.id}`);
  const billLines = grnFull.lines.map((gl: any, idx: number) => ({
    purchase_order_line_id: poLines[idx].id, goods_receipt_line_id: gl.id,
    product_id: poLines[idx].product_id, description: 'demo',
    quantity: gl.quantity, unit_price: poLines[idx].unit_price, tax_rate: '14',
  }));
  const bill = (await post('/purchasing/bills', {
    company_id: company1, supplier_id: sup, purchase_order_id: po.id,
    bill_date: monthDate(m), lines: billLines,
  }, tag + '-bill')).supplier_bill;
  await post(`/purchasing/bills/${bill.id}/submit`, {});
  const billFull = await get(`/purchasing/bills/${bill.id}`);
  if (billFull.status === 'submitted' || billFull.supplier_bill?.status === 'submitted') {
    await aapi('POST', `/purchasing/bills/${bill.id}/approve`, {});
  }
  await post(`/purchasing/bills/${bill.id}/post`, {}, tag + '-billpost');
  const billPosted = await get(`/purchasing/bills/${bill.id}`);
  const total = billPosted.supplier_bill?.total ?? billPosted.total;
  // pay in 1-2 installments
  const nPay = int(1, 2);
  let remaining = parseFloat(total);
  const partial = rand() < 0.2;
  for (let k = 0; k < nPay; k++) {
    let amt: number;
    if (partial && k === 0) {
      amt = Math.round(remaining * 0.7 * 100) / 100;
    } else if (k === nPay - 1 && !partial) {
      amt = remaining;
    } else if (partial) {
      break;
    } else {
      amt = Math.round(remaining / (nPay - k) * 100) / 100;
    }
    remaining = Math.round((remaining - amt) * 100) / 100;
    const pay = (await post('/purchasing/payments', {
      company_id: company1, supplier_id: sup, amount: money(amt),
      payment_date: monthDate(m), allocations: [{ supplier_bill_id: bill.id, amount: money(amt) }],
    }, `${tag}-pay${k}`)).supplier_payment;
    await post(`/purchasing/payments/${pay.id}/post`, {});
    if (partial) break;
  }
  docCount += 5;
}

async function salesCycle(m: number, i: number) {
  const tag = `demo-so-${m}-${i}`;
  const cust = pick(customers);
  const wh = wh1;
  const nLines = int(1, 3);
  const lines = [];
  const avail = products.filter(p => purchasedProducts.has(p.id));
  for (let l = 0; l < nLines; l++) {
    const p = pick(avail.length ? avail : products);
    lines.push({ product_id: p.id, description: 'demo', quantity: money(int(2, 6)), unit_price: money(p.sell), discount_rate: '0', tax_rate: '14' });
  }
  const q = (await post('/sales/quotations', {
    company_id: company1, customer_id: cust, valid_until: '2026-12-31', lines,
  }, tag + '-q')).quotation;
  await post(`/sales/quotations/${q.id}/send`, {});
  const order = (await post(`/sales/quotations/${q.id}/accept`, { warehouse_id: wh }, tag + '-acc')).sales_order;
  await post(`/sales/orders/${order.id}/confirm`, {});
  const orderFull = await get(`/sales/orders/${order.id}`);
  const dvLines = orderFull.lines.map((ol: any) => ({ sales_order_line_id: ol.id, quantity: ol.quantity }));
  const dv = (await post('/sales/deliveries', {
    company_id: company1, sales_order_id: order.id, delivery_date: monthDate(m), lines: dvLines,
  }, tag + '-dv')).delivery;
  await post(`/sales/deliveries/${dv.id}/post`, {});
  const inv = (await post('/sales/invoices', {
    company_id: company1, customer_id: cust, sales_order_id: order.id, invoice_date: monthDate(m),
  }, tag + '-inv')).invoice;
  await post(`/sales/invoices/${inv.id}/post`, {});
  const invFull = await get(`/sales/invoices/${inv.id}`);
  const total = invFull.invoice?.total ?? invFull.total;
  const nPay = int(1, 2);
  let remaining = parseFloat(total);
  // 30% of invoices: pay only ~60%, leaving AR outstanding
  const partial = rand() < 0.3;
  for (let k = 0; k < nPay; k++) {
    let amt: number;
    if (partial && k === 0) {
      amt = Math.round(remaining * 0.6 * 100) / 100;
    } else if (k === nPay - 1 && !partial) {
      amt = remaining;
    } else if (partial) {
      break; // leave the rest outstanding
    } else {
      amt = Math.round(remaining / (nPay - k) * 100) / 100;
    }
    remaining = Math.round((remaining - amt) * 100) / 100;
    const pay = (await post('/sales/payments', {
      company_id: company1, customer_id: cust, amount: money(amt),
      payment_date: monthDate(m), allocations: [{ sales_invoice_id: inv.id, amount: money(amt) }],
    }, `${tag}-pay${k}`)).payment;
    await post(`/sales/payments/${pay.id}/post`, {});
    if (partial) break;
  }
  docCount += 6;
  return inv.id;
}

// ---------- 6 months of activity ----------
// purchases first (build inventory), then sales
const invoiceIds: string[] = [];
for (let m = 0; m < 6; m++) {
  console.log(`== purchases month ${m + 1}/6 ==`);
  for (let i = 0; i < 8; i++) await purchaseCycle(m, i);
}
for (let m = 0; m < 6; m++) {
  console.log(`== sales month ${m + 1}/6 ==`);
  for (let i = 0; i < 12; i++) invoiceIds.push(await salesCycle(m, i));
}

// ---------- credit notes (returns) ----------
// SKIPPED: credit note returns cause inventory valuation drift (see KNOWN_LIMITATIONS)
// The return logic posts GL correctly but valuation entries diverge for random-product returns.
if (false) { // disabled
// leave some invoices partially unpaid for credit notes: pick invoices with outstanding > 0
let cnDone = 0;
for (const invId of [...invoiceIds].sort(() => rand() - 0.5)) {
  if (cnDone >= 6) break;
  const invFull = await get(`/sales/invoices/${invId}`);
  const inv = invFull.invoice ?? invFull;
  const outstanding = parseFloat(inv.outstanding ?? inv.total ?? '0');
  if (outstanding <= 100) continue;
  const p = products.find(x => x.id === (inv.lines?.[0]?.product_id ?? inv.lines?.[0]?.productId)) ?? pick(products);
  const qty = '1.0000';
  const lineTotal = parseFloat(p.sell) * 1.14;
  if (lineTotal > outstanding) continue;
  const cn = (await post('/sales/credit-notes', {
    company_id: company1, customer_id: inv.customer_id ?? inv.customerId, sales_invoice_id: invId,
    reason: 'Defective unit returned', is_return: true, credit_date: monthDate(int(2, 5)),
    lines: [{ product_id: p.id, description: 'return', quantity: qty, unit_price: money(p.sell), discount_rate: '0', tax_rate: '14' }],
  }, `demo-cn-${cnDone}`)).credit_note;
  await post(`/sales/credit-notes/${cn.id}/post`, { warehouse_id: wh1 });
  docCount++;
  cnDone++;
}
} // end disabled credit notes

// ---------- expense bills ----------
const accts = await get(`/accounts?company_id=${company1}`);
const alist = accts.data ?? accts;
const bankAcct = alist.find((a: any) => a.code === '1110');
const expAcct = alist.find((a: any) => a.code.startsWith('52'));
for (let m = 0; m < 6; m++) {
  for (let i = 0; i < 2; i++) {
    const eb = (await post('/finance/expense-bills', {
      company_id: company1, bill_date: monthDate(m), pay_from: 'bank',
      bank_account_id: bankAcct.id, notes: 'demo expense',
      lines: [{ account_id: expAcct.id, description: 'office', quantity: '1.0000', unit_price: money(int(200, 3000)), tax_rate: '14' }],
    }, `demo-eb-${m}-${i}`)).expense_bill;
    await post(`/finance/expense-bills/${eb.id}/submit`, {});
    await aapi('POST', `/finance/expense-bills/${eb.id}/approve`, {});
    await post(`/finance/expense-bills/${eb.id}/post`, {});
    docCount++;
  }
}

// ---------- bank statements ----------
for (let m = 0; m < 6; m++) {
  const inAmt = int(20000, 120000);
  const outAmt = int(15000, 90000);
  const st = await post('/finance/bank-statements', {
    company_id: company1, account_id: bankAcct.id,
    statement_date: monthDate(m, 28), opening_balance: '0',
    closing_balance: money(inAmt + outAmt),
    lines: [
      { value_date: monthDate(m, 10), description: 'customer receipts', amount: money(inAmt) },
      { value_date: monthDate(m, 20), description: 'supplier payments', amount: money(outAmt) },
    ],
  }, `demo-bs-${m}`);
  const stId = st.bank_statement?.id ?? st.id;
  await post(`/finance/bank-statements/${stId}/post`, {});
  docCount++;
}

console.log(`\nDONE. documents created: ~${docCount}`);
console.log('demo login: demo@atlas.test / Demo12345!');

}

main().catch(e => { console.error(e); process.exit(1); });
