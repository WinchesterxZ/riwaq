import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { AccountingModule } from '../accounting/accounting.module';
import { MasterdataModule } from '../masterdata/masterdata.module';

@Module({
  imports: [AccountingModule, MasterdataModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
