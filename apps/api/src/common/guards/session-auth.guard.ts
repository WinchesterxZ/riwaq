import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators';
import { Errors } from '../errors';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Validates the HttpOnly session cookie against DB sessions. */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.['atlas_session'];
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Not authenticated.');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now() ||
      session.user.status !== 'active'
    ) {
      throw new UnauthorizedException('Session expired.');
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      mfaEnabled: session.user.mfaEnabled,
    };
    return true;
  }
}
