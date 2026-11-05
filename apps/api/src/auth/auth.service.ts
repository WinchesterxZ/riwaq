import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { AuditService } from '../audit/audit.service';
import { Errors, AppException } from '../common/errors';
import { hashToken } from '../common/guards/session-auth.guard';
import { seedChartOfAccounts } from '../accounting/coa-seed';
import type {
  FirstRunDto, LoginDto, InvitationCreateDto, InvitationAcceptDto,
} from '@atlas-erp/contracts';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtlMs: number;
  private readonly lockoutThreshold: number;
  private readonly lockoutMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.sessionTtlMs = Number(config.get('SESSION_TTL_HOURS', 12)) * 3600 * 1000;
    this.lockoutThreshold = Number(config.get('LOCKOUT_THRESHOLD', 5));
    this.lockoutMinutes = Number(config.get('LOCKOUT_MINUTES', 15));
  }

  // ---------- first run ----------

  async isFirstRun(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  async firstRun(dto: FirstRunDto, ip?: string) {
    if (!(await this.isFirstRun())) throw Errors.firstRunDone();

    const passwordHash = await this.passwords.hash(dto.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          nameAr: dto.organizationNameAr,
          defaultCurrency: 'EGP',
          defaultTimezone: 'Africa/Cairo',
        },
      });
      const user = await tx.user.create({
        data: {
          email: dto.adminEmail,
          passwordHash,
          name: dto.adminName,
          status: 'active',
        },
      });
      const membership = await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, status: 'active' },
      });
      const ownerRole = await tx.role.findFirst({
        where: { name: 'Organization Owner', isSystem: true },
      });
      if (!ownerRole) throw new Error('System roles not seeded. Run pnpm db:seed first.');
      await tx.userRole.create({
        data: { membershipId: membership.id, roleId: ownerRole.id },
      });
      // Sensible onboarding default: one company + branch + warehouse.
      const company = await tx.company.create({
        data: {
          organizationId: organization.id,
          name: dto.organizationName,
          nameAr: dto.organizationNameAr,
          baseCurrency: 'EGP',
        },
      });
      // Same standard CoA as the API company-creation path (idempotent seed).
      await seedChartOfAccounts(tx, company.id, user.id);
      const branch = await tx.branch.create({
        data: { companyId: company.id, name: 'Main Branch', nameAr: 'الفرع الرئيسي' },
      });
      await tx.warehouse.create({
        data: { branchId: branch.id, name: 'Main Warehouse', nameAr: 'المخزن الرئيسي' },
      });
      return { organization, user, company };
    });

    await this.audit.log({
      organizationId: result.organization.id,
      actorId: result.user.id,
      action: 'auth.first_run',
      entityType: 'organization',
      entityId: result.organization.id,
      ip,
    });

    const { token, session } = await this.createSession(result.user.id, ip, undefined);
    return {
      token,
      expiresAt: session.expiresAt,
      user: this.toUserDto(result.user),
      organization: result.organization,
      company: result.company,
    };
  }

  // ---------- sessions ----------

  private async createSession(userId: string, ip?: string, userAgent?: string) {
    const token = randomBytes(32).toString('hex');
    const session = await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + this.sessionTtlMs),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
    return { token, session };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await this.audit.log({ action: 'auth.login_failed', entityType: 'user', ip, diff: { email: dto.email, reason: 'unknown_email' } });
      throw Errors.invalidCredentials();
    }
    if (user.status !== 'active') throw Errors.accountInactive();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw Errors.accountLocked(user.lockedUntil);
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      const failedAttempts = user.failedAttempts + 1;
      const lockedUntil =
        failedAttempts >= this.lockoutThreshold
          ? new Date(Date.now() + this.lockoutMinutes * 60 * 1000)
          : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts, lockedUntil },
      });
      await this.audit.log({
        actorId: user.id, action: 'auth.login_failed', entityType: 'user',
        entityId: user.id, ip, diff: { reason: 'bad_password', locked: !!lockedUntil },
      });
      if (lockedUntil) throw Errors.accountLocked(lockedUntil);
      throw Errors.invalidCredentials();
    }

    if (user.mfaEnabled) {
      if (!dto.totpCode) throw Errors.mfaRequired();
      const valid = authenticator.check(dto.totpCode, user.mfaSecret ?? '');
      if (!valid) throw Errors.invalidTotp();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const { token, session } = await this.createSession(user.id, ip, userAgent);
    await this.audit.log({
      actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip,
    });
    return { token, expiresAt: session.expiresAt, user: this.toUserDto(user) };
  }

  async logout(token: string) {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: {
        organization: true,
        companies: true,
        roles: { include: { role: true } },
      },
    });
    return {
      user: this.toUserDto(user),
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationNameAr: m.organization.nameAr,
        status: m.status,
        companyIds: m.companies.map((c) => c.companyId),
        roles: m.roles.map((r) => r.role.name),
      })),
    };
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
    }));
  }

  async revokeSession(userId: string, sessionId: string, currentToken: string) {
    const current = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(currentToken) },
    });
    if (current?.id === sessionId) {
      throw new AppException(
        'CANNOT_REVOKE_CURRENT', 'You cannot revoke your current session. Use logout.',
        'لا يمكنك إلغاء جلستك الحالية. استخدم تسجيل الخروج.', 400,
      );
    }
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw Errors.notFound('Session');
  }

  // ---------- password ----------

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentToken: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw Errors.invalidCredentials();
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    // Revoke all other sessions.
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: hashToken(currentToken) } },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({ actorId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId });
  }

  async requestPasswordReset(email: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'active') {
      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      // No SMTP in this environment: log the link server-side (documented).
      this.logger.warn(
        `Password reset link for ${email}: ${WEB_ORIGIN}/reset-password?token=${token}`,
      );
    }
    await this.audit.log({ action: 'auth.password_reset_requested', ip, diff: { email } });
  }

  async confirmPasswordReset(token: string, newPassword: string) {
    const rec = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) {
      throw Errors.invalidToken();
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: rec.userId },
        data: { passwordHash: await this.passwords.hash(newPassword), failedAttempts: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: rec.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: rec.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      actorId: rec.userId, action: 'auth.password_reset_completed',
      entityType: 'user', entityId: rec.userId,
    });
  }

  // ---------- MFA ----------

  async mfaSetup(userId: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const otpauthUrl = authenticator.keyuri(user.email, 'ATLAS ERP', secret);
    return { secret, otpauthUrl };
  }

  async mfaVerify(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret || !authenticator.check(code, user.mfaSecret)) {
      throw Errors.invalidTotp();
    }
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
    return { enabled: true };
  }

  async mfaDisable(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw Errors.invalidCredentials();
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_disabled', entityType: 'user', entityId: userId });
  }

  // ---------- invitations ----------

  async createInvitation(
    dto: InvitationCreateDto, organizationId: string, createdById: string, ip?: string,
  ) {
    // Validate roles: system roles or roles of this org.
    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== dto.roleIds.length) throw Errors.notFound('Role');
    for (const r of roles) {
      if (r.organizationId && r.organizationId !== organizationId) {
        throw Errors.forbidden();
      }
    }
    // Validate companies belong to the org.
    if (dto.companyIds?.length) {
      const count = await this.prisma.company.count({
        where: { id: { in: dto.companyIds }, organizationId },
      });
      if (count !== dto.companyIds.length) throw Errors.forbidden();
    }
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email: dto.email,
        tokenHash: hashToken(token),
        roleIds: dto.roleIds,
        companyIds: dto.companyIds ?? [],
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        createdById,
      },
    });
    this.logger.warn(
      `Invitation link for ${dto.email}: ${WEB_ORIGIN}/accept-invitation?token=${token}`,
    );
    await this.audit.log({
      organizationId, actorId: createdById, action: 'auth.invitation_created',
      entityType: 'invitation', entityId: invitation.id, ip,
      diff: { email: dto.email },
    });
    return { invitation: { ...invitation, tokenHash: undefined }, token };
  }

  async listInvitations(organizationId: string) {
    return this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }).then((rows) => rows.map((r) => ({ ...r, tokenHash: '[redacted]' })));
  }

  async acceptInvitation(dto: InvitationAcceptDto, ip?: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw Errors.invalidToken();
    }
    const existing = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (existing) throw Errors.duplicate('email');

    const passwordHash = await this.passwords.hash(dto.password);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: invitation.email, passwordHash, name: dto.name, status: 'active' },
      });
      const membership = await tx.membership.create({
        data: { userId: user.id, organizationId: invitation.organizationId, status: 'active' },
      });
      const roleIds = invitation.roleIds as string[];
      for (const roleId of roleIds) {
        await tx.userRole.create({ data: { membershipId: membership.id, roleId } });
      }
      const companyIds = invitation.companyIds as string[];
      for (const companyId of companyIds) {
        await tx.membershipCompany.create({ data: { membershipId: membership.id, companyId } });
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return { user };
    });

    await this.audit.log({
      organizationId: invitation.organizationId,
      actorId: result.user.id,
      action: 'auth.invitation_accepted',
      entityType: 'invitation',
      entityId: invitation.id,
      ip,
    });
    const { token, session } = await this.createSession(result.user.id, ip, undefined);
    return { token, expiresAt: session.expiresAt, user: this.toUserDto(result.user) };
  }

  private toUserDto(user: { id: string; email: string; name: string; status: string; mfaEnabled: boolean }) {
    return {
      id: user.id, email: user.email, name: user.name,
      status: user.status, mfaEnabled: user.mfaEnabled,
    };
  }
}
