import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Errors } from '../errors';
import { OrgContext } from '../request.types';

/**
 * Resolves X-Organization-Id into a request-scoped context:
 * verifies active membership, authorized companies/branches, roles+permissions.
 * Every org-scoped query must be filtered by this context — never by raw client IDs.
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const orgId = req.headers['x-organization-id'];
    if (typeof orgId !== 'string' || !orgId) throw Errors.orgHeaderMissing();
    if (!req.user) throw Errors.forbidden();

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId: orgId } },
      include: {
        companies: true,
        branches: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!membership || membership.status !== 'active') {
      // Security-relevant: log the denied cross-org attempt.
      await this.prisma.auditEvent.create({
        data: {
          organizationId: orgId,
          actorId: req.user.id,
          action: 'security.cross_org_denied',
          entityType: 'organization',
          entityId: orgId,
          ip: req.ip,
        },
      }).catch(() => undefined);
      throw Errors.notMember();
    }

    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const ur of membership.roles) {
      roles.push(ur.role.name);
      for (const rp of ur.role.permissions) {
        permissions.add(`${rp.permission.resource}:${rp.permission.action}`);
      }
    }

    const ctx: OrgContext = {
      organizationId: orgId,
      membershipId: membership.id,
      companyIds: membership.companies.length > 0 ? membership.companies.map((c) => c.companyId) : null,
      branchIds: membership.branches.length > 0 ? membership.branches.map((b) => b.branchId) : null,
      roles,
      permissions: [...permissions],
    };
    req.orgContext = ctx;
    return true;
  }
}
