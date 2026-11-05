import { Module } from '@nestjs/common';
import { MasterdataController } from './masterdata.controller';
import { MasterdataService } from './masterdata.service';
import { NumberingService } from './numbering';

@Module({
  controllers: [MasterdataController],
  providers: [MasterdataService, NumberingService],
  // NumberingService is the clean interface future sales/purchasing phases
  // reuse for invoices, orders, payments, ...
  exports: [MasterdataService, NumberingService],
})
export class MasterdataModule {}
