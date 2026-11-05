import {
  Body, Controller, Get, Param, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PurchasingService } from './purchasing.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  purchaseRequestCreateSchema, purchaseRequestListQuerySchema,
  rfqCreateSchema, rfqAwardSchema, rfqListQuerySchema,
  purchaseOrderCreateSchema, purchaseOrderListQuerySchema,
  goodsReceiptCreateSchema, goodsReceiptListQuerySchema,
  supplierBillCreateSchema, supplierBillListQuerySchema,
  supplierPaymentCreateSchema, supplierPaymentListQuerySchema,
  RfqAwardDto,
} from '@atlas-erp/contracts';

const idemFrom = (req: Request, body?: { idempotency_key?: string }) =>
  (req.headers['idempotency-key'] as string | undefined) ?? body?.idempotency_key;

const ipOf = (req: Request) => req.ip;

@ApiTags('purchasing')
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // ---------- purchase requests ----------

  @Post('purchase-requests')
  @Secured('purchase_request:create')
  @Idempotent()
  createPurchaseRequest(@Body(new ZodValidationPipe(purchaseRequestCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createPurchaseRequest(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('purchase-requests')
  @Secured('purchase_request:view')
  listPurchaseRequests(@Query(new ZodValidationPipe(purchaseRequestListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listPurchaseRequests(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('purchase-requests/:id')
  @Secured('purchase_request:view')
  getPurchaseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getPurchaseRequest(req.orgContext!, id);
  }

  @Post('purchase-requests/:id/submit')
  @Secured('purchase_request:submit')
  submitPurchaseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionPurchaseRequest(req.orgContext!, id, 'submit', req.user!.id, ipOf(req));
  }

  @Post('purchase-requests/:id/approve')
  @Secured('purchase_request:approve')
  approvePurchaseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionPurchaseRequest(req.orgContext!, id, 'approve', req.user!.id, ipOf(req));
  }

  @Post('purchase-requests/:id/reject')
  @Secured('purchase_request:submit')
  rejectPurchaseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionPurchaseRequest(req.orgContext!, id, 'reject', req.user!.id, ipOf(req));
  }

  @Post('purchase-requests/:id/cancel')
  @Secured('purchase_request:edit')
  cancelPurchaseRequest(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionPurchaseRequest(req.orgContext!, id, 'cancel', req.user!.id, ipOf(req));
  }

  @Post('purchase-requests/:id/convert')
  @Secured('purchase_order:create')
  convertPurchaseRequest(
    @Param('id') id: string,
    @Body() body: { supplier_id: string; warehouse_id: string },
    @Req() req: Request,
  ) {
    return this.purchasing.convertPurchaseRequest(req.orgContext!, id, body.supplier_id, body.warehouse_id, req.user!.id, ipOf(req));
  }

  // ---------- RFQs ----------

  @Post('rfqs')
  @Secured('purchase_request:create')
  @Idempotent()
  createRfq(@Body(new ZodValidationPipe(rfqCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createRfq(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('rfqs')
  @Secured('purchase_request:view')
  listRfqs(@Query(new ZodValidationPipe(rfqListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listRfqs(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('rfqs/:id')
  @Secured('purchase_request:view')
  getRfq(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getRfq(req.orgContext!, id);
  }

  @Post('rfqs/:id/send')
  @Secured('purchase_request:submit')
  sendRfq(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionRfq(req.orgContext!, id, 'send', req.user!.id, ipOf(req));
  }

  @Post('rfqs/:id/cancel')
  @Secured('purchase_request:edit')
  cancelRfq(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.transitionRfq(req.orgContext!, id, 'cancel', req.user!.id, ipOf(req));
  }

  @Post('rfqs/:id/quote')
  @Secured('purchase_request:edit')
  recordRfqQuote(
    @Param('id') id: string,
    @Body() body: { rfq_line_id: string; quoted_price: string },
    @Req() req: Request,
  ) {
    return this.purchasing.recordRfqQuote(req.orgContext!, id, body.rfq_line_id, body.quoted_price, req.user!.id, ipOf(req));
  }

  @Post('rfqs/:id/award')
  @Secured('purchase_order:create')
  awardRfq(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rfqAwardSchema)) body: never,
    @Req() req: Request,
  ) {
    const b = body as unknown as RfqAwardDto;
    return this.purchasing.awardRfq(req.orgContext!, id, b, req.user!.id, ipOf(req));
  }

  // ---------- purchase orders ----------

  @Post('orders')
  @Secured('purchase_order:create')
  @Idempotent()
  createPurchaseOrder(@Body(new ZodValidationPipe(purchaseOrderCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createPurchaseOrder(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('orders')
  @Secured('purchase_order:view')
  listPurchaseOrders(@Query(new ZodValidationPipe(purchaseOrderListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listPurchaseOrders(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('orders/:id')
  @Secured('purchase_order:view')
  getPurchaseOrder(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getPurchaseOrder(req.orgContext!, id);
  }

  @Post('orders/:id/submit')
  @Secured('purchase_order:submit')
  submitPurchaseOrder(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.submitPurchaseOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('orders/:id/approve')
  @Secured('purchase_order:approve')
  approvePurchaseOrder(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.approvePurchaseOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('orders/:id/reject')
  @Secured('purchase_order:submit')
  rejectPurchaseOrder(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.rejectPurchaseOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('orders/:id/cancel')
  @Secured('purchase_order:edit')
  cancelPurchaseOrder(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.cancelPurchaseOrder(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  // ---------- goods receipts ----------

  @Post('goods-receipts')
  @Secured('goods_receipt:create')
  @Idempotent()
  createGoodsReceipt(@Body(new ZodValidationPipe(goodsReceiptCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createGoodsReceipt(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('goods-receipts')
  @Secured('goods_receipt:view')
  listGoodsReceipts(@Query(new ZodValidationPipe(goodsReceiptListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listGoodsReceipts(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('goods-receipts/:id')
  @Secured('goods_receipt:view')
  getGoodsReceipt(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getGoodsReceipt(req.orgContext!, id);
  }

  @Post('goods-receipts/:id/post')
  @Secured('goods_receipt:post')
  @Idempotent()
  postGoodsReceipt(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.purchasing.postGoodsReceipt(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }

  @Post('goods-receipts/:id/cancel')
  @Secured('goods_receipt:edit')
  cancelGoodsReceipt(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.cancelGoodsReceipt(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  // ---------- supplier bills ----------

  @Post('bills')
  @Secured('supplier_bill:create')
  @Idempotent()
  createSupplierBill(@Body(new ZodValidationPipe(supplierBillCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createSupplierBill(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('bills')
  @Secured('supplier_bill:view')
  listSupplierBills(@Query(new ZodValidationPipe(supplierBillListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listSupplierBills(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('bills/:id')
  @Secured('supplier_bill:view')
  getSupplierBill(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getSupplierBill(req.orgContext!, id);
  }

  @Post('bills/:id/submit')
  @Secured('supplier_bill:submit')
  submitSupplierBill(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.submitSupplierBill(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('bills/:id/approve')
  @Secured('supplier_bill:approve')
  approveSupplierBill(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.approveSupplierBill(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('bills/:id/post')
  @Secured('supplier_bill:post')
  @Idempotent()
  postSupplierBill(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.purchasing.postSupplierBill(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }

  // ---------- supplier payments ----------

  @Post('payments')
  @Secured('payment:create')
  @Idempotent()
  createSupplierPayment(@Body(new ZodValidationPipe(supplierPaymentCreateSchema)) body: never, @Req() req: Request) {
    return this.purchasing.createSupplierPayment(req.orgContext!, body as never, req.user!.id, ipOf(req));
  }

  @Get('payments')
  @Secured('payment:view')
  listSupplierPayments(@Query(new ZodValidationPipe(supplierPaymentListQuerySchema)) query: never, @Req() req: Request) {
    return this.purchasing.listSupplierPayments(req.orgContext!, (query as unknown as { company_id: string }).company_id, query as never);
  }

  @Get('payments/:id')
  @Secured('payment:view')
  getSupplierPayment(@Param('id') id: string, @Req() req: Request) {
    return this.purchasing.getSupplierPayment(req.orgContext!, id);
  }

  @Post('payments/:id/post')
  @Secured('payment:post')
  @Idempotent()
  postSupplierPayment(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.purchasing.postSupplierPayment(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }
}
