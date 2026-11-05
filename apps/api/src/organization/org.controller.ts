import {
  Body, Controller, Get, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { OrgService } from './org.service';
import { Authed, Secured, Idempotent } from '../common/decorators';
import { Errors } from '../common/errors';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  paginationQuerySchema,
  organizationCreateSchema, companyCreateSchema,
  branchCreateSchema, warehouseCreateSchema, userStatusSchema,
} from '@atlas-erp/contracts';

@ApiTags('organization')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Authed()
  @Get('memberships')
  memberships(@Req() req: Request) {
    return this.org.myMemberships(req.user!.id);
  }

  @Authed()
  @Idempotent()
  @Post('organizations')
  createOrganization(
    @Body(new ZodValidationPipe(organizationCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.org.createOrganization(body as never, req.user!.id, req.ip);
  }

  @Secured()
  @Get('organizations/:id')
  getOrganization(@Param('id') id: string, @Req() req: Request) {
    if (id !== req.orgContext!.organizationId) {
      // Belt & braces: the guard already verified membership for the header org.
      throw Errors.forbidden();
    }
    return this.org.getOrganization(id);
  }

  @Secured('company:manage')
  @Idempotent()
  @Post('companies')
  createCompany(
    @Body(new ZodValidationPipe(companyCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.org.createCompany(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured()
  @Get('companies')
  companies(@Req() req: Request) {
    return this.org.listCompanies(req.orgContext!);
  }

  @Secured('company:manage')
  @Idempotent()
  @Post('branches')
  createBranch(
    @Body(new ZodValidationPipe(branchCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.org.createBranch(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured()
  @Get('branches')
  branches(@Req() req: Request, @Query('companyId') companyId?: string) {
    return this.org.listBranches(req.orgContext!, companyId);
  }

  @Secured('company:manage')
  @Idempotent()
  @Post('warehouses')
  createWarehouse(
    @Body(new ZodValidationPipe(warehouseCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.org.createWarehouse(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured()
  @Get('warehouses')
  warehouses(@Req() req: Request, @Query('branchId') branchId?: string) {
    return this.org.listWarehouses(req.orgContext!, branchId);
  }

  @Secured('user:view')
  @Get('users')
  users(
    @Req() req: Request,
    @Query(new ZodValidationPipe(paginationQuerySchema)) q: { page: number; per_page: number; q?: string; search?: string },
  ) {
    return this.org.listUsers(req.orgContext!, q.page, q.per_page, q.search ?? q.q);
  }

  @Secured('user:manage')
  @Patch('users/:id/status')
  setUserStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(userStatusSchema)) body: { status: 'active' | 'inactive' },
    @Req() req: Request,
  ) {
    return this.org.setUserStatus(req.orgContext!, id, body.status, req.user!.id, req.ip);
  }

  @Secured()
  @Get('dashboard/summary')
  dashboard(@Req() req: Request) {
    return this.org.dashboardSummary(req.orgContext!);
  }
}
