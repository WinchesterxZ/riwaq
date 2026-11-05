import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { PdfDocumentsService } from './pdf-documents.service';
import { SalesModule } from '../sales/sales.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [SalesModule, PurchasingModule, AccountingModule],
  controllers: [PdfController],
  providers: [PdfService, PdfDocumentsService],
  exports: [PdfService, PdfDocumentsService],
})
export class PdfModule {}
