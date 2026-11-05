import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AccountingModule } from '../accounting/accounting.module';
import { MasterdataModule } from '../masterdata/masterdata.module';

@Module({
  imports: [AccountingModule, MasterdataModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
