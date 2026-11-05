import {
  ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get,
  Header, HttpCode, Param, Patch, Post, Query, Req, Res, UploadedFile,
  UseFilters, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage, MulterError } from 'multer';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { MasterdataService } from './masterdata.service';
import { maxUploadMb, UploadedFile as StoredFile } from './storage';
import { Secured, Idempotent } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Errors } from '../common/errors';
import {
  customerCreateSchema, customerListQuerySchema, customerUpdateSchema,
  supplierCreateSchema, supplierListQuerySchema, supplierUpdateSchema,
  contactCreateSchema, addressCreateSchema,
  paymentTermCreateSchema, paymentTermListQuerySchema, paymentTermUpdateSchema,
  productCategoryCreateSchema, productCategoryListQuerySchema, productCategoryUpdateSchema,
  unitOfMeasureCreateSchema, unitOfMeasureUpdateSchema, unitConversionCreateSchema,
  productCreateSchema, productListQuerySchema, productUpdateSchema,
  productVariantCreateSchema, productVariantUpdateSchema,
  documentSequenceCreateSchema, documentSequenceListQuerySchema, documentSequencePreviewQuerySchema,
  documentSequenceUpdateSchema,
  attachmentUploadBodySchema, attachmentListQuerySchema,
  csvImportQuerySchema, csvExportQuerySchema,
} from '@atlas-erp/contracts';

/**
 * Maps multer's LIMIT_FILE_SIZE to the bilingual 413 envelope.
 * Everything else is rethrown for the global filter.
 */
@Catch(MulterError)
class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    if (exception.code !== 'LIMIT_FILE_SIZE') throw exception;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const appEx = Errors.attachmentTooLarge(maxUploadMb());
    res.status(appEx.getStatus()).json({
      code: appEx.code,
      message: appEx.message,
      message_ar: appEx.messageAr,
      details: appEx.details,
      correlation_id: req.correlationId ?? 'req_unknown',
    });
  }
}

const uploadInterceptor = (field = 'file') =>
  UseInterceptors(FileInterceptor(field, {
    storage: memoryStorage(),
    limits: { fileSize: maxUploadMb() * 1024 * 1024 },
  }));

@ApiTags('masterdata')
@Controller()
@UseFilters(MulterExceptionFilter)
export class MasterdataController {
  constructor(private readonly masterdata: MasterdataService) {}

  // ---------- customers ----------

  @Secured('customer:view')
  @Get('customers')
  listCustomers(@Query(new ZodValidationPipe(customerListQuerySchema)) q: never, @Req() req: Request) {
    return this.masterdata.listParties(req.orgContext!, 'customer', q as never);
  }

