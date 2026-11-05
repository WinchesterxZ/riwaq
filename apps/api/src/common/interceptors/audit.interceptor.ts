import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

const SECRET_KEYS = new Set([
  'password', 'currentPassword', 'newPassword', 'totpCode',
  'token', 'secret', 'mfaSecret',
]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k) ? '[redacted]' : sanitize(v);
    }
    return out;
  }
  return value;
}

/**
 * Writes an append-only audit event for every mutating request.
 * Never throws: audit failure must not break the business operation.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next.handle();
    }
    // Auth endpoints log their own security events; skip generic capture there
    // except login/logout which are security-relevant.
    return next.handle().pipe(
      tap({
        next: () => this.record(req).catch(() => undefined),
        error: () => undefined,
      }),
    );
  }

  private async record(req: Request): Promise<void> {
    const path = req.route?.path ?? req.path;
    const entityType = this.entityTypeOf(path);
    const body = req.body as Record<string, unknown> | undefined;
    let entityId: string | undefined;
    const params = req.params as Record<string, string>;
    if (params?.id) entityId = params.id;

    await this.prisma.auditEvent.create({
      data: {
        organizationId: req.orgContext?.organizationId ?? null,
        actorId: req.user?.id ?? null,
        action: `${req.method} ${path}`,
        entityType,
        entityId: entityId ?? null,
        diff: body ? (sanitize(body) as object) : undefined,
        ip: req.ip,
      },
    });
  }

  private entityTypeOf(path: string): string | null {
    const m = path.match(/\/api\/v1\/([a-zA-Z0-9/_-]+)/);
    if (!m) return null;
    // Drop UUIDs and sub-action segments; keep the most specific resource name.
    const skip = new Set([
      'status', 'submit', 'approve', 'reject', 'post', 'reverse', 'accept',
      'request', 'confirm', 'setup', 'verify', 'disable',
    ]);
    const segments = m[1]
      .split('/')
      .filter((s) => s && !/^[0-9a-f]{8}-[0-9a-f]{4}/.test(s) && !skip.has(s));
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }
}
