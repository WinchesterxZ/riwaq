import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators';
import { Errors } from '../errors';

/** Double-submit CSRF: X-CSRF-Token header must match the atlas_csrf cookie. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const cookie = req.cookies?.['atlas_csrf'];
    const header = req.headers['x-csrf-token'];
    if (
      typeof cookie !== 'string' ||
      typeof header !== 'string' ||
      cookie.length === 0 ||
      !safeEqual(cookie, header)
    ) {
      throw Errors.csrfInvalid();
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
