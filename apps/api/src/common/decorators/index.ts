import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../guards/session-auth.guard';
import { CsrfGuard } from '../guards/csrf.guard';
import { OrgScopeGuard } from '../guards/org-scope.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const IDEMPOTENT_KEY = 'idempotent';
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

/** Authenticated (session + CSRF), no org scope needed. */
export const Authed = () =>
  applyDecorators(UseGuards(SessionAuthGuard, CsrfGuard));

/**
 * Authenticated + org-scoped + permission-checked.
 * Guards run in order: session → CSRF → org scope → permissions.
 */
export const Secured = (...permissions: string[]) =>
  applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(SessionAuthGuard, CsrfGuard, OrgScopeGuard, PermissionsGuard),
  );
