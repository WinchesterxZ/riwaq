import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AccountingService } from './accounting.service';
import { ReportsService } from './reports.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  accountCreateSchema, accountListQuerySchema, accountUpdateSchema,
  fiscalYearCreateSchema, fiscalYearListQuerySchema,
  journalApproveSchema, journalEntryCreateSchema, journalEntryUpdateSchema,
  journalListQuerySchema, journalPostSchema, journalRejectSchema, journalReverseSchema,
  periodListQuerySchema, taxCodeCreateSchema, taxCodeListQuerySchema, taxCodeUpdateSchema,
  trialBalanceQuerySchema,
  generalLedgerQuerySchema, balanceSheetQuerySchema, profitLossQuerySchema,
  cashFlowQuerySchema, agingQuerySchema, vatReportQuerySchema, financeDashboardQuerySchema,
} from '@atlas-erp/contracts';

@ApiTags('accounting')
@Controller()
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly reports: ReportsService,
  ) {}

  // ---------- chart of accounts ----------

  @Secured('account:view')
  @Get('accounts')
  listAccounts(@Query(new ZodValidationPipe(accountListQuerySchema)) q: { company_id: string; is_active?: boolean; is_postable?: boolean }, @Req() req: Request) {
    return this.accounting.listAccounts(req.orgContext!, q.company_id, q.is_active, q.is_postable);
  }

  @Secured('account:create')
  @Idempotent()
  @Post('accounts')
  createAccount(@Body(new ZodValidationPipe(accountCreateSchema)) body: never, @Req() req: Request) {
    return this.accounting.createAccount(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('account:edit')
  @Patch('accounts/:id')
  updateAccount(@Param('id') id: string, @Body(new ZodValidationPipe(accountUpdateSchema)) body: never, @Req() req: Request) {
    return this.accounting.updateAccount(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('account:manage')
  @Post('accounts/:id/deactivate')
  @HttpCode(200)
  deactivateAccount(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.deactivateAccount(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('account:manage')
  @Idempotent()
  @Post('companies/:companyId/chart-of-accounts/seed')
  seedCoa(@Param('companyId') companyId: string, @Req() req: Request) {
    return this.accounting.seedCoa(req.orgContext!, companyId, req.user!.id, req.ip);
  }

  // ---------- fiscal years / periods ----------

  @Secured('period:create')
  @Idempotent()
  @Post('fiscal-years')
  createFiscalYear(@Body(new ZodValidationPipe(fiscalYearCreateSchema)) body: never, @Req() req: Request) {
    return this.accounting.createFiscalYear(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('period:view')
  @Get('fiscal-years')
  listFiscalYears(@Query(new ZodValidationPipe(fiscalYearListQuerySchema)) q: { company_id: string }, @Req() req: Request) {
    return this.accounting.listFiscalYears(req.orgContext!, q.company_id);
  }

  @Secured('period:view')
  @Get('accounting-periods')
  listPeriods(@Query(new ZodValidationPipe(periodListQuerySchema)) q: { fiscal_year_id: string }, @Req() req: Request) {
    return this.accounting.listPeriods(req.orgContext!, q.fiscal_year_id);
  }

  @Secured('period:close')
  @Post('accounting-periods/:id/close')
  @HttpCode(200)
  closePeriod(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.closePeriod(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('period:close')
  @Post('accounting-periods/:id/lock')
  @HttpCode(200)
  lockPeriod(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.lockPeriod(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('period:reopen')
  @Post('accounting-periods/:id/reopen')
  @HttpCode(200)
  reopenPeriod(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.reopenPeriod(req.orgContext!, id, req.user!.id, req.ip);
  }

  // ---------- journal ----------

  @Secured('journal:create')
  @Idempotent()
  @Post('journal-entries')
  async createEntry(
    @Body(new ZodValidationPipe(journalEntryCreateSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { entry, replayed } = await this.accounting.createEntry(req.orgContext!, body as never, req.user!.id, req.ip);
    res.status(replayed ? 200 : 201);
    return entry;
  }

  @Secured('journal:view')
  @Get('journal-entries')
  listEntries(@Query(new ZodValidationPipe(journalListQuerySchema)) q: never, @Req() req: Request) {
    return this.accounting.listEntries(req.orgContext!, q as never);
  }

  @Secured('journal:view')
  @Get('journal-entries/:id')
  getEntry(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.getEntry(req.orgContext!, id);
  }

  @Secured('journal:edit')
  @Patch('journal-entries/:id')
  updateEntry(@Param('id') id: string, @Body(new ZodValidationPipe(journalEntryUpdateSchema)) body: never, @Req() req: Request) {
    return this.accounting.updateEntry(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('journal:delete_draft')
  @Delete('journal-entries/:id')
  deleteEntry(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.deleteEntry(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('journal:submit')
  @Post('journal-entries/:id/submit')
  @HttpCode(200)
  submitEntry(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.submitEntry(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('journal:approve')
  @Post('journal-entries/:id/approve')
  @HttpCode(200)
  approveEntry(@Param('id') id: string, @Body() rawBody: unknown, @Req() req: Request) {
    // Tolerate callers that send no body (comment is optional).
    const body = new ZodValidationPipe(journalApproveSchema).transform(rawBody ?? {});
    return this.accounting.approveEntry(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('journal:reject')
  @Post('journal-entries/:id/reject')
  @HttpCode(200)
  rejectEntry(@Param('id') id: string, @Body() rawBody: unknown, @Req() req: Request) {
    const body = new ZodValidationPipe(journalRejectSchema).transform(rawBody ?? {});
    return this.accounting.rejectEntry(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('journal:post')
  @Post('journal-entries/:id/post')
  @HttpCode(200)
  postEntry(@Param('id') id: string, @Body(new ZodValidationPipe(journalPostSchema)) body: never, @Req() req: Request) {
    const { version } = body as unknown as { version: number };
    return this.accounting.postEntry(req.orgContext!, id, version, req.user!.id, req.ip);
  }

  @Secured('journal:reverse')
  @Post('journal-entries/:id/reverse')
  @HttpCode(200)
  reverseEntry(@Param('id') id: string, @Body(new ZodValidationPipe(journalReverseSchema)) body: never, @Req() req: Request) {
    return this.accounting.reverseEntry(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  // ---------- tax codes ----------

  @Secured('tax_code:view')
  @Get('tax-codes')
  listTaxCodes(@Query(new ZodValidationPipe(taxCodeListQuerySchema)) q: { company_id: string }, @Req() req: Request) {
    return this.accounting.listTaxCodes(req.orgContext!, q.company_id);
  }

  @Secured('tax_code:create')
  @Idempotent()
  @Post('tax-codes')
  createTaxCode(@Body(new ZodValidationPipe(taxCodeCreateSchema)) body: never, @Req() req: Request) {
    return this.accounting.createTaxCode(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('tax_code:edit')
  @Patch('tax-codes/:id')
  updateTaxCode(@Param('id') id: string, @Body(new ZodValidationPipe(taxCodeUpdateSchema)) body: never, @Req() req: Request) {
    return this.accounting.updateTaxCode(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('tax_code:manage')
  @Post('tax-codes/:id/deactivate')
  @HttpCode(200)
  deactivateTaxCode(@Param('id') id: string, @Req() req: Request) {
    return this.accounting.deactivateTaxCode(req.orgContext!, id, req.user!.id, req.ip);
  }

  @Secured('tax_code:manage')
  @Idempotent()
  @Post('companies/:companyId/tax-codes/seed-standard')
  seedStandardTaxCodes(@Param('companyId') companyId: string, @Req() req: Request) {
    return this.accounting.seedStandardTaxCodes(req.orgContext!, companyId, req.user!.id, req.ip);
  }

  // ---------- reports ----------

  @Secured('report:view')
  @Get('reports/trial-balance')
  trialBalance(@Query(new ZodValidationPipe(trialBalanceQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, from, to } = q as unknown as { company_id: string; from: string; to: string };
    return this.accounting.trialBalance(req.orgContext!, company_id, from, to);
  }

  @Secured('report:view')
  @Get('reports/general-ledger')
  generalLedger(@Query(new ZodValidationPipe(generalLedgerQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, from, to, account_id } = q as unknown as { company_id: string; from: string; to: string; account_id?: string };
    return this.reports.generalLedger(req.orgContext!, company_id, from, to, account_id);
  }

  @Secured('report:view')
  @Get('reports/balance-sheet')
  balanceSheet(@Query(new ZodValidationPipe(balanceSheetQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, as_of } = q as unknown as { company_id: string; as_of: string };
    return this.reports.balanceSheet(req.orgContext!, company_id, as_of);
  }

  @Secured('report:view')
  @Get('reports/profit-loss')
  profitLoss(@Query(new ZodValidationPipe(profitLossQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, from, to } = q as unknown as { company_id: string; from: string; to: string };
    return this.reports.profitLoss(req.orgContext!, company_id, from, to);
  }

  @Secured('report:view')
  @Get('reports/cash-flow')
  cashFlow(@Query(new ZodValidationPipe(cashFlowQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, from, to } = q as unknown as { company_id: string; from: string; to: string };
    return this.reports.cashFlow(req.orgContext!, company_id, from, to);
  }

  @Secured('report:view')
  @Get('reports/ar-aging')
  arAging(@Query(new ZodValidationPipe(agingQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, as_of } = q as unknown as { company_id: string; as_of: string };
    return this.reports.arAging(req.orgContext!, company_id, as_of);
  }

  @Secured('report:view')
  @Get('reports/ap-aging')
  apAging(@Query(new ZodValidationPipe(agingQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, as_of } = q as unknown as { company_id: string; as_of: string };
    return this.reports.apAging(req.orgContext!, company_id, as_of);
  }

  @Secured('report:view')
  @Get('reports/vat')
  vatReport(@Query(new ZodValidationPipe(vatReportQuerySchema)) q: never, @Req() req: Request) {
    const { company_id, from, to } = q as unknown as { company_id: string; from: string; to: string };
    return this.reports.vatReport(req.orgContext!, company_id, from, to);
  }

  @Secured('report:view')
  @Get('reports/finance-dashboard')
  financeDashboard(@Query(new ZodValidationPipe(financeDashboardQuerySchema)) q: never, @Req() req: Request) {
    const { company_id } = q as unknown as { company_id: string };
    return this.reports.financeDashboard(req.orgContext!, company_id);
  }
}
