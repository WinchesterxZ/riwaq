import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, ReportsService],
  exports: [AccountingService, ReportsService],
})
export class AccountingModule {}
