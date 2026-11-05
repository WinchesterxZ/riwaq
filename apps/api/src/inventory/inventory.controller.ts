import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  stockMovementCreateSchema, stockMovementListQuerySchema,
  stockReservationCreateSchema, stockBalanceQuerySchema,
  inventoryTransferCreateSchema, inventoryAdjustmentCreateSchema,
  inventoryCountCreateSchema, inventoryCountLinesSchema,
} from '@atlas-erp/contracts';

const idemFrom = (req: Request, body?: { idempotency_key?: string }) =>
  (req.headers['idempotency-key'] as string | undefined) ?? body?.idempotency_key;

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // ---------- movements ----------
  @Post('movements/receive')
  @Secured('stock_movement:create')
  @Idempotent()
  receive(@Body(new ZodValidationPipe(stockMovementCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['receiveStock']>[1];
    return this.inventory.receiveStock(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('movements/issue')
  @Secured('stock_movement:create')
  @Idempotent()
  issue(@Body(new ZodValidationPipe(stockMovementCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['issueStock']>[1];
    return this.inventory.issueStock(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('movements/return')
  @Secured('stock_movement:create')
  @Idempotent()
  returnStock(@Body(new ZodValidationPipe(stockMovementCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['returnStock']>[1];
    return this.inventory.returnStock(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('movements/opening')
  @Secured('stock_movement:create')
  @Idempotent()
  opening(@Body(new ZodValidationPipe(stockMovementCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['openingStock']>[1];
    return this.inventory.openingStock(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Get('movements')
  @Secured('stock_movement:view')
  listMovements(@Query(new ZodValidationPipe(stockMovementListQuerySchema)) query: never, @Req() req: Request) {
    return this.inventory.listMovements(req.orgContext!, query as never);
  }

  // ---------- reservations ----------
  @Post('reservations')
  @Secured('stock_reservation:create')
  @Idempotent()
  reserve(@Body(new ZodValidationPipe(stockReservationCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['reserveStock']>[1];
    return this.inventory.reserveStock(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('reservations/:id/release')
  @Secured('stock_reservation:create')
  release(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.releaseReservation(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Get('reservations')
  @Secured('stock_reservation:view')
  listReservations(@Query('company_id') companyId: string, @Query('warehouse_id') warehouseId: string | undefined, @Query('product_id') productId: string | undefined, @Query('status') status: string | undefined, @Req() req: Request) {
    return this.inventory.listReservations(req.orgContext!, companyId, warehouseId, productId, status);
  }

  // ---------- balances & valuation ----------
  @Get('balances')
  @Secured('stock_balance:view')
  balances(@Query(new ZodValidationPipe(stockBalanceQuerySchema)) query: never, @Req() req: Request) {
    return this.inventory.getBalances(req.orgContext!, query as never);
  }

  @Get('valuation')
  @Secured('inventory_valuation:view')
  valuation(@Query('company_id') companyId: string, @Query('warehouse_id') warehouseId: string | undefined, @Req() req: Request) {
    return this.inventory.getValuation(req.orgContext!, companyId, warehouseId);
  }

  // ---------- transfers ----------
  @Post('transfers')
  @Secured('stock_transfer:create')
  @Idempotent()
  createTransfer(@Body(new ZodValidationPipe(inventoryTransferCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['createTransfer']>[1];
    return this.inventory.createTransfer(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('transfers/:id/dispatch')
  @Secured('stock_transfer:post')
  dispatchTransfer(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.dispatchTransfer(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('transfers/:id/receive')
  @Secured('stock_transfer:post')
  receiveTransfer(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.receiveTransfer(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('transfers/:id/cancel')
  @Secured('stock_transfer:submit')
  cancelTransfer(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.cancelTransfer(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Get('transfers/:id')
  @Secured('stock_transfer:view')
  getTransfer(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.getTransfer(req.orgContext!, id);
  }

  @Get('transfers')
  @Secured('stock_transfer:view')
  listTransfers(@Query('company_id') companyId: string, @Query('status') status: string | undefined, @Req() req: Request) {
    return this.inventory.listTransfers(req.orgContext!, companyId, status);
  }

  // ---------- adjustments ----------
  @Post('adjustments')
  @Secured('stock_adjustment:create')
  @Idempotent()
  createAdjustment(@Body(new ZodValidationPipe(inventoryAdjustmentCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['createAdjustment']>[1];
    return this.inventory.createAdjustment(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('adjustments/:id/submit')
  @Secured('stock_adjustment:submit')
  submitAdjustment(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.submitAdjustment(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('adjustments/:id/approve')
  @Secured('stock_adjustment:approve')
  approveAdjustment(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.approveAdjustment(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('adjustments/:id/post')
  @Secured('stock_adjustment:post')
  postAdjustment(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.postAdjustment(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('adjustments/:id/cancel')
  @Secured('stock_adjustment:submit')
  cancelAdjustment(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.cancelAdjustment(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Get('adjustments/:id')
  @Secured('stock_adjustment:view')
  getAdjustment(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.getAdjustment(req.orgContext!, id);
  }

  @Get('adjustments')
  @Secured('stock_adjustment:view')
  listAdjustments(@Query('company_id') companyId: string, @Query('status') status: string | undefined, @Req() req: Request) {
    return this.inventory.listAdjustments(req.orgContext!, companyId, status);
  }

  // ---------- counts ----------
  @Post('counts')
  @Secured('inventory_count:create')
  @Idempotent()
  createCount(@Body(new ZodValidationPipe(inventoryCountCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<InventoryService['createCount']>[1];
    return this.inventory.createCount(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, req.ip);
  }

  @Post('counts/:id/start')
  @Secured('inventory_count:submit')
  startCount(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.startCount(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Patch('counts/:id/lines')
  @Secured('inventory_count:submit')
  setCountLines(@Param('id') id: string, @Body(new ZodValidationPipe(inventoryCountLinesSchema)) body: never, @Req() req: Request) {
    return this.inventory.setCountLines(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Post('counts/:id/post')
  @Secured('inventory_count:post')
  postCount(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.postCount(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Post('counts/:id/cancel')
  @Secured('inventory_count:submit')
  cancelCount(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.cancelCount(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Get('counts/:id')
  @Secured('inventory_count:view')
  getCount(@Param('id') id: string, @Req() req: Request) {
    return this.inventory.getCount(req.orgContext!, id);
  }

  @Get('counts')
  @Secured('inventory_count:view')
  listCounts(@Query('company_id') companyId: string, @Query('status') status: string | undefined, @Req() req: Request) {
    return this.inventory.listCounts(req.orgContext!, companyId, status);
  }
}
