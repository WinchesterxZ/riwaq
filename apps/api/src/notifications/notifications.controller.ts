import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationService } from './notifications.service';
import { Secured } from '../common/decorators';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Secured('notification:view')
  @Get()
  list(@Query('page') page: string, @Query('per_page') perPage: string, @Req() req: Request) {
    return this.notifications.list(
      req.user!.id,
      req.orgContext!.organizationId,
      Math.max(1, parseInt(page ?? '1', 10) || 1),
      Math.min(100, Math.max(1, parseInt(perPage ?? '20', 10) || 20)),
    );
  }

  @Secured('notification:view')
  @Get('unread-count')
  unreadCount(@Req() req: Request) {
    return this.notifications.unreadCount(req.user!.id, req.orgContext!.organizationId);
  }

  @Secured('notification:view')
  @Post(':id/read')
  markRead(@Param('id') id: string, @Req() req: Request) {
    return this.notifications.markRead(req.user!.id, req.orgContext!.organizationId, id);
  }

  @Secured('notification:view')
  @Post('read-all')
  markAllRead(@Req() req: Request) {
    return this.notifications.markAllRead(req.user!.id, req.orgContext!.organizationId);
  }
}
