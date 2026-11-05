import { Controller, Get, Param, Query, Req, Res, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PdfDocumentsService } from './pdf-documents.service';
import { Secured } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { z } from 'zod';

const reportQuery = z.object({
  company_id: z.string().uuid(),
  from: z.string().optional(),
  to: z.string().optional(),
  as_of: z.string().optional(),
});

@Controller()
export class PdfController {
  constructor(private readonly docs: PdfDocumentsService) {}

  private send(res: Response, buffer: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Secured('sales_invoice:view')
  @Get('sales/invoices/:id/pdf')
  async invoicePdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.salesInvoicePdf(req.orgContext!, id);
    this.send(res, buffer, filename);
  }

  @Secured('quotation:view')
  @Get('sales/quotations/:id/pdf')
  async quotationPdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.quotationPdf(req.orgContext!, id);
    this.send(res, buffer, filename);
  }

  @Secured('purchase_order:view')
  @Get('purchasing/orders/:id/pdf')
  async poPdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.purchaseOrderPdf(req.orgContext!, id);
    this.send(res, buffer, filename);
  }

  @Secured('supplier_bill:view')
  @Get('purchasing/bills/:id/pdf')
  async billPdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.supplierBillPdf(req.orgContext!, id);
    this.send(res, buffer, filename);
  }

  @Secured('report:export')
  @Get('reports/trial-balance/pdf')
  async tbPdf(@Query(new ZodValidationPipe(reportQuery)) q: any, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.trialBalancePdf(req.orgContext!, q.company_id, q.from, q.to);
    this.send(res, buffer, filename);
  }

  @Secured('report:export')
  @Get('reports/balance-sheet/pdf')
  async bsPdf(@Query(new ZodValidationPipe(reportQuery)) q: any, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.balanceSheetPdf(req.orgContext!, q.company_id, q.as_of);
    this.send(res, buffer, filename);
  }

  @Secured('report:export')
  @Get('reports/profit-loss/pdf')
  async plPdf(@Query(new ZodValidationPipe(reportQuery)) q: any, @Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.docs.profitLossPdf(req.orgContext!, q.company_id, q.from, q.to);
    this.send(res, buffer, filename);
  }
}
