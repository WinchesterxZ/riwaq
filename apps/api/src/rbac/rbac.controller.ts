import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RbacService } from './rbac.service';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { roleCreateSchema, roleUpdateSchema } from '@atlas-erp/contracts';

@ApiTags('rbac')
@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Secured()
  @Get('permissions')
  permissions() {
    return this.rbac.listPermissions();
  }

  @Secured()
  @Get('roles')
  roles(@Req() req: Request) {
    return this.rbac.listRoles(req.orgContext!.organizationId);
  }

  @Secured('role:manage')
  @Idempotent()
  @Post('roles')
  createRole(
    @Body(new ZodValidationPipe(roleCreateSchema)) body: { name: string; nameAr: string; permissionIds: string[] },
    @Req() req: Request,
  ) {
    return this.rbac.createRole(req.orgContext!.organizationId, body, req.user!.id);
  }

  @Secured('role:manage')
  @Patch('roles/:id')
  updateRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleUpdateSchema)) body: { name?: string; nameAr?: string; permissionIds?: string[] },
    @Req() req: Request,
  ) {
    return this.rbac.updateRole(req.orgContext!.organizationId, id, body);
  }
}
