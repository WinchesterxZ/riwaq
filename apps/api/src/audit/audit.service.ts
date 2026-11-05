import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  diff?: object | null;
  ip?: string | null;
}

/** Append-only audit log. No update/delete API exists by design. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          organizationId: input.organizationId ?? null,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          diff: (input.diff ?? undefined) as object | undefined,
          ip: input.ip ?? null,
        },
      });
    } catch {
      // Audit must never break business operations.
    }
  }
}
