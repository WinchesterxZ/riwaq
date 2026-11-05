import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  quotationCreateSchema, quotationUpdateSchema, quotationListQuerySchema,
  salesOrderCreateSchema, salesOrderListQuerySchema,
  deliveryCreateSchema, deliveryListQuerySchema,
  salesInvoiceCreateSchema, salesInvoiceListQuerySchema,
  salesPaymentCreateSchema, salesPaymentListQuerySchema,
  creditNoteCreateSchema, creditNoteListQuerySchema,
} from '@atlas-erp/contracts';

const idemFrom = (req: Request, body?: { idempotency_key?: string }) =>
  (req.headers['idempotency-key'] as string | undefined) ?? body?.idempotency_key;

const ipOf = (req: Request) => req.ip;

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // ---------- quotations ----------

  @Post('quotations')
  @Secured('quotation:create')
  @Idempotent()
  createQuotation(@Body(new ZodValidationPipe(quotationCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createQuotation(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('quotations')
  @Secured('quotation:view')
  listQuotations(@Query(new ZodValidationPipe(quotationListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listQuotations(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('quotations/:id')
  @Secured('quotation:view')
  getQuotation(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getQuotation(req.orgContext!, id);
  }

  @Patch('quotations/:id')
  @Secured('quotation:edit')
  updateQuotation(@Param('id') id: string, @Body(new ZodValidationPipe(quotationUpdateSchema)) body: never, @Req() req: Request) {
    return this.sales.updateQuotation(req.orgContext!, id, body as never, req.user!.id, ipOf(req));
  }

  @Post('quotations/:id/send')
  @Secured('quotation:submit')
  sendQuotation(@Param('id') id: string, @Req() req: Request) {
    return this.sales.transitionQuotation(req.orgContext!, id, 'send', req.user!.id, ipOf(req));
  }

  @Post('quotations/:id/withdraw')
  @Secured('quotation:submit')
  withdrawQuotation(@Param('id') id: string, @Req() req: Request) {
    return this.sales.transitionQuotation(req.orgContext!, id, 'withdraw', req.user!.id, ipOf(req));
  }

  @Post('quotations/:id/reject')
  @Secured('quotation:submit')
  rejectQuotation(@Param('id') id: string, @Req() req: Request) {
    return this.sales.transitionQuotation(req.orgContext!, id, 'reject', req.user!.id, ipOf(req));
  }

  @Post('quotations/:id/accept')
  @Secured('quotation:submit')
  acceptQuotation(@Param('id') id: string, @Body(new ZodValidationPipe(z.object({ warehouse_id: z.string().uuid() }))) body: { warehouse_id: string }, @Req() req: Request) {
    return this.sales.acceptQuotation(req.orgContext!, id, body.warehouse_id, req.user!.id, ipOf(req));
  }

  @Post('quotations/expire-due')
  @Secured('quotation:manage')
  expireDueQuotations(@Req() req: Request) {
    return this.sales.expireDueQuotations(req.orgContext!, req.user!.id);
  }

  // ---------- sales orders ----------

  @Post('orders')
  @Secured('sales_order:create')
  @Idempotent()
  createOrder(@Body(new ZodValidationPipe(salesOrderCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createSalesOrder(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('orders')
  @Secured('sales_order:view')
  listOrders(@Query(new ZodValidationPipe(salesOrderListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listSalesOrders(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('orders/:id')
  @Secured('sales_order:view')
  getOrder(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getSalesOrder(req.orgContext!, id);
  }

  @Post('orders/:id/confirm')
  @Secured('sales_order:submit')
  confirmOrder(@Param('id') id: string, @Req() req: Request) {
    return this.sales.confirmOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('orders/:id/cancel')
  @Secured('sales_order:edit')
  cancelOrder(@Param('id') id: string, @Req() req: Request) {
    return this.sales.cancelOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  // ---------- deliveries ----------

  @Post('deliveries')
  @Secured('delivery:create')
  @Idempotent()
  createDelivery(@Body(new ZodValidationPipe(deliveryCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createDelivery(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('deliveries')
  @Secured('delivery:view')
  listDeliveries(@Query(new ZodValidationPipe(deliveryListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listDeliveries(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('deliveries/:id')
  @Secured('delivery:view')
  getDelivery(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getDelivery(req.orgContext!, id);
  }

  @Post('deliveries/:id/post')
  @Secured('delivery:post')
  postDelivery(@Param('id') id: string, @Req() req: Request) {
    return this.sales.postDelivery(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  // ---------- invoices ----------

  @Post('invoices')
  @Secured('sales_invoice:create')
  @Idempotent()
  createInvoice(@Body(new ZodValidationPipe(salesInvoiceCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createInvoice(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('invoices')
  @Secured('sales_invoice:view')
  listInvoices(@Query(new ZodValidationPipe(salesInvoiceListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listSalesInvoices(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('invoices/:id')
  @Secured('sales_invoice:view')
  getInvoice(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getSalesInvoice(req.orgContext!, id);
  }

  @Post('invoices/:id/post')
  @Secured('sales_invoice:post')
  @Idempotent()
  postInvoice(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.sales.postInvoice(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }

  // ---------- payments ----------

  @Post('payments')
  @Secured('payment:create')
  @Idempotent()
  createPayment(@Body(new ZodValidationPipe(salesPaymentCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createPayment(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('payments')
  @Secured('payment:view')
  listPayments(@Query(new ZodValidationPipe(salesPaymentListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listSalesPayments(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('payments/:id')
  @Secured('payment:view')
  getPayment(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getSalesPayment(req.orgContext!, id);
  }

  @Post('payments/:id/post')
  @Secured('payment:post')
  @Idempotent()
  postPayment(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.sales.postPayment(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }

  // ---------- credit notes ----------

  @Post('credit-notes')
  @Secured('credit_note:create')
  @Idempotent()
  createCreditNote(@Body(new ZodValidationPipe(creditNoteCreateSchema)) body: never, @Req() req: Request) {
    return this.sales.createCreditNote(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('credit-notes')
  @Secured('credit_note:view')
  listCreditNotes(@Query(new ZodValidationPipe(creditNoteListQuerySchema)) query: never, @Req() req: Request) {
    return this.sales.listCreditNotes(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('credit-notes/:id')
  @Secured('credit_note:view')
  getCreditNote(@Param('id') id: string, @Req() req: Request) {
    return this.sales.getCreditNote(req.orgContext!, id);
  }

  @Post('credit-notes/:id/post')
  @Secured('credit_note:post')
  @Idempotent()
  postCreditNote(@Param('id') id: string, @Body() body: { idempotency_key?: string; warehouse_id?: string }, @Req() req: Request) {
    return this.sales.postCreditNote(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body), body.warehouse_id);
  }
}