  @Secured('customer:create')
  @Idempotent()
  @Post('customers')
  async createCustomer(
    @Body(new ZodValidationPipe(customerCreateSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.masterdata.createParty(req.orgContext!, 'customer', body as never, req.user!.id, req.ip);
    res.status(201);
    return result;
  }

  @Secured('customer:export')
  @Get('customers/export')
  async exportCustomers(
    @Query(new ZodValidationPipe(csvExportQuerySchema)) q: { company_id: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.masterdata.exportParties(req.orgContext!, 'customer', q.company_id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Secured('customer:import')
  @Post('customers/import')
  @HttpCode(200)
  @uploadInterceptor()
  importCustomers(
    @Query(new ZodValidationPipe(csvImportQuerySchema)) q: { company_id: string },
    @UploadedFile() file: StoredFile | undefined,
    @Req() req: Request,
  ) {
    return this.masterdata.importParties(req.orgContext!, 'customer', q.company_id, file?.buffer as Buffer, req.user!.id, req.ip);
  }

  @Secured('customer:view')
  @Get('customers/:id')
  getCustomer(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.getParty(req.orgContext!, 'customer', id);
  }

  @Secured('customer:edit')
  @Patch('customers/:id')
  updateCustomer(@Param('id') id: string, @Body(new ZodValidationPipe(customerUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateParty(req.orgContext!, 'customer', id, body as never, req.user!.id, req.ip);
  }

  @Secured('customer:deactivate')
  @Post('customers/:id/deactivate')
  @HttpCode(200)
  deactivateCustomer(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deactivateParty(req.orgContext!, 'customer', id, req.user!.id, req.ip);
  }

  @Secured('customer:view')
  @Get('customers/:id/contacts')
  listCustomerContacts(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.listContacts(req.orgContext!, 'customer', id);
  }

  @Secured('customer:edit')
  @Post('customers/:id/contacts')
  createCustomerContact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contactCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.createContact(req.orgContext!, 'customer', id, body as never, req.user!.id, req.ip);
  }

  @Secured('customer:edit')
  @Delete('customers/:id/contacts/:contactId')
  deleteCustomerContact(@Param('id') id: string, @Param('contactId') contactId: string, @Req() req: Request) {
    return this.masterdata.deleteContact(req.orgContext!, 'customer', id, contactId, req.user!.id, req.ip);
  }

  @Secured('customer:view')
  @Get('customers/:id/addresses')
  listCustomerAddresses(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.listAddresses(req.orgContext!, 'customer', id);
  }

  @Secured('customer:edit')
  @Post('customers/:id/addresses')
  createCustomerAddress(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addressCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.createAddress(req.orgContext!, 'customer', id, body as never, req.user!.id, req.ip);
  }

  @Secured('customer:edit')
  @Delete('customers/:id/addresses/:addressId')
  deleteCustomerAddress(@Param('id') id: string, @Param('addressId') addressId: string, @Req() req: Request) {
    return this.masterdata.deleteAddress(req.orgContext!, 'customer', id, addressId, req.user!.id, req.ip);
  }

  // ---------- suppliers ----------

  @Secured('supplier:view')
  @Get('suppliers')
  listSuppliers(@Query(new ZodValidationPipe(supplierListQuerySchema)) q: never, @Req() req: Request) {
    return this.masterdata.listParties(req.orgContext!, 'supplier', q as never);
  }

  @Secured('supplier:create')
  @Idempotent()
  @Post('suppliers')
  async createSupplier(
    @Body(new ZodValidationPipe(supplierCreateSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.masterdata.createParty(req.orgContext!, 'supplier', body as never, req.user!.id, req.ip);
    res.status(201);
    return result;
  }

  @Secured('supplier:export')
  @Get('suppliers/export')
  async exportSuppliers(
    @Query(new ZodValidationPipe(csvExportQuerySchema)) q: { company_id: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.masterdata.exportParties(req.orgContext!, 'supplier', q.company_id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Secured('supplier:import')
  @Post('suppliers/import')
  @HttpCode(200)
  @uploadInterceptor()
  importSuppliers(
    @Query(new ZodValidationPipe(csvImportQuerySchema)) q: { company_id: string },
    @UploadedFile() file: StoredFile | undefined,
    @Req() req: Request,
  ) {
    return this.masterdata.importParties(req.orgContext!, 'supplier', q.company_id, file?.buffer as Buffer, req.user!.id, req.ip);
  }

  @Secured('supplier:view')
  @Get('suppliers/:id')
  getSupplier(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.getParty(req.orgContext!, 'supplier', id);
  }

  @Secured('supplier:edit')
  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body(new ZodValidationPipe(supplierUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateParty(req.orgContext!, 'supplier', id, body as never, req.user!.id, req.ip);
  }

  @Secured('supplier:deactivate')
  @Post('suppliers/:id/deactivate')
  @HttpCode(200)
  deactivateSupplier(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deactivateParty(req.orgContext!, 'supplier', id, req.user!.id, req.ip);
  }

  @Secured('supplier:view')
  @Get('suppliers/:id/contacts')
  listSupplierContacts(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.listContacts(req.orgContext!, 'supplier', id);
  }

  @Secured('supplier:edit')
  @Post('suppliers/:id/contacts')
  createSupplierContact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contactCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.createContact(req.orgContext!, 'supplier', id, body as never, req.user!.id, req.ip);
  }

  @Secured('supplier:edit')
  @Delete('suppliers/:id/contacts/:contactId')
  deleteSupplierContact(@Param('id') id: string, @Param('contactId') contactId: string, @Req() req: Request) {
    return this.masterdata.deleteContact(req.orgContext!, 'supplier', id, contactId, req.user!.id, req.ip);
  }

  @Secured('supplier:view')
  @Get('suppliers/:id/addresses')
  listSupplierAddresses(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.listAddresses(req.orgContext!, 'supplier', id);
  }

  @Secured('supplier:edit')
  @Post('suppliers/:id/addresses')
  createSupplierAddress(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addressCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.createAddress(req.orgContext!, 'supplier', id, body as never, req.user!.id, req.ip);
  }

  @Secured('supplier:edit')
  @Delete('suppliers/:id/addresses/:addressId')
  deleteSupplierAddress(@Param('id') id: string, @Param('addressId') addressId: string, @Req() req: Request) {
    return this.masterdata.deleteAddress(req.orgContext!, 'supplier', id, addressId, req.user!.id, req.ip);
  }

  // ---------- product categories ----------

  @Secured('master_data:view')
  @Get('product-categories')
  listCategories(@Query(new ZodValidationPipe(productCategoryListQuerySchema)) q: { company_id: string; is_active?: boolean }, @Req() req: Request) {
    return this.masterdata.listCategories(req.orgContext!, q.company_id, q.is_active);
  }

  @Secured('master_data:edit')
  @Post('product-categories')
  createCategory(@Body(new ZodValidationPipe(productCategoryCreateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.createCategory(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Patch('product-categories/:id')
  updateCategory(@Param('id') id: string, @Body(new ZodValidationPipe(productCategoryUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateCategory(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Post('product-categories/:id/deactivate')
  @HttpCode(200)
  deactivateCategory(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deactivateCategory(req.orgContext!, id, req.user!.id, req.ip);
  }

  // ---------- units of measure ----------

  @Secured('master_data:view')
  @Get('units-of-measure')
  listUnits() {
    return this.masterdata.listUnits();
  }

  @Secured('master_data:edit')
  @Post('units-of-measure')
  createUnit(@Body(new ZodValidationPipe(unitOfMeasureCreateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.createUnit(body as never, req.orgContext!, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Patch('units-of-measure/:id')
  updateUnit(@Param('id') id: string, @Body(new ZodValidationPipe(unitOfMeasureUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateUnit(id, body as never, req.orgContext!, req.user!.id, req.ip);
  }

  @Secured('master_data:view')
  @Get('unit-conversions')
  listConversions() {
    return this.masterdata.listConversions();
  }

  @Secured('master_data:edit')
  @Post('unit-conversions')
  createConversion(@Body(new ZodValidationPipe(unitConversionCreateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.createConversion(body as never, req.orgContext!, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Delete('unit-conversions/:id')
  deleteConversion(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deleteConversion(id, req.orgContext!, req.user!.id, req.ip);
  }

  // ---------- payment terms ----------

  @Secured('master_data:view')
  @Get('payment-terms')
  listPaymentTerms(@Query(new ZodValidationPipe(paymentTermListQuerySchema)) q: never, @Req() req: Request) {
    return this.masterdata.listPaymentTerms(req.orgContext!, q as never);
  }

  @Secured('master_data:edit')
  @Post('payment-terms')
  createPaymentTerm(@Body(new ZodValidationPipe(paymentTermCreateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.createPaymentTerm(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Patch('payment-terms/:id')
  updatePaymentTerm(@Param('id') id: string, @Body(new ZodValidationPipe(paymentTermUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updatePaymentTerm(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Post('payment-terms/:id/deactivate')
  @HttpCode(200)
  deactivatePaymentTerm(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deactivatePaymentTerm(req.orgContext!, id, req.user!.id, req.ip);
  }

  // ---------- products ----------

  @Secured('product:view')
  @Get('products')
  listProducts(@Query(new ZodValidationPipe(productListQuerySchema)) q: never, @Req() req: Request) {
    return this.masterdata.listProducts(req.orgContext!, q as never);
  }

  @Secured('product:create')
  @Idempotent()
  @Post('products')
  async createProduct(
    @Body(new ZodValidationPipe(productCreateSchema)) body: never,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const product = await this.masterdata.createProduct(req.orgContext!, body as never, req.user!.id, req.ip);
    res.status(201);
    return product;
  }

  @Secured('product:export')
  @Get('products/export')
  async exportProducts(
    @Query(new ZodValidationPipe(csvExportQuerySchema)) q: { company_id: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.masterdata.exportProducts(req.orgContext!, q.company_id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Secured('product:import')
  @Post('products/import')
  @HttpCode(200)
  @uploadInterceptor()
  importProducts(
    @Query(new ZodValidationPipe(csvImportQuerySchema)) q: { company_id: string },
    @UploadedFile() file: StoredFile | undefined,
    @Req() req: Request,
  ) {
    return this.masterdata.importProducts(req.orgContext!, q.company_id, file?.buffer as Buffer, req.user!.id, req.ip);
  }

  @Secured('product:view')
  @Get('products/:id/variants')
  listVariants(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.listVariants(req.orgContext!, id);
  }

  @Secured('product:edit')
  @Post('products/:id/variants')
  createVariant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productVariantCreateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.createVariant(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('product:edit')
  @Patch('products/:id/variants/:variantId')
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(productVariantUpdateSchema)) body: never,
    @Req() req: Request,
  ) {
    return this.masterdata.updateVariant(req.orgContext!, id, variantId, body as never, req.user!.id, req.ip);
  }

  @Secured('product:edit')
  @Delete('products/:id/variants/:variantId')
  deleteVariant(@Param('id') id: string, @Param('variantId') variantId: string, @Req() req: Request) {
    return this.masterdata.deleteVariant(req.orgContext!, id, variantId, req.user!.id, req.ip);
  }

  @Secured('product:view')
  @Get('products/:id')
  getProduct(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.getProduct(req.orgContext!, id);
  }

  @Secured('product:edit')
  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body(new ZodValidationPipe(productUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateProduct(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  @Secured('product:deactivate')
  @Post('products/:id/deactivate')
  @HttpCode(200)
  deactivateProduct(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deactivateProduct(req.orgContext!, id, req.user!.id, req.ip);
  }

  // ---------- document sequences ----------

  @Secured('master_data:view')
  @Get('document-sequences/preview')
  previewSequence(
    @Query(new ZodValidationPipe(documentSequencePreviewQuerySchema)) q: { company_id: string; document_type: string },
    @Req() req: Request,
  ) {
    return this.masterdata.previewSequence(req.orgContext!, q.company_id, q.document_type);
  }

  @Secured('master_data:view')
  @Get('document-sequences')
  listSequences(@Query(new ZodValidationPipe(documentSequenceListQuerySchema)) q: never, @Req() req: Request) {
    return this.masterdata.listSequences(req.orgContext!, q as never);
  }

  @Secured('master_data:edit')
  @Post('document-sequences')
  createSequence(@Body(new ZodValidationPipe(documentSequenceCreateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.createSequence(req.orgContext!, body as never, req.user!.id, req.ip);
  }

  @Secured('master_data:edit')
  @Patch('document-sequences/:id')
  updateSequence(@Param('id') id: string, @Body(new ZodValidationPipe(documentSequenceUpdateSchema)) body: never, @Req() req: Request) {
    return this.masterdata.updateSequence(req.orgContext!, id, body as never, req.user!.id, req.ip);
  }

  // ---------- attachments ----------

  @Secured('master_data:edit')
  @Post('attachments')
  @HttpCode(201)
  @uploadInterceptor()
  uploadAttachment(
    @Body(new ZodValidationPipe(attachmentUploadBodySchema)) body: { owner_type: 'customer' | 'supplier' | 'product'; owner_id: string },
    @UploadedFile() file: StoredFile | undefined,
    @Req() req: Request,
  ) {
    return this.masterdata.uploadAttachment(req.orgContext!, body.owner_type, body.owner_id, file, req.user!.id, req.ip);
  }

  @Secured('master_data:view')
  @Get('attachments')
  listAttachments(
    @Query(new ZodValidationPipe(attachmentListQuerySchema)) q: never,
    @Req() req: Request,
  ) {
    const { owner_type, owner_id, page, per_page } = q as unknown as {
      owner_type: 'customer' | 'supplier' | 'product'; owner_id: string; page: number; per_page: number;
    };
    return this.masterdata.listAttachments(req.orgContext!, owner_type, owner_id, { page, per_page });
  }

  @Secured('master_data:view')
  @Get('attachments/:id/download')
  async downloadAttachment(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const file = await this.masterdata.downloadAttachment(req.orgContext!, id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    const disposition = this.masterdata.inlineDisposition(file.mime) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    this.masterdata.attachmentStream(file.path).pipe(res);
  }

  @Secured('master_data:edit')
  @Delete('attachments/:id')
  deleteAttachment(@Param('id') id: string, @Req() req: Request) {
    return this.masterdata.deleteAttachment(req.orgContext!, id, req.user!.id, req.ip);
  }
}
