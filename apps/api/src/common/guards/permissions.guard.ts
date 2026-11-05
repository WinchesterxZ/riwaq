import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators';
import { Errors } from '../errors';

/** Enforces resource×action permissions server-side from @RequirePermissions metadata. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const granted = new Set(req.orgContext?.permissions ?? []);
    // Platform-wide wildcard for full-access roles.
    const ok = required.every((p) => granted.has(p));
    if (!ok) throw Errors.forbidden();
    return true;
  }
}
