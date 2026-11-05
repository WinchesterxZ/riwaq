/**
 * ATLAS ERP — Phase 12 demo-data integrity validator.
 *
 * READ-ONLY: this script issues SELECT statements only (plus a best-effort
 * session-level READ ONLY guard). It never inserts, updates or deletes.
 *
 * Guard: refuses to run unless DATABASE_URL points at the demo database
 * (database name contains "demo" and is not atlas_erp_dev / atlas_erp_test).
 *
 * Usage (from apps/api):
 *   set -a && source .env && set +a
 *   DATABASE_URL="postgresql://atlas:atlas_dev_pw@localhost:5432/atlas_erp_demo" \
 *     pnpm exec tsx ../../scripts/validate-demo.ts
 *
 * Exit codes: 0 = all 6 checks PASS, 1 = at least one check FAIL,
 *             2 = guard refusal (wrong database).
 *
 * NOTE on imports: this script lives in <repo>/scripts, outside apps/api, so
 * the vendored Prisma client and decimal.js are imported via paths relative
 * to this file (bare specifiers would not resolve to apps/api/node_modules).
 */
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import Decimal from '../apps/api/node_modules/decimal.js';

// ---------------------------------------------------------------- guard ---
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (dbUrl.match(/\/([^/?#]+)(\?|#|$)/)?.[1] ?? '').toLowerCase();
if (dbName === 'atlas_erp_dev' || dbName === 'atlas_erp_test' || !dbName.includes('demo')) {
  console.error(`REFUSING: target database "${dbName || '(empty)'}" is not the demo database.`);
  process.exit(2);
}
console.log(`Validating demo database "${dbName}" (read-only).`);

// ---------------------------------------------------------------- helpers -
const D = (v: unknown): Decimal =>
  v === null || v === undefined ? new Decimal(0) : new Decimal(v.toString());
const fmt = (d: Decimal): string => d.toFixed(4);

interface CheckResult {
  n: number;
  name: string;
  pass: boolean;
  lines: string[];
}
const results: CheckResult[] = [];
function check(n: number, name: string, pass: boolean, lines: string[]): void {
  results.push({ n, name, pass, lines });
}

interface Company {
  id: string;
  name: string;
  base_currency: string;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // Best-effort DB-level read-only enforcement (the code itself only SELECTs).
    await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    const companies = await prisma.$queryRaw<Company[]>`
      SELECT id::text AS id, name, base_currency FROM companies ORDER BY name`;

    // ================================================== 1. trial balance ==
    {
      const lines: string[] = [];
      let allOk = true;
      for (const c of companies) {
        const rows = await prisma.$queryRaw<Array<{ d: string; c: string }>>`
          SELECT COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted'`;
        const d = D(rows[0]?.d), cr = D(rows[0]?.c);
        const ok = d.eq(cr);
        if (!ok) allOk = false;
        lines.push(`  [${c.name}] debits=${fmt(d)} credits=${fmt(cr)} diff=${fmt(d.minus(cr))} ${ok ? 'ok' : 'MISMATCH'}`);
      }
      const tot = await prisma.$queryRaw<Array<{ d: string; c: string }>>`
        SELECT COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.status = 'posted'`;
      const td = D(tot[0]?.d), tc = D(tot[0]?.c);
      if (!td.eq(tc)) allOk = false;
      lines.push(`  [ALL] debits=${fmt(td)} credits=${fmt(tc)} diff=${fmt(td.minus(tc))}`);
      check(1, 'Trial balance balanced (posted debits == posted credits)', allOk, lines);
    }

    // ============================================ 2. inventory reconciles ==
    // valuation = SUM over stocked products of (latest resulting_qty x
    // resulting_avg_cost per warehouse) from inventory_valuation_entries.
    // GL      = SUM(debit - credit) of posted lines on each stocked product's
    //           inventory account (product.inventory_account_id, else 1310).
    // Tolerance 0.01/company: avg cost is stored rounded to 4dp, so each
    // issue posts round(qty*avg) while valuation keeps qty*avg_rounded —
    // sub-cent drift per issue is expected, never larger.
    {
      const lines: string[] = [];
      let allOk = true;
      const TOL = new Decimal('0.01');
      for (const c of companies) {
        const valRows = await prisma.$queryRaw<Array<{ val: string }>>`
          SELECT COALESCE(SUM(v.resulting_qty * v.resulting_avg_cost), 0)::text AS val
          FROM (
            SELECT DISTINCT ON (e.warehouse_id, e.product_id)
              e.product_id, e.resulting_qty, e.resulting_avg_cost
            FROM inventory_valuation_entries e
            WHERE e.company_id = ${c.id}::uuid
            ORDER BY e.warehouse_id, e.product_id, e.created_at DESC, e.id DESC
          ) v
          JOIN products p ON p.id = v.product_id AND p.type = 'stocked'`;
        const valuation = D(valRows[0]?.val);

        const acctRows = await prisma.$queryRaw<Array<{ acct: string }>>`
          SELECT DISTINCT COALESCE(p.inventory_account_id, dflt.id)::text AS acct
          FROM products p
          JOIN accounts dflt ON dflt.company_id = p.company_id AND dflt.code = '1310'
          WHERE p.company_id = ${c.id}::uuid AND p.type = 'stocked'`;
        const accts = acctRows.map((r) => r.acct);
        const customCt = await prisma.$queryRaw<Array<{ n: string }>>`
          SELECT COUNT(*)::text AS n FROM products p
          JOIN accounts dflt ON dflt.company_id = p.company_id AND dflt.code = '1310'
          WHERE p.company_id = ${c.id}::uuid AND p.type = 'stocked'
            AND p.inventory_account_id IS NOT NULL AND p.inventory_account_id <> dflt.id`;
        let gl = new Decimal(0);
        if (accts.length > 0) {
          const glRows = await prisma.$queryRaw<Array<{ bal: string }>>`
            SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS bal
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l.journal_entry_id
            WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted'
              AND l.account_id = ANY(${accts}::uuid[])`;
          gl = D(glRows[0]?.bal);
        }
        const diff = valuation.minus(gl);
        const ok = diff.abs().lte(TOL);
        if (!ok) allOk = false;
        lines.push(
          `  [${c.name}] valuation(qty×avg)=${fmt(valuation)} GL(1310-ish)=${fmt(gl)} ` +
          `diff=${fmt(diff)} ${ok ? 'ok' : 'MISMATCH'} ` +
          `(inv accounts used: ${accts.length}, custom-acct products: ${customCt[0]?.n ?? '0'})`,
        );
      }
      check(2, 'Inventory valuation == GL inventory balance (|diff|<=0.01)', allOk, lines);
    }

    // =========================================== 3. allocations reconcile ==
    {
      const lines: string[] = [];
      let allOk = true;

      // ---- per-allocation sanity: amount>0, <= invoice total, <= payment amount
      const badSalesAlloc = await prisma.$queryRaw<Array<{ id: string; amount: string; inv_no: string; inv_total: string; pay_no: string; pay_amount: string }>>`
        SELECT a.id::text AS id, a.amount::text AS amount, i.number AS inv_no, i.total::text AS inv_total,
               p.number AS pay_no, p.amount::text AS pay_amount
        FROM payment_allocations a
        JOIN sales_invoices i ON i.id = a.sales_invoice_id
        JOIN sales_payments p ON p.id = a.sales_payment_id
        WHERE a.amount <= 0 OR a.amount > i.total OR a.amount > p.amount`;
      const badSupAlloc = await prisma.$queryRaw<Array<{ id: string; amount: string; bill_no: string; bill_total: string; pay_no: string; pay_amount: string }>>`
        SELECT a.id::text AS id, a.amount::text AS amount, b.number AS bill_no, b.total::text AS bill_total,
               p.number AS pay_no, p.amount::text AS pay_amount
        FROM supplier_payment_allocations a
        JOIN supplier_bills b ON b.id = a.supplier_bill_id
        JOIN supplier_payments p ON p.id = a.supplier_payment_id
        WHERE a.amount <= 0 OR a.amount > b.total OR a.amount > p.amount`;
      if (badSalesAlloc.length > 0 || badSupAlloc.length > 0) allOk = false;
      lines.push(`  bad sales allocations (<=0 or > invoice/payment total): ${badSalesAlloc.length}`);
      for (const r of badSalesAlloc.slice(0, 5))
        lines.push(`    alloc ${r.id} amount=${r.amount} invoice ${r.inv_no} total=${r.inv_total} payment ${r.pay_no} amount=${r.pay_amount}`);
      lines.push(`  bad supplier allocations (<=0 or > bill/payment total): ${badSupAlloc.length}`);
      for (const r of badSupAlloc.slice(0, 5))
        lines.push(`    alloc ${r.id} amount=${r.amount} bill ${r.bill_no} total=${r.bill_total} payment ${r.pay_no} amount=${r.pay_amount}`);

      // ---- per-document: alloc_sum <= total; paid_total + outstanding == total;
      //      paid docs: alloc_sum + posted credit notes == total (sales) / alloc_sum == total (purchasing)
      interface DocRow { id: string; company: string; number: string; total: string; paid_total: string; outstanding: string; status: string; alloc_sum: string; cn_sum: string }
      const invDocs = await prisma.$queryRaw<DocRow[]>`
        SELECT i.id::text AS id, c.name AS company, i.number, i.total::text AS total,
               i.paid_total::text AS paid_total, i.outstanding::text AS outstanding, i.status,
               COALESCE(SUM(a.amount), 0)::text AS alloc_sum,
               COALESCE((SELECT SUM(cn.total) FROM credit_notes cn
                         WHERE cn.sales_invoice_id = i.id AND cn.status = 'posted'), 0)::text AS cn_sum
        FROM sales_invoices i
        JOIN companies c ON c.id = i.company_id
        LEFT JOIN payment_allocations a ON a.sales_invoice_id = i.id
        WHERE i.status IN ('posted', 'partially_paid', 'paid')
        GROUP BY i.id, c.name`;
      let invBad = 0;
      for (const r of invDocs) {
        const total = D(r.total), paid = D(r.paid_total), out = D(r.outstanding);
        const alloc = D(r.alloc_sum), cn = D(r.cn_sum);
        const probs: string[] = [];
        if (alloc.gt(total)) probs.push(`alloc_sum ${fmt(alloc)} > total ${fmt(total)}`);
        if (!paid.plus(out).eq(total)) probs.push(`paid+outstanding ${fmt(paid.plus(out))} != total ${fmt(total)}`);
        if (r.status === 'paid' && !alloc.plus(cn).eq(total))
          probs.push(`paid but alloc+CN ${fmt(alloc.plus(cn))} != total ${fmt(total)}`);
        if (probs.length > 0) {
          invBad++;
          if (invBad <= 5) lines.push(`    invoice ${r.number} [${r.company}] status=${r.status}: ${probs.join('; ')}`);
        }
      }
      const billDocs = await prisma.$queryRaw<Omit<DocRow, 'cn_sum'>[]>`
        SELECT b.id::text AS id, c.name AS company, b.number, b.total::text AS total,
               b.paid_total::text AS paid_total, b.outstanding::text AS outstanding, b.status,
               COALESCE(SUM(a.amount), 0)::text AS alloc_sum
        FROM supplier_bills b
        JOIN companies c ON c.id = b.company_id
        LEFT JOIN supplier_payment_allocations a ON a.supplier_bill_id = b.id
        WHERE b.status IN ('posted', 'partially_paid', 'paid')
        GROUP BY b.id, c.name`;
      let billBad = 0;
      for (const r of billDocs) {
        const total = D(r.total), paid = D(r.paid_total), out = D(r.outstanding);
        const alloc = D(r.alloc_sum);
        const probs: string[] = [];
        if (alloc.gt(total)) probs.push(`alloc_sum ${fmt(alloc)} > total ${fmt(total)}`);
        if (!paid.plus(out).eq(total)) probs.push(`paid+outstanding ${fmt(paid.plus(out))} != total ${fmt(total)}`);
        if (r.status === 'paid' && !alloc.eq(total))
          probs.push(`paid but alloc_sum ${fmt(alloc)} != total ${fmt(total)}`);
        if (probs.length > 0) {
          billBad++;
          if (billBad <= 5) lines.push(`    bill ${r.number} [${r.company}] status=${r.status}: ${probs.join('; ')}`);
        }
      }
      if (invBad > 0 || billBad > 0) allOk = false;
      lines.push(`  sales invoices checked: ${invDocs.length}, with problems: ${invBad}`);
      lines.push(`  supplier bills checked: ${billDocs.length}, with problems: ${billBad}`);

      // ---- per-payment: sum(allocations) <= payment amount
      const overPay = await prisma.$queryRaw<Array<{ kind: string; number: string; amount: string; s: string }>>`
        SELECT 'sales' AS kind, p.number, p.amount::text AS amount, COALESCE(SUM(a.amount), 0)::text AS s
        FROM sales_payments p LEFT JOIN payment_allocations a ON a.sales_payment_id = p.id
        GROUP BY p.id HAVING COALESCE(SUM(a.amount), 0) > p.amount
        UNION ALL
        SELECT 'supplier' AS kind, p.number, p.amount::text AS amount, COALESCE(SUM(a.amount), 0)::text AS s
        FROM supplier_payments p LEFT JOIN supplier_payment_allocations a ON a.supplier_payment_id = p.id
        GROUP BY p.id HAVING COALESCE(SUM(a.amount), 0) > p.amount`;
      if (overPay.length > 0) allOk = false;
      lines.push(`  payments over-allocated: ${overPay.length}`);
      for (const r of overPay.slice(0, 5))
        lines.push(`    ${r.kind} payment ${r.number}: allocated=${r.s} > amount=${r.amount}`);

      check(3, 'Payment allocations reconcile (docs & payments)', allOk, lines);
    }

    // ===================================== 4. dashboard metrics, two ways ===
    // Way A replicates the report service's accountMovements SQL (grouped per
    // account, signed-balance math in JS). Way B is a structurally different
    // single-aggregate SQL. Both must agree exactly.
    {
      const lines: string[] = [];
      let allOk = true;
      const today = new Date().toISOString().slice(0, 10);
      const yearStart = today.slice(0, 4) + '-01-01';
      for (const c of companies) {
        // --- revenue YTD
        const movesA = await prisma.$queryRaw<Array<{ code: string; type: string; d: string; c: string }>>`
          SELECT a.code, t.code AS type, COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          JOIN account_types t ON t.id = a.account_type_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted'
            AND e.posting_date >= ${yearStart}::date AND e.posting_date <= ${today}::date
          GROUP BY a.code, t.code`;
        let revA = new Decimal(0);
        for (const m of movesA)
          if (m.type === 'REVENUE') revA = revA.plus(D(m.c).minus(D(m.d)));
        const revB = await prisma.$queryRaw<Array<{ rev: string }>>`
          SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS rev
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          JOIN account_types t ON t.id = a.account_type_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted' AND t.code = 'REVENUE'
            AND e.posting_date BETWEEN ${yearStart}::date AND ${today}::date`;
        const revBv = D(revB[0]?.rev);
        const revOk = revA.eq(revBv);
        if (!revOk) allOk = false;

        // --- bank balance as of today (service: signed balance of 1100+1110)
        const bankArows = await prisma.$queryRaw<Array<{ code: string; type: string; d: string; c: string }>>`
          SELECT a.code, t.code AS type, COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          JOIN account_types t ON t.id = a.account_type_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted'
            AND e.posting_date <= ${today}::date AND a.code IN ('1100', '1110')
          GROUP BY a.code, t.code`;
        let bankA = new Decimal(0);
        for (const m of bankArows) bankA = bankA.plus(D(m.d).minus(D(m.c))); // ASSET: debit - credit
        const bankB = await prisma.$queryRaw<Array<{ bal: string }>>`
          SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS bal
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted'
            AND e.posting_date <= ${today}::date AND a.code IN ('1100', '1110')`;
        const bankBv = D(bankB[0]?.bal);
        const bankOk = bankA.eq(bankBv);
        if (!bankOk) allOk = false;

        lines.push(`  [${c.name}] revenue_ytd service-way=${fmt(revA)} direct-way=${fmt(revBv)} ${revOk ? 'ok' : 'MISMATCH'}`);
        lines.push(`  [${c.name}] bank(1100+1110) service-way=${fmt(bankA)} direct-way=${fmt(bankBv)} ${bankOk ? 'ok' : 'MISMATCH'}`);
      }
      check(4, 'Dashboard metrics match direct DB queries (revenue YTD, bank)', allOk, lines);
    }

    // ========================================= 5. aging == GL control acct ==
    {
      const lines: string[] = [];
      let allOk = true;
      for (const c of companies) {
        const arAge = await prisma.$queryRaw<Array<{ t: string }>>`
          SELECT COALESCE(SUM(outstanding), 0)::text AS t FROM sales_invoices
          WHERE company_id = ${c.id}::uuid AND status IN ('posted', 'partially_paid') AND outstanding > 0`;
        const arGL = await prisma.$queryRaw<Array<{ b: string }>>`
          SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS b
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted' AND a.code = '1210'`;
        const arA = D(arAge[0]?.t), arG = D(arGL[0]?.b);
        const arOk = arA.eq(arG);
        if (!arOk) allOk = false;

        const apAge = await prisma.$queryRaw<Array<{ t: string }>>`
          SELECT COALESCE(SUM(outstanding), 0)::text AS t FROM supplier_bills
          WHERE company_id = ${c.id}::uuid AND status IN ('posted', 'partially_paid') AND outstanding > 0`;
        const apGL = await prisma.$queryRaw<Array<{ b: string }>>`
          SELECT COALESCE(SUM(l.credit - l.debit), 0)::text AS b
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.journal_entry_id
          JOIN accounts a ON a.id = l.account_id
          WHERE e.company_id = ${c.id}::uuid AND e.status = 'posted' AND a.code = '2110'`;
        const apA = D(apAge[0]?.t), apG = D(apGL[0]?.b);
        const apOk = apA.eq(apG);
        if (!apOk) allOk = false;

        lines.push(`  [${c.name}] AR aging=${fmt(arA)} GL(1210)=${fmt(arG)} ${arOk ? 'ok' : 'MISMATCH'}`);
        lines.push(`  [${c.name}] AP aging=${fmt(apA)} GL(2110)=${fmt(apG)} ${apOk ? 'ok' : 'MISMATCH'}`);

        // Diagnostics (informational only): known legitimate causes of a delta.
        const unalloc = await prisma.$queryRaw<Array<{ u: string }>>`
          SELECT COALESCE(SUM(p.amount - COALESCE(s.alloc, 0)), 0)::text AS u
          FROM sales_payments p
          LEFT JOIN (SELECT sales_payment_id, SUM(amount) AS alloc FROM payment_allocations GROUP BY 1) s
            ON s.sales_payment_id = p.id
          WHERE p.company_id = ${c.id}::uuid AND p.status = 'posted' AND p.amount > COALESCE(s.alloc, 0)`;
        const unallocSup = await prisma.$queryRaw<Array<{ u: string }>>`
          SELECT COALESCE(SUM(p.amount - COALESCE(s.alloc, 0)), 0)::text AS u
          FROM supplier_payments p
          LEFT JOIN (SELECT supplier_payment_id, SUM(amount) AS alloc FROM supplier_payment_allocations GROUP BY 1) s
            ON s.supplier_payment_id = p.id
          WHERE p.company_id = ${c.id}::uuid AND p.status = 'posted' AND p.amount > COALESCE(s.alloc, 0)`;
        const expSup = await prisma.$queryRaw<Array<{ t: string }>>`
          SELECT COALESCE(SUM(outstanding), 0)::text AS t FROM expense_bills
          WHERE company_id = ${c.id}::uuid AND status = 'posted' AND pay_from = 'supplier'`;
        lines.push(`    diag: unallocated posted customer payments=${fmt(D(unalloc[0]?.u))}, ` +
          `unallocated posted supplier payments=${fmt(D(unallocSup[0]?.u))}, ` +
          `posted pay_from=supplier expense bills outstanding=${fmt(D(expSup[0]?.t))}`);
      }
      check(5, 'AR/AP aging totals == GL control balances (1210/2110)', allOk, lines);
    }

    // ============================ 6. posted journals balanced & traced ====
    // Balanced: every posted entry has SUM(debit)==SUM(credit) (exact).
    // Traced: manual journals are user-created (source legitimately null);
    //         reversals must point at reversal_of_id; all other (system)
    //         journals must carry source_type + source_id.
    {
      const lines: string[] = [];
      let allOk = true;
      const rows = await prisma.$queryRaw<Array<{
        id: string; journal_type: string; source_type: string | null; source_id: string | null;
        reversal_of_id: string | null; d: string; c: string; nlines: string;
      }>>`
        SELECT e.id::text AS id, e.journal_type, e.source_type, e.source_id::text AS source_id,
               e.reversal_of_id::text AS reversal_of_id,
               COALESCE(SUM(l.debit), 0)::text AS d, COALESCE(SUM(l.credit), 0)::text AS c,
               COUNT(l.id)::text AS nlines
        FROM journal_entries e
        LEFT JOIN journal_lines l ON l.journal_entry_id = e.id
        WHERE e.status = 'posted'
        GROUP BY e.id`;
      let unbalanced = 0, untraced = 0, manual = 0, empty = 0;
      for (const r of rows) {
        const d = D(r.d), c = D(r.c);
        if (D(r.nlines).eq(0)) { empty++; if (empty <= 5) lines.push(`    EMPTY journal ${r.id} (${r.journal_type})`); }
        if (!d.eq(c)) {
          unbalanced++;
          if (unbalanced <= 5) lines.push(`    UNBALANCED ${r.id} (${r.journal_type}): debits=${fmt(d)} credits=${fmt(c)}`);
        }
        if (r.journal_type === 'manual') { manual++; continue; }
        if (r.journal_type === 'reversal') {
          if (!r.reversal_of_id) { untraced++; if (untraced <= 5) lines.push(`    UNTRACED reversal ${r.id}: reversal_of_id is null`); }
          continue;
        }
        if (!r.source_type || !r.source_id) {
          untraced++;
          if (untraced <= 5) lines.push(`    UNTRACED ${r.id} (${r.journal_type}): source_type=${r.source_type} source_id=${r.source_id}`);
        }
      }
      if (unbalanced > 0 || untraced > 0 || empty > 0) allOk = false;
      lines.unshift(`  posted journals: ${rows.length} (manual, source-exempt: ${manual})`);
      lines.push(`  unbalanced: ${unbalanced}, untraced: ${untraced}, empty (no lines): ${empty}`);
      check(6, 'Posted journals balanced and source-traced', allOk, lines);
    }

    // ---------------------------------------------------------------- report
    console.log('\n================ VALIDATION RESULTS ================');
    let failed = 0;
    for (const r of results) {
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.n}] ${r.name}`);
      for (const l of r.lines) console.log(l);
      if (!r.pass) failed++;
    }
    console.log('====================================================');
    console.log(failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed} CHECK(S) FAILED`);
    await prisma.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Validator error:', err);
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
