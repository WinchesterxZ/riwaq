import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Secured } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { auditQuerySchema, AuditQuery } from '@atlas-erp/contracts';
import { pageMeta } from '../common/pagination';

@ApiTags('audit')
@Controller('audit-events')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Secured('audit:view')
  @Get()
  async list(
    @Req() req: Request,
    @Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery,
  ) {
    const orgId = req.orgContext!.organizationId;
    const term = q.search ?? q.q;
    const ci = { contains: '', mode: 'insensitive' as const };
    const where = {
      organizationId: orgId,
      ...(term ? { action: { ...ci, contains: term } } : {}),
      ...(q.entityType ? { entityType: { ...ci, contains: q.entityType } } : {}),
      ...(q.action ? { action: { ...ci, contains: q.action } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { data, meta: pageMeta(total, q.page, q.per_page) };
  }
}
