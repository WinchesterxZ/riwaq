import {
  Body, Controller, Get, Param, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { FinanceService } from './finance.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  bankStatementCreateSchema, bankStatementListQuerySchema, bankMatchSchema,
  expenseBillCreateSchema, expenseBillListQuerySchema,
} from '@atlas-erp/contracts';

const idemFrom = (req: Request, body?: { idempotency_key?: string | null }) =>
  (req.headers['idempotency-key'] as string | undefined) ?? body?.idempotency_key ?? undefined;

const ipOf = (req: Request) => req.ip;

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // ---------- bank statements ----------

  @Post('bank-statements')
  @Secured('bank_statement:create')
  @Idempotent()
  createStatement(@Body(new ZodValidationPipe(bankStatementCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<FinanceService['createBankStatement']>[1];
    return this.finance.createBankStatement(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, ipOf(req));
  }

  @Get('bank-statements')
  @Secured('bank_statement:view')
  listStatements(@Query(new ZodValidationPipe(bankStatementListQuerySchema)) q: never, @Req() req: Request) {
    return this.finance.listBankStatements(req.orgContext!, q as never);
  }

  @Get('bank-statements/:id')
  @Secured('bank_statement:view')
  getStatement(@Param('id') id: string, @Req() req: Request) {
    return this.finance.getBankStatement(req.orgContext!, id);
  }

  @Post('bank-statements/:id/post')
  @Secured('bank_statement:post')
  @Idempotent()
  postStatement(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.finance.postBankStatement(req.orgContext!, id, req.user!.id, ipOf(req));
  }

  @Post('bank-statements/lines/:lineId/match')
  @Secured('bank_reconciliation:match')
  matchLine(
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(bankMatchSchema)) body: never,
    @Req() req: Request,
  ) {
    const { journal_entry_id } = body as unknown as { journal_entry_id: string };
    return this.finance.matchStatementLine(req.orgContext!, lineId, journal_entry_id, req.user!.id, ipOf(req));
  }

  @Post('bank-statements/lines/:lineId/unmatch')
  @Secured('bank_reconciliation:match')
  unmatchLine(@Param('lineId') lineId: string, @Body() body: unknown, @Req() req: Request) {
    return this.finance.unmatchStatementLine(req.orgContext!, lineId, req.user!.id, ipOf(req));
  }

  @Get('bank-statements/:id/outstanding')
  @Secured('bank_reconciliation:view')
  outstanding(@Param('id') id: string, @Req() req: Request) {
    return this.finance.outstandingItems(req.orgContext!, id);
  }

  // ---------- expense bills ----------

  @Post('expense-bills')
  @Secured('expense_bill:create')
  @Idempotent()
  createExpense(@Body(new ZodValidationPipe(expenseBillCreateSchema)) body: never, @Req() req: Request) {
    const dto = body as unknown as Parameters<FinanceService['createExpenseBill']>[1];
    return this.finance.createExpenseBill(req.orgContext!, { ...dto, idempotency_key: idemFrom(req, dto) }, req.user!.id, ipOf(req));
  }

  @Get('expense-bills')
  @Secured('expense_bill:view')
  listExpenses(@Query(new ZodValidationPipe(expenseBillListQuerySchema)) q: never, @Req() req: Request) {
    return this.finance.listExpenseBills(req.orgContext!, q as never);
  }

  @Get('expense-bills/:id')
  @Secured('expense_bill:view')
  getExpense(@Param('id') id: string, @Req() req: Request) {
    return this.finance.getExpenseBill(req.orgContext!, id);
  }

  @Post('expense-bills/:id/submit')
  @Secured('expense_bill:submit')
  submitExpense(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.finance.transitionExpenseBill(req.orgContext!, id, 'submit', req.user!.id, ipOf(req));
  }

  @Post('expense-bills/:id/approve')
  @Secured('expense_bill:approve')
  approveExpense(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.finance.transitionExpenseBill(req.orgContext!, id, 'approve', req.user!.id, ipOf(req));
  }

  @Post('expense-bills/:id/reject')
  @Secured('expense_bill:approve')
  rejectExpense(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.finance.transitionExpenseBill(req.orgContext!, id, 'reject', req.user!.id, ipOf(req));
  }

  @Post('expense-bills/:id/cancel')
  @Secured('expense_bill:submit')
  cancelExpense(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.finance.transitionExpenseBill(req.orgContext!, id, 'cancel', req.user!.id, ipOf(req));
  }

  @Post('expense-bills/:id/post')
  @Secured('expense_bill:post')
  @Idempotent()
  postExpense(@Param('id') id: string, @Body() body: { idempotency_key?: string }, @Req() req: Request) {
    return this.finance.postExpenseBill(req.orgContext!, id, req.user!.id, ipOf(req), idemFrom(req, body));
  }
}
