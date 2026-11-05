import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Errors, AppException } from '../common/errors';
import { OrgContext } from '../common/request.types';
import { pageMeta } from '../common/pagination';
import { seedChartOfAccounts } from '../accounting/coa-seed';
import type {
  OrganizationCreateDto, CompanyCreateDto, BranchCreateDto, WarehouseCreateDto,
} from '@atlas-erp/contracts';

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- organizations ----------

  async createOrganization(dto: OrganizationCreateDto, userId: string, ip?: string) {
    const organization = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          nameAr: dto.nameAr,
          defaultCurrency: dto.defaultCurrency ?? 'EGP',
          defaultTimezone: dto.defaultTimezone ?? 'Africa/Cairo',
        },
      });
      const membership = await tx.membership.create({
        data: { userId, organizationId: org.id, status: 'active' },
      });
      const ownerRole = await tx.role.findFirst({
        where: { name: 'Organization Owner', isSystem: true },
      });
      if (!ownerRole) throw new Error('System roles not seeded.');
      await tx.userRole.create({ data: { membershipId: membership.id, roleId: ownerRole.id } });
      return org;
    });
    await this.audit.log({
      organizationId: organization.id, actorId: userId,
      action: 'organization.created', entityType: 'organization', entityId: organization.id, ip,
    });
    return organization;
  }

  async getOrganization(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw Errors.notFound('Organization');
    return org;
  }

  async myMemberships(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: {
        organization: true,
        companies: { include: {} },
        roles: { include: { role: true } },
      },
    });
    return memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationNameAr: m.organization.nameAr,
      status: m.status,
      companyIds: m.companies.map((c) => c.companyId),
      roles: m.roles.map((r) => r.role.name),
    }));
  }

  // ---------- companies / branches / warehouses ----------

  private assertCompanyInScope(ctx: OrgContext, companyId: string) {
    if (ctx.companyIds && !ctx.companyIds.includes(companyId)) throw Errors.forbidden();
  }

  async createCompany(ctx: OrgContext, dto: CompanyCreateDto, actorId: string, ip?: string) {
    if (dto.organizationId !== ctx.organizationId) throw Errors.forbidden();
    // Company + standard chart of accounts in one transaction: a company is
    // never left without a CoA (the seed is idempotent and skips when accounts
    // already exist, so re-runs are safe).
    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          organizationId: ctx.organizationId,
          name: dto.name,
          nameAr: dto.nameAr,
          baseCurrency: dto.baseCurrency ?? 'EGP',
          taxId: dto.taxId ?? null,
        },
      });
      await seedChartOfAccounts(tx, c.id, actorId);
      return c;
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId,
      action: 'company.created', entityType: 'company', entityId: company.id, ip,
    });
    return company;
  }

  async listCompanies(ctx: OrgContext) {
    return this.prisma.company.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(ctx.companyIds ? { id: { in: ctx.companyIds } } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createBranch(ctx: OrgContext, dto: BranchCreateDto, actorId: string, ip?: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, organizationId: ctx.organizationId },
    });
    if (!company) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, company.id);
    const branch = await this.prisma.branch.create({
      data: { companyId: company.id, name: dto.name, nameAr: dto.nameAr },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId,
      action: 'branch.created', entityType: 'branch', entityId: branch.id, ip,
    });
    return branch;
  }

  async listBranches(ctx: OrgContext, companyId?: string) {
    if (companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, organizationId: ctx.organizationId },
      });
      if (!company) throw Errors.forbidden();
      this.assertCompanyInScope(ctx, companyId);
    }
    return this.prisma.branch.findMany({
      where: {
        company: { organizationId: ctx.organizationId },
        ...(companyId ? { companyId } : {}),
        ...(ctx.companyIds ? { companyId: { in: ctx.companyIds } } : {}),
      },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createWarehouse(ctx: OrgContext, dto: WarehouseCreateDto, actorId: string, ip?: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, company: { organizationId: ctx.organizationId } },
      include: { company: true },
    });
    if (!branch) throw Errors.forbidden();
    this.assertCompanyInScope(ctx, branch.companyId);
    const warehouse = await this.prisma.warehouse.create({
      data: { branchId: branch.id, name: dto.name, nameAr: dto.nameAr },
    });
    await this.audit.log({
      organizationId: ctx.organizationId, actorId,
      action: 'warehouse.created', entityType: 'warehouse', entityId: warehouse.id, ip,
    });
    return warehouse;
  }

  async listWarehouses(ctx: OrgContext, branchId?: string) {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, company: { organizationId: ctx.organizationId } },
      });
      if (!branch) throw Errors.forbidden();
      this.assertCompanyInScope(ctx, branch.companyId);
    }
    return this.prisma.warehouse.findMany({
      where: {
        branch: { company: { organizationId: ctx.organizationId } },
        ...(branchId ? { branchId } : {}),
        ...(ctx.companyIds
          ? { branch: { companyId: { in: ctx.companyIds } } }
          : {}),
      },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // ---------- users ----------

  async listUsers(ctx: OrgContext, page: number, perPage: number, q?: string) {
    const where = {
      memberships: {
        some: {
          organizationId: ctx.organizationId,
          status: 'active',
          ...(q
            ? {
                user: {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { email: { contains: q, mode: 'insensitive' as const } },
                  ],
                },
              }
            : {}),
        },
      },
    };
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, name: true, status: true, mfaEnabled: true, createdAt: true,
          memberships: {
            where: { organizationId: ctx.organizationId },
            select: { roles: { select: { role: { select: { name: true } } } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    const data = users.map((u) => ({
      id: u.id, email: u.email, name: u.name, status: u.status,
      mfaEnabled: u.mfaEnabled, createdAt: u.createdAt,
      roles: u.memberships.flatMap((m) => m.roles.map((r) => r.role.name)),
    }));
    return { data, meta: pageMeta(total, page, perPage) };
  }

  async setUserStatus(ctx: OrgContext, targetUserId: string, status: 'active' | 'inactive', actorId: string, ip?: string) {
    if (targetUserId === actorId) {
      throw new AppException(
        'CANNOT_CHANGE_OWN_STATUS', 'You cannot change your own status.',
        'لا يمكنك تغيير حالتك بنفسك.', 400,
      );
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
    });
    if (!membership) throw Errors.notFound('User');
    await this.prisma.user.update({ where: { id: targetUserId }, data: { status } });
    if (status === 'inactive') {
      await this.prisma.session.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.log({
      organizationId: ctx.organizationId, actorId,
      action: `user.${status === 'active' ? 'activated' : 'deactivated'}`,
      entityType: 'user', entityId: targetUserId, ip,
    });
    return { ok: true };
  }

  // ---------- dashboard ----------

  async dashboardSummary(ctx: OrgContext) {
    const [users, companies, branches, warehouses] = await Promise.all([
      this.prisma.membership.count({
        where: { organizationId: ctx.organizationId, status: 'active' },
      }),
      this.prisma.company.count({
        where: {
          organizationId: ctx.organizationId,
          ...(ctx.companyIds ? { id: { in: ctx.companyIds } } : {}),
        },
      }),
      this.prisma.branch.count({
        where: {
          company: { organizationId: ctx.organizationId },
          ...(ctx.companyIds ? { companyId: { in: ctx.companyIds } } : {}),
        },
      }),
      this.prisma.warehouse.count({
        where: {
          branch: { company: { organizationId: ctx.organizationId } },
          ...(ctx.companyIds ? { branch: { companyId: { in: ctx.companyIds } } } : {}),
        },
      }),
    ]);
    return { users, companies, branches, warehouses };
  }
}
