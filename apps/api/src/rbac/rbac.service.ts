import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Errors } from '../common/errors';

/**
 * RBAC evaluation. Pure logic is isolated in static helpers for unit testing.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pure: does a permission set grant all required permissions? */
  static grantsAll(granted: Set<string> | string[], required: string[]): boolean {
    const set = granted instanceof Set ? granted : new Set(granted);
    return required.every((p) => set.has(p));
  }

  /** Pure: merge role permission lists into a deduplicated set. */
  static mergePermissions(rolePerms: string[][]): string[] {
    return [...new Set(rolePerms.flat())];
  }

  async listRoles(organizationId: string) {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      nameAr: r.nameAr,
      isSystem: r.isSystem,
      permissions: r.permissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
    }));
  }

  async listPermissions() {
    const perms = await this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    const grouped: Record<string, Array<{ id: string; action: string }>> = {};
    for (const p of perms) {
      (grouped[p.resource] ??= []).push({ id: p.id, action: p.action });
    }
    return grouped;
  }

  async createRole(organizationId: string, dto: { name: string; nameAr: string; permissionIds: string[] }, actorId: string) {
    const count = await this.prisma.permission.count({ where: { id: { in: dto.permissionIds } } });
    if (count !== dto.permissionIds.length) throw Errors.notFound('Permission');
    const role = await this.prisma.role.create({
      data: {
        organizationId,
        name: dto.name,
        nameAr: dto.nameAr,
        isSystem: false,
        permissions: { create: dto.permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });
    return { id: role.id, name: role.name, nameAr: role.nameAr, isSystem: role.isSystem };
  }

  async updateRole(organizationId: string, roleId: string, dto: { name?: string; nameAr?: string; permissionIds?: string[] }) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, OR: [{ organizationId }, { organizationId: null }] },
    });
    if (!role) throw Errors.notFound('Role');
    if (role.isSystem) throw Errors.systemRoleImmutable();

    if (dto.permissionIds) {
      const count = await this.prisma.permission.count({ where: { id: { in: dto.permissionIds } } });
      if (count !== dto.permissionIds.length) throw Errors.notFound('Permission');
      await this.prisma.rolePermission.deleteMany({ where: { roleId } });
      await this.prisma.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({ roleId, permissionId })),
      });
    }
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: { name: dto.name, nameAr: dto.nameAr },
    });
    return { id: updated.id, name: updated.name, nameAr: updated.nameAr, isSystem: updated.isSystem };
  }
}
