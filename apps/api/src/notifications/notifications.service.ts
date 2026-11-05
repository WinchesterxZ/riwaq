import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pageMeta } from '../common/pagination';

export interface NotifyInput {
  organizationId: string;
  userId: string;
  type: string;
  titleAr: string;
  titleEn: string;
  bodyAr?: string;
  bodyEn?: string;
  link?: string;
}

const dto = (n: any) => ({
  id: n.id,
  type: n.type,
  title_ar: n.title_ar,
  title_en: n.title_en,
  body_ar: n.body_ar,
  body_en: n.body_en,
  link: n.link,
  read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
  created_at: new Date(n.created_at).toISOString(),
});

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a notification. Accepts an optional transaction client for atomic emit. */
  async notify(tx: any, input: NotifyInput) {
    const rows: any[] = await tx.$queryRaw`
      INSERT INTO notifications (id, organization_id, user_id, type, title_ar, title_en, body_ar, body_en, link)
      VALUES (gen_random_uuid(), ${input.organizationId}::uuid, ${input.userId}::uuid, ${input.type},
              ${input.titleAr}, ${input.titleEn}, ${input.bodyAr ?? null}, ${input.bodyEn ?? null}, ${input.link ?? null})
      RETURNING id, type, title_ar, title_en, body_ar, body_en, link, read_at, created_at`;
    return dto(rows[0]);
  }

  /** Notify every active user in the org holding a given permission (resource:action). */
  async notifyPermissionHolders(
    tx: any,
    organizationId: string,
    resource: string,
    action: string,
    input: Omit<NotifyInput, 'organizationId' | 'userId'>,
    excludeUserId?: string,
  ): Promise<number> {
    const holders = await tx.userRole.findMany({
      where: {
        role: {
          OR: [{ organizationId }, { organizationId: null }],
          permissions: { some: { permission: { resource, action } } },
        },
        membership: { organizationId, user: { status: 'active' } },
      },
      select: { membership: { select: { userId: true } } },
      distinct: ['membershipId'],
    });
    const userIds: string[] = [...new Set<string>(holders.map((h: any) => h.membership.userId))].filter(
      (id) => id !== excludeUserId,
    );
    for (const userId of userIds) {
      await this.notify(tx, { ...input, organizationId, userId });
    }
    return userIds.length;
  }

  async list(userId: string, organizationId: string, page = 1, perPage = 20) {
    const total: any[] = await this.prisma.$queryRaw`
      SELECT COUNT(*)::int AS c FROM notifications
      WHERE user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid`;
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT id, type, title_ar, title_en, body_ar, body_en, link, read_at, created_at
      FROM notifications
      WHERE user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid
      ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;
    return { data: rows.map(dto), meta: pageMeta(total[0]?.c ?? 0, page, perPage) };
  }

  async unreadCount(userId: string, organizationId: string) {
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT COUNT(*)::int AS c FROM notifications
      WHERE user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid AND read_at IS NULL`;
    return { count: rows[0]?.c ?? 0 };
  }

  async markRead(userId: string, organizationId: string, id: string) {
    const rows: any[] = await this.prisma.$queryRaw`
      UPDATE notifications SET read_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid
      RETURNING id, type, title_ar, title_en, body_ar, body_en, link, read_at, created_at`;
    if (!rows.length) {
      const { Errors } = await import('../common/errors');
      throw Errors.notFound('Notification');
    }
    return dto(rows[0]);
  }

  async markAllRead(userId: string, organizationId: string) {
    const rows: any[] = await this.prisma.$queryRaw`
      UPDATE notifications SET read_at = now()
      WHERE user_id = ${userId}::uuid AND organization_id = ${organizationId}::uuid AND read_at IS NULL
      RETURNING id`;
    return { marked: rows.length };
  }
}
