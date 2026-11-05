import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrgContext } from '../common/request.types';
import { Errors } from '../common/errors';
import { toDecimal, moneyString, DecimalLike } from './money';

interface AccountMove {
  account_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  type: string; // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  total_debit: string;
  total_credit: string;
}

/**
 * Financial reports — every number is computed from POSTED journal lines
 * with decimal.js. Nothing is hardcoded.
 *
 * Balance sign convention (per ACCOUNTING_RULES.md):
 * - ASSET, EXPENSE → debit balance = debit − credit
 * - LIABILITY, EQUITY, REVENUE → credit balance = credit − debit
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async companyInScope(ctx: OrgContext, companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.organizationId !== ctx.organizationId) throw Errors.forbidden();
    return company;
  }

  private async currencyDecimals(code: string): Promise<number> {
    const cur = await this.prisma.currency.findUnique({ where: { code } });
    return cur?.decimals ?? 2;
  }

  /** Net posted movement per account in [from, to] (inclusive). Pass from=null for "from the beginning". */
  private async accountMovements(
    companyId: string,
    baseDecimals: number,
    from: string | null,
    to: string,
    accountId?: string,
  ): Promise<AccountMove[]> {
    void baseDecimals;
    let where = `e.company_id = '${companyId}'::uuid AND e.status = 'posted' AND e.posting_date <= '${to}'::date`;
    if (from) where += ` AND e.posting_date >= '${from}'::date`;
    if (accountId) where += ` AND a.id = '${accountId}'::uuid`;
    // companyId/from/to/accountId are UUID/date strings validated by zod; interpolated as literals.
    const rows = await this.prisma.$queryRawUnsafe<Array<AccountMove>>(`
      SELECT a.id AS account_id, a.code, a.name_ar, a.name_en, t.code AS type,
        COALESCE(SUM(l.debit), 0)::text AS total_debit,
        COALESCE(SUM(l.credit), 0)::text AS total_credit
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      JOIN account_types t ON t.id = a.account_type_id
      WHERE ${where}
      GROUP BY a.id, a.code, a.name_ar, a.name_en, t.code
      ORDER BY a.code
    `);
    return rows;
  }

  /** Signed balance of one movement row: + for the account's natural side. */
  private signedBalance(m: AccountMove): Decimal {
    const d = toDecimal(m.total_debit);
    const c = toDecimal(m.total_credit);
    return m.type === 'ASSET' || m.type === 'EXPENSE' ? d.minus(c) : c.minus(d);
  }

  // ---------- general ledger ----------

  async generalLedger(ctx: OrgContext, companyId: string, from: string, to: string, accountId?: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);

    const accounts = await this.prisma.account.findMany({
      where: { companyId, isActive: true, ...(accountId ? { id: accountId } : {}) },
      include: { type: true },
      orderBy: { code: 'asc' },
    });

    const book = [];
    for (const a of accounts) {
      const open = await this.prisma.$queryRaw<Array<{ d: string; c: string }>>`
        SELECT COALESCE(SUM(l.debit),0)::text AS d, COALESCE(SUM(l.credit),0)::text AS c
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.company_id = ${companyId}::uuid AND e.status = 'posted'
          AND l.account_id = ${a.id}::uuid AND e.posting_date < ${from}::date`;
      const openBal = this.signedOf(a.type.code, toDecimal(open[0]?.d ?? 0), toDecimal(open[0]?.c ?? 0));

      const lines = await this.prisma.journalLine.findMany({
        where: {
          accountId: a.id,
          entry: { companyId, status: 'posted', postingDate: { gte: new Date(from), lte: new Date(to) } },
        },
        include: { entry: true },
        orderBy: [{ entry: { postingDate: 'asc' } }, { entry: { createdAt: 'asc' } }],
      });

      let running = openBal;
      const dated = lines.map((l) => {
        running = running.plus(this.signedOf(a.type.code, toDecimal(l.debit), toDecimal(l.credit)));
        return {
          posting_date: l.entry.postingDate.toISOString().slice(0, 10),
          journal_id: l.journalEntryId,
          journal_type: l.entry.journalType,
          description: l.description,
          source_type: l.entry.sourceType,
          source_id: l.entry.sourceId,
          debit: moneyString(l.debit, dec),
          credit: moneyString(l.credit, dec),
          running_balance: running.toFixed(dec),
        };
      });

      const totD = lines.reduce((s, l) => s.plus(toDecimal(l.debit)), new Decimal(0));
      const totC = lines.reduce((s, l) => s.plus(toDecimal(l.credit)), new Decimal(0));
      book.push({
        account_id: a.id,
        code: a.code,
        name_ar: a.nameAr,
        name_en: a.nameEn,
        type: a.type.code,
        opening_balance: openBal.toFixed(dec),
        lines: dated,
        total_debit: totD.toFixed(dec),
        total_credit: totC.toFixed(dec),
        closing_balance: running.toFixed(dec),
      });
    }
    return { company_id: companyId, from, to, currency: company.baseCurrency, accounts: book };
  }

  private signedOf(type: string, debit: Decimal, credit: Decimal): Decimal {
    return type === 'ASSET' || type === 'EXPENSE' ? debit.minus(credit) : credit.minus(debit);
  }

  // ---------- balance sheet ----------

  async balanceSheet(ctx: OrgContext, companyId: string, asOf: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const moves = await this.accountMovements(companyId, dec, null, asOf);

    // Net profit for the period feeds retained earnings (3020) on the BS.
    const pl = await this.profitLossInternal(companyId, dec, null, asOf);
    const netProfit = toDecimal(pl.netProfit);

    const sections: Record<string, Array<{ code: string; name_ar: string; name_en: string; balance: string }>> = {
      assets: [], liabilities: [], equity: [],
    };
    const totals = { assets: new Decimal(0), liabilities: new Decimal(0), equity: new Decimal(0) };
    for (const m of moves) {
      const bal = this.signedBalance(m);
      if (bal.isZero()) continue;
      const key = m.type === 'ASSET' ? 'assets' : m.type === 'LIABILITY' ? 'liabilities' : 'equity';
      if (m.type !== 'ASSET' && m.type !== 'LIABILITY' && m.type !== 'EQUITY') continue;
      sections[key].push({ code: m.code, name_ar: m.name_ar, name_en: m.name_en, balance: bal.toFixed(dec) });
      totals[key] = totals[key].plus(bal);
    }
    // Current-year profit sits inside equity.
    if (!netProfit.isZero()) {
      sections.equity.push({ code: '', name_ar: 'صافي ربح الفترة', name_en: 'Net profit for the period', balance: netProfit.toFixed(dec) });
      totals.equity = totals.equity.plus(netProfit);
    }
    const balanced = totals.assets.eq(totals.liabilities.plus(totals.equity));
    return {
      company_id: companyId, as_of: asOf, currency: company.baseCurrency,
      assets: sections.assets, liabilities: sections.liabilities, equity: sections.equity,
      total_assets: totals.assets.toFixed(dec),
      total_liabilities: totals.liabilities.toFixed(dec),
      total_equity: totals.equity.toFixed(dec),
      balanced,
    };
  }

  // ---------- profit & loss ----------

  private async profitLossInternal(companyId: string, dec: number, from: string | null, to: string) {
    const moves = await this.accountMovements(companyId, dec, from, to);
    const sum = (t: string, codes?: string[]) =>
      moves.filter((m) => m.type === t && (!codes || codes.includes(m.code)))
        .reduce((s, m) => s.plus(this.signedBalance(m)), new Decimal(0));
    const revenue = sum('REVENUE');
    const cogs = sum('EXPENSE', ['5110']);
    const otherExpenses = sum('EXPENSE').minus(cogs);
    const grossProfit = revenue.minus(cogs);
    const netProfit = grossProfit.minus(otherExpenses);
    return { revenue, cogs, grossProfit, otherExpenses, netProfit, moves, dec };
  }

  async profitLoss(ctx: OrgContext, companyId: string, from: string, to: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const r = await this.profitLossInternal(companyId, dec, from, to);
    const expenseLines = r.moves
      .filter((m) => m.type === 'EXPENSE' && !this.signedBalance(m).isZero())
      .map((m) => ({ code: m.code, name_ar: m.name_ar, name_en: m.name_en, balance: this.signedBalance(m).toFixed(dec) }));
    const revenueLines = r.moves
      .filter((m) => m.type === 'REVENUE' && !this.signedBalance(m).isZero())
      .map((m) => ({ code: m.code, name_ar: m.name_ar, name_en: m.name_en, balance: this.signedBalance(m).toFixed(dec) }));
    return {
      company_id: companyId, from, to, currency: company.baseCurrency,
      revenue_lines: revenueLines,
      total_revenue: r.revenue.toFixed(dec),
      cogs: r.cogs.toFixed(dec),
      gross_profit: r.grossProfit.toFixed(dec),
      expense_lines: expenseLines,
      total_expenses: r.otherExpenses.plus(r.cogs).toFixed(dec),
      net_profit: r.netProfit.toFixed(dec),
    };
  }

  // ---------- cash flow (indirect method) ----------

  async cashFlow(ctx: OrgContext, companyId: string, from: string, to: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const pl = await this.profitLossInternal(companyId, dec, from, to);

    // Working-capital deltas over the period (closing − opening).
    const dayBefore = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const openRows = await this.accountMovements(companyId, dec, null, dayBefore);
    const closeRows = await this.accountMovements(companyId, dec, null, to);
    const obal = (codes: string[]) =>
      openRows.filter((m) => codes.includes(m.code))
        .reduce((s, m) => s.plus(this.signedBalance(m)), new Decimal(0));
    const cbal = (codes: string[]) =>
      closeRows.filter((m) => codes.includes(m.code))
        .reduce((s, m) => s.plus(this.signedBalance(m)), new Decimal(0));

    const dAR = cbal(['1210']).minus(obal(['1210']));
    const dInv = cbal(['1310']).minus(obal(['1310']));
    const dGRNI = cbal(['1320']).minus(obal(['1320']));
    const dInVAT = cbal(['1230']).minus(obal(['1230']));
    const dAP = cbal(['2110']).minus(obal(['2110']));
    const dOutVAT = cbal(['2120']).minus(obal(['2120']));
    const dCapital = cbal(['3010']).minus(obal(['3010']));

    const operating = pl.netProfit.minus(dAR).minus(dInv).minus(dGRNI).minus(dInVAT).plus(dAP).plus(dOutVAT);
    const investing = new Decimal(0); // no fixed-asset accounts in the seed CoA
    const financing = dCapital;
    const netChange = operating.plus(investing).plus(financing);

    const dCash = cbal(['1100', '1110']).minus(obal(['1100', '1110']));
    return {
      company_id: companyId, from, to, currency: company.baseCurrency,
      net_profit: pl.netProfit.toFixed(dec),
      adjustments: {
        change_in_receivables: dAR.neg().toFixed(dec),
        change_in_inventory: dInv.neg().toFixed(dec),
        change_in_grni: dGRNI.neg().toFixed(dec),
        change_in_input_vat: dInVAT.neg().toFixed(dec),
        change_in_payables: dAP.toFixed(dec),
        change_in_output_vat: dOutVAT.toFixed(dec),
      },
      operating_cash_flow: operating.toFixed(dec),
      investing_cash_flow: investing.toFixed(dec),
      financing_cash_flow: financing.toFixed(dec),
      net_change_in_cash: netChange.toFixed(dec),
      cash_movement_per_gl: dCash.toFixed(dec),
      reconciles: netChange.eq(dCash),
    };
  }

  // ---------- aging ----------

  private bucket(daysOverdue: number): string {
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 30) return 'd1_30';
    if (daysOverdue <= 60) return 'd31_60';
    if (daysOverdue <= 90) return 'd61_90';
    return 'd90_plus';
  }

  async arAging(ctx: OrgContext, companyId: string, asOf: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { companyId, status: { in: ['posted', 'partially_paid'] }, outstanding: { gt: 0 } },
      include: { customer: { include: { paymentTerm: true } } },
    });
    return this.agingReport(invoices.map((i) => ({
      id: i.id, number: i.number,
      party_id: i.customerId, party_name_ar: i.customer.nameAr, party_name_en: i.customer.nameEn,
      doc_date: i.invoiceDate, outstanding: i.outstanding,
      term_days: i.customer.paymentTerm?.days ?? 30,
    })), asOf, dec, companyId, company.baseCurrency);
  }

  async apAging(ctx: OrgContext, companyId: string, asOf: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const bills = await this.prisma.supplierBill.findMany({
      where: { companyId, status: { in: ['posted', 'partially_paid'] }, outstanding: { gt: 0 } },
      include: { supplier: { include: { paymentTerm: true } } },
    });
    return this.agingReport(bills.map((b) => ({
      id: b.id, number: b.number,
      party_id: b.supplierId, party_name_ar: b.supplier.nameAr, party_name_en: b.supplier.nameEn,
      doc_date: b.billDate, outstanding: b.outstanding,
      term_days: b.dueDate ? undefined : (b.supplier.paymentTerm?.days ?? 30),
      explicit_due: b.dueDate ?? undefined,
    })), asOf, dec, companyId, company.baseCurrency);
  }

  private agingReport(
    docs: Array<{
      id: string; number: string; party_id: string; party_name_ar: string; party_name_en: string;
      doc_date: Date; outstanding: DecimalLike; term_days?: number; explicit_due?: Date;
    }>,
    asOf: string, dec: number, companyId: string, currency: string,
  ) {
    const asOfDate = new Date(asOf);
    const buckets: Record<string, Decimal> = {
      current: new Decimal(0), d1_30: new Decimal(0), d31_60: new Decimal(0), d61_90: new Decimal(0), d90_plus: new Decimal(0),
    };
    const lines = docs.map((d) => {
      const due = d.explicit_due ?? new Date(d.doc_date.getTime() + (d.term_days ?? 30) * 86400000);
      const overdue = Math.floor((asOfDate.getTime() - due.getTime()) / 86400000);
      const b = this.bucket(overdue);
      const amt = toDecimal(d.outstanding);
      buckets[b] = buckets[b].plus(amt);
      return {
        id: d.id, number: d.number,
        party_id: d.party_id, party_name_ar: d.party_name_ar, party_name_en: d.party_name_en,
        doc_date: d.doc_date.toISOString().slice(0, 10),
        due_date: due.toISOString().slice(0, 10),
        days_overdue: overdue > 0 ? overdue : 0,
        bucket: b,
        outstanding: amt.toFixed(dec),
      };
    });
    const total = Object.values(buckets).reduce((s, v) => s.plus(v), new Decimal(0));
    return {
      company_id: companyId, as_of: asOf, currency,
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.toFixed(dec)])),
      total: total.toFixed(dec),
      lines,
    };
  }

  // ---------- VAT report ----------

  async vatReport(ctx: OrgContext, companyId: string, from: string, to: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const moves = await this.accountMovements(companyId, dec, from, to);
    const inVAT = moves.find((m) => m.code === '1230');
    const outVAT = moves.find((m) => m.code === '2120');
    // Input VAT is a debit-balance asset: claimable = net debits. Output VAT is credit-balance: payable = net credits.
    const inputClaimable = inVAT ? this.signedBalance(inVAT) : new Decimal(0);
    const outputPayable = outVAT ? this.signedBalance(outVAT) : new Decimal(0);
    const netPayable = outputPayable.minus(inputClaimable);
    return {
      company_id: companyId, from, to, currency: company.baseCurrency,
      input_vat_1230: inputClaimable.toFixed(dec),
      output_vat_2120: outputPayable.toFixed(dec),
      net_vat_payable: netPayable.toFixed(dec),
    };
  }

  // ---------- finance dashboard (formulas documented per metric) ----------

  async financeDashboard(ctx: OrgContext, companyId: string) {
    const company = await this.companyInScope(ctx, companyId);
    const dec = await this.currencyDecimals(company.baseCurrency);
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';
    const yearStart = today.slice(0, 4) + '-01-01';

    const mtd = await this.profitLossInternal(companyId, dec, monthStart, today);
    const ytd = await this.profitLossInternal(companyId, dec, yearStart, today);
    const closeRows = await this.accountMovements(companyId, dec, null, today);
    const bal = (codes: string[]) =>
      closeRows.filter((m) => codes.includes(m.code))
        .reduce((s, m) => s.plus(this.signedBalance(m)), new Decimal(0));

    const ar = await this.arAging(ctx, companyId, today);
    const ap = await this.apAging(ctx, companyId, today);
    const overdueAR = toDecimal(ar.buckets.d1_30).plus(toDecimal(ar.buckets.d31_60))
      .plus(toDecimal(ar.buckets.d61_90)).plus(toDecimal(ar.buckets.d90_plus));
    const overdueAP = toDecimal(ap.buckets.d1_30).plus(toDecimal(ap.buckets.d31_60))
      .plus(toDecimal(ap.buckets.d61_90)).plus(toDecimal(ap.buckets.d90_plus));

    const grossMargin = (pl: { revenue: Decimal; grossProfit: Decimal }) =>
      pl.revenue.isZero() ? '0.00' : pl.grossProfit.div(pl.revenue).mul(100).toFixed(2);

    return {
      company_id: companyId, as_of: today, currency: company.baseCurrency,
      // Formula: SUM(revenue accounts) over [monthStart, today] from posted journals.
      revenue_mtd: mtd.revenue.toFixed(dec),
      // Formula: SUM(revenue accounts) over [yearStart, today] from posted journals.
      revenue_ytd: ytd.revenue.toFixed(dec),
      // Formula: gross_profit / revenue * 100 (0 when revenue is 0).
      gross_margin_pct_mtd: grossMargin(mtd),
      gross_margin_pct_ytd: grossMargin(ytd),
      // Formula: SUM(outstanding) of posted/partially_paid sales invoices.
      ar_total: ar.total,
      // Formula: SUM(outstanding) of posted/partially_paid supplier bills.
      ap_total: ap.total,
      // Formula: signed balance of 1100 + 1110 (cash + bank) as of today.
      bank_balance: bal(['1100', '1110']).toFixed(dec),
      // Formula: AR buckets 1-30/31-60/61-90/90+ as of today.
      overdue_ar: overdueAR.toFixed(dec),
      // Formula: AP buckets 1-30/31-60/61-90/90+ as of today.
      overdue_ap: overdueAP.toFixed(dec),
      // Formula: revenue − COGS − other expenses (posted journals).
      net_profit_ytd: ytd.netProfit.toFixed(dec),
    };
  }
}
