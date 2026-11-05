import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService, PdfDocSpec } from './pdf.service';
import { SalesService } from '../sales/sales.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { ReportsService } from '../accounting/reports.service';
import { AccountingService } from '../accounting/accounting.service';
import { OrgContext } from '../common/request.types';
import { Errors } from '../common/errors';

@Injectable()
export class PdfDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly sales: SalesService,
    private readonly purchasing: PurchasingService,
    private readonly reports: ReportsService,
    private readonly accounting: AccountingService,
  ) {}

  private async companyHeader(companyId: string) {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return { ar: c.nameAr, en: c.name };
  }

  private lineRows(lines: any[]): string[][] {
    return lines.map((l, i) => [
      String(i + 1),
      l.description || l.product?.nameAr || '',
      Number(l.quantity).toFixed(2),
      Number(l.unit_price ?? l.unitPrice ?? 0).toFixed(2),
      Number(l.line_total ?? l.lineTotal ?? 0).toFixed(2),
    ]);
  }

  private lineTable(headersAr: string[], rows: string[][]) {
    return {
      headers: headersAr,
      widths: [0.08, 0.42, 0.14, 0.18, 0.18],
      rows,
    };
  }

  async salesInvoicePdf(ctx: OrgContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.sales.getSalesInvoice(ctx, id);
    const co = await this.companyHeader(invoice.company_id);
    const spec: PdfDocSpec = {
      titleAr: 'فاتورة مبيعات', titleEn: 'Sales Invoice',
      companyAr: co.ar, companyEn: co.en,
      meta: [
        ['رقم الفاتورة / Invoice No', invoice.number],
        ['التاريخ / Date', invoice.invoice_date],
        ['العميل / Customer', `${invoice.customer?.nameAr ?? ''} (${invoice.customer?.number ?? ''})`],
        ['الحالة / Status', invoice.status],
        ['العملة / Currency', invoice.currency],
      ],
      tables: [this.lineTable(
        ['م', 'البيان / Description', 'الكمية / Qty', 'السعر / Price', 'الإجمالي / Total'],
        this.lineRows(invoice.lines),
      )],
      totals: [
        ['الإجمالي الفرعي / Subtotal', Number(invoice.subtotal).toFixed(2)],
        ['الضريبة / Tax', Number(invoice.tax_total).toFixed(2)],
        ['الإجمالي / Total', Number(invoice.total).toFixed(2)],
      ],
    };
    return { buffer: await this.pdf.render(spec), filename: `${invoice.number}.pdf` };
  }

  async quotationPdf(ctx: OrgContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const quotation: any = await this.sales.getQuotation(ctx, id);
    const co = await this.companyHeader(quotation.company_id);
    const spec: PdfDocSpec = {
      titleAr: 'عرض سعر', titleEn: 'Quotation',
      companyAr: co.ar, companyEn: co.en,
      meta: [
        ['رقم العرض / Quotation No', quotation.number],
        ['التاريخ / Date', (quotation.created_at ?? '').slice(0, 10)],
        ['صالح حتى / Valid until', quotation.valid_until ?? ''],
        ['العميل / Customer', `${quotation.customer?.nameAr ?? ''}`],
        ['الحالة / Status', quotation.status],
      ],
      tables: [this.lineTable(
        ['م', 'البيان / Description', 'الكمية / Qty', 'السعر / Price', 'الإجمالي / Total'],
        this.lineRows(quotation.lines ?? []),
      )],
      totals: [['الإجمالي / Total', Number(quotation.total ?? 0).toFixed(2)]],
    };
    return { buffer: await this.pdf.render(spec), filename: `${quotation.number}.pdf` };
  }

  async purchaseOrderPdf(ctx: OrgContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const purchase_order: any = await this.purchasing.getPurchaseOrder(ctx, id);
    const co = await this.companyHeader(purchase_order.company_id);
    const spec: PdfDocSpec = {
      titleAr: 'أمر شراء', titleEn: 'Purchase Order',
      companyAr: co.ar, companyEn: co.en,
      meta: [
        ['رقم الأمر / PO No', purchase_order.number],
        ['التاريخ / Date', (purchase_order.created_at ?? '').slice(0, 10)],
        ['المورد / Supplier', `${purchase_order.supplier?.nameAr ?? ''}`],
        ['الحالة / Status', purchase_order.status],
      ],
      tables: [this.lineTable(
        ['م', 'البيان / Description', 'الكمية / Qty', 'السعر / Price', 'الإجمالي / Total'],
        this.lineRows(purchase_order.lines ?? []),
      )],
      totals: [['الإجمالي / Total', Number(purchase_order.total ?? 0).toFixed(2)]],
    };
    return { buffer: await this.pdf.render(spec), filename: `${purchase_order.number}.pdf` };
  }

  async supplierBillPdf(ctx: OrgContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const supplier_bill: any = await this.purchasing.getSupplierBill(ctx, id);
    const co = await this.companyHeader(supplier_bill.company_id);
    const spec: PdfDocSpec = {
      titleAr: 'فاتورة مورد', titleEn: 'Supplier Bill',
      companyAr: co.ar, companyEn: co.en,
      meta: [
        ['رقم الفاتورة / Bill No', supplier_bill.number],
        ['التاريخ / Date', supplier_bill.bill_date ?? (supplier_bill.created_at ?? '').slice(0, 10)],
        ['المورد / Supplier', `${supplier_bill.supplier?.nameAr ?? ''}`],
        ['الحالة / Status', supplier_bill.status],
      ],
      tables: [this.lineTable(
        ['م', 'البيان / Description', 'الكمية / Qty', 'السعر / Price', 'الإجمالي / Total'],
        this.lineRows(supplier_bill.lines ?? []),
      )],
      totals: [
        ['الإجمالي الفرعي / Subtotal', Number(supplier_bill.subtotal ?? 0).toFixed(2)],
        ['الضريبة / Tax', Number(supplier_bill.tax_total ?? 0).toFixed(2)],
        ['الإجمالي / Total', Number(supplier_bill.total ?? 0).toFixed(2)],
      ],
    };
    return { buffer: await this.pdf.render(spec), filename: `${supplier_bill.number}.pdf` };
  }

  async trialBalancePdf(ctx: OrgContext, companyId: string, from: string, to: string) {
    const tb: any = await this.accounting.trialBalance(ctx, companyId, from, to);
    const co = await this.companyHeader(companyId);
    const rows = (tb.lines ?? []).map((l: any) => [
      l.code, l.name_ar, Number(l.total_debit ?? 0).toFixed(2), Number(l.total_credit ?? 0).toFixed(2),
    ]);
    const spec: PdfDocSpec = {
      titleAr: 'ميزان المراجعة', titleEn: 'Trial Balance',
      companyAr: co.ar, companyEn: co.en,
      meta: [['الفترة / Period', `${from} — ${to}`], ['العملة / Currency', tb.currency ?? '']],
      tables: [{
        headers: ['الكود / Code', 'الحساب / Account', 'مدين / Debit', 'دائن / Credit'],
        widths: [0.15, 0.45, 0.2, 0.2],
        rows,
      }],
      totals: [
        ['إجمالي المدين / Total debit', Number(tb.total_debit ?? 0).toFixed(2)],
        ['إجمالي الدائن / Total credit', Number(tb.total_credit ?? 0).toFixed(2)],
      ],
    };
    return { buffer: await this.pdf.render(spec), filename: `trial-balance-${from}-${to}.pdf` };
  }

  async balanceSheetPdf(ctx: OrgContext, companyId: string, asOf: string) {
    const bs: any = await this.reports.balanceSheet(ctx, companyId, asOf);
    const co = await this.companyHeader(companyId);
    const sec = (titleAr: string, titleEn: string, lines: any[]) => ({
      headers: [`${titleAr} / ${titleEn}`, 'الرصيد / Balance'],
      widths: [0.7, 0.3],
      rows: (lines ?? []).map((l: any) => [`${l.code} — ${l.name_ar}`, Number(l.balance ?? 0).toFixed(2)]),
    });
    const spec: PdfDocSpec = {
      titleAr: 'الميزانية العمومية', titleEn: 'Balance Sheet',
      companyAr: co.ar, companyEn: co.en,
      meta: [['بتاريخ / As of', asOf]],
      tables: [
        sec('الأصول', 'Assets', bs.assets),
        sec('الخصوم', 'Liabilities', bs.liabilities),
        sec('حقوق الملكية', 'Equity', bs.equity),
      ],
      totals: [
        ['إجمالي الأصول / Total assets', Number(bs.total_assets ?? 0).toFixed(2)],
        ['إجمالي الخصوم وحقوق الملكية / Total L+E', Number(bs.total_liabilities_equity ?? 0).toFixed(2)],
      ],
    };
    return { buffer: await this.pdf.render(spec), filename: `balance-sheet-${asOf}.pdf` };
  }

  async profitLossPdf(ctx: OrgContext, companyId: string, from: string, to: string) {
    const pl: any = await this.reports.profitLoss(ctx, companyId, from, to);
    const co = await this.companyHeader(companyId);
    const spec: PdfDocSpec = {
      titleAr: 'قائمة الأرباح والخسائر', titleEn: 'Profit & Loss',
      companyAr: co.ar, companyEn: co.en,
      meta: [['الفترة / Period', `${from} — ${to}`]],
      tables: [{
        headers: ['البند / Item', 'المبلغ / Amount'],
        widths: [0.7, 0.3],
        rows: [
          ['إجمالي الإيرادات / Total revenue', Number(pl.total_revenue ?? 0).toFixed(2)],
          ['تكلفة البضاعة المباعة / COGS', Number(pl.cogs ?? 0).toFixed(2)],
          ['مجمل الربح / Gross profit', Number(pl.gross_profit ?? 0).toFixed(2)],
          ['إجمالي المصروفات / Total expenses', Number(pl.total_expenses ?? 0).toFixed(2)],
          ['صافي الربح / Net profit', Number(pl.net_profit ?? 0).toFixed(2)],
        ],
      }],
    };
    return { buffer: await this.pdf.render(spec), filename: `profit-loss-${from}-${to}.pdf` };
  }
}
