import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { IDEMPOTENT_KEY } from '../decorators';
import { AppException } from '../errors';

/**
 * Generic idempotency for POST endpoints marked @Idempotent().
 * The client sends Idempotency-Key; replays within 24h return the original
 * status + body instead of executing again. Keys are scoped per user.
 *
 * Race-safe: a placeholder row is inserted BEFORE the handler runs, so a
 * retry that arrives while the first request is still processing (or right
 * after it responded but before the async write finished) sees the key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const idempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (!idempotent || req.method !== 'POST') return next.handle();

    const key = req.headers['idempotency-key'];
    const userId = req.user?.id;
    if (typeof key !== 'string' || key.length < 8 || key.length > 100 || !userId) {
      return next.handle(); // key optional; without it the request just executes
    }

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    // Try to claim the key first (placeholder with status 0 = in-flight).
    try {
      await this.prisma.idempotencyKey.create({
        data: { key, userId, status: 0, body: {}, expiresAt },
      });
    } catch {
      // Key already claimed: replay if completed, else report conflict.
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });
      if (
        existing &&
        existing.userId === userId &&
        existing.expiresAt.getTime() > Date.now() &&
        existing.status >= 200 &&
        existing.status < 300
      ) {
        res.status(existing.status);
        return of(existing.body);
      }
      throw new AppException(
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this idempotency key is already in progress.',
        'طلب بنفس المفتاح قيد التنفيذ بالفعل.',
        409,
      );
    }

    return next.handle().pipe(
      tap({
        next: async (body) => {
          const status = res.statusCode;
          if (status >= 200 && status < 300) {
            await this.prisma.idempotencyKey
              .update({
                where: { key },
                data: { status, body: (body ?? null) as object, expiresAt },
              })
              .catch(() => undefined);
          } else {
            // Non-2xx: release the key so the client can retry.
            await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
          }
        },
        error: async () => {
          await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
        },
      }),
    );
  }
}
