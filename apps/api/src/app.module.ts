import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CorrelationModule } from './common/correlation.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { OrgScopeGuard } from './common/guards/org-scope.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { OrgModule } from './organization/org.module';
import { AccountingModule } from './accounting/accounting.module';
import { MasterdataModule } from './masterdata/masterdata.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { FinanceModule } from './finance/finance.module';
import { AuditModule } from './audit/audit.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PdfModule } from './pdf/pdf.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }] }),
    CorrelationModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    RbacModule,
    OrgModule,
    AccountingModule,
    MasterdataModule,
    InventoryModule,
    SalesModule,
    PurchasingModule,
    FinanceModule,
    NotificationsModule,
    PdfModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Guards are also provided here so they can be injected; route-level
    // @UseGuards (via @Authed/@Secured) controls where they run.
    SessionAuthGuard,
    CsrfGuard,
    OrgScopeGuard,
    PermissionsGuard,
  ],
})
export class AppModule {}
