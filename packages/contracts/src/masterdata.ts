import { z } from 'zod';
import { moneyInputSchema } from './accounting';

/**
 * Phase 4 master-data contracts (customers, suppliers, contacts, addresses,
 * product categories, units of measure, conversions, payment terms, products,
 * variants, document sequences, attachments, CSV import/export).
 * Conventions: snake_case keys, UUIDs, money as decimal strings, dates ISO.
 */

const uuidSchema = z.string().uuid();

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
};

const statusSchema = z.enum(['active', 'inactive']);
const kindSchema = z.enum(['individual', 'company']);
const ownerTypeSchema = z.enum(['customer', 'supplier']);
const attachmentOwnerTypeSchema = z.enum(['customer', 'supplier', 'product']);

// ---------- payment terms ----------

export const paymentTermCreateSchema = z.object({
  company_id: uuidSchema,
  name_ar: z.string().min(1).max(120),
  name_en: z.string().min(1).max(120),
  days: z.coerce.number().int().min(0).max(3650),
  is_active: z.boolean().default(true),
});
export type PaymentTermCreateDto = z.infer<typeof paymentTermCreateSchema>;

export const paymentTermUpdateSchema = z.object({
  name_ar: z.string().min(1).max(120).optional(),
  name_en: z.string().min(1).max(120).optional(),
  days: z.coerce.number().int().min(0).max(3650).optional(),
  is_active: z.boolean().optional(),
});
export type PaymentTermUpdateDto = z.infer<typeof paymentTermUpdateSchema>;

export const paymentTermListQuerySchema = z.object({
  company_id: uuidSchema,
  is_active: z.coerce.boolean().optional(),
  ...pageQuery,
});
export type PaymentTermListQuery = z.infer<typeof paymentTermListQuerySchema>;

// ---------- parties (customers / suppliers) ----------

const partyCreateBase = {
  company_id: uuidSchema,
  name_ar: z.string().min(1).max(160),
  name_en: z.string().min(1).max(160),
  kind: kindSchema.default('company'),
  tax_id: z.string().max(60).nullable().optional(),
  payment_term_id: uuidSchema.nullable().optional(),
  credit_limit: moneyInputSchema.nullable().optional(),
  salesperson_id: uuidSchema.nullable().optional(),
};

export const customerCreateSchema = z.object(partyCreateBase);
export type CustomerCreateDto = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = z.object({
  name_ar: z.string().min(1).max(160).optional(),
  name_en: z.string().min(1).max(160).optional(),
  kind: kindSchema.optional(),
  tax_id: z.string().max(60).nullable().optional(),
  payment_term_id: uuidSchema.nullable().optional(),
  credit_limit: moneyInputSchema.nullable().optional(),
  salesperson_id: uuidSchema.nullable().optional(),
  status: statusSchema.optional(),
});
export type CustomerUpdateDto = z.infer<typeof customerUpdateSchema>;

export const customerListQuerySchema = z.object({
  company_id: uuidSchema,
  search: z.string().max(120).optional(),
  status: statusSchema.optional(),
  ...pageQuery,
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const supplierCreateSchema = z.object({
  ...partyCreateBase,
  default_currency: z.string().length(3).nullable().optional(),
});
export type SupplierCreateDto = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = z.object({
  ...customerUpdateSchema.shape,
  default_currency: z.string().length(3).nullable().optional(),
});
export type SupplierUpdateDto = z.infer<typeof supplierUpdateSchema>;

export const supplierListQuerySchema = customerListQuerySchema;
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

// ---------- contacts & addresses ----------

export const contactCreateSchema = z.object({
  name: z.string().min(1).max(160),
  role: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  is_primary: z.boolean().default(false),
});
export type ContactCreateDto = z.infer<typeof contactCreateSchema>;

export const addressCreateSchema = z.object({
  label: z.string().max(80).nullable().optional(),
  line1: z.string().min(1).max(255),
  line2: z.string().max(255).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  is_billing: z.boolean().default(false),
  is_shipping: z.boolean().default(false),
});
export type AddressCreateDto = z.infer<typeof addressCreateSchema>;

// ---------- product categories ----------

export const productCategoryCreateSchema = z.object({
  company_id: uuidSchema,
  name_ar: z.string().min(1).max(160),
  name_en: z.string().min(1).max(160),
  parent_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().default(true),
});
export type ProductCategoryCreateDto = z.infer<typeof productCategoryCreateSchema>;

export const productCategoryUpdateSchema = z.object({
  name_ar: z.string().min(1).max(160).optional(),
  name_en: z.string().min(1).max(160).optional(),
  parent_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
});
export type ProductCategoryUpdateDto = z.infer<typeof productCategoryUpdateSchema>;

export const productCategoryListQuerySchema = z.object({
  company_id: uuidSchema,
  is_active: z.coerce.boolean().optional(),
});
export type ProductCategoryListQuery = z.infer<typeof productCategoryListQuerySchema>;

// ---------- units of measure ----------

export const unitOfMeasureCreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters, digits or underscores.'),
  name_ar: z.string().min(1).max(80),
  name_en: z.string().min(1).max(80),
  is_active: z.boolean().default(true),
});
export type UnitOfMeasureCreateDto = z.infer<typeof unitOfMeasureCreateSchema>;

export const unitOfMeasureUpdateSchema = z.object({
  name_ar: z.string().min(1).max(80).optional(),
  name_en: z.string().min(1).max(80).optional(),
  is_active: z.boolean().optional(),
});
export type UnitOfMeasureUpdateDto = z.infer<typeof unitOfMeasureUpdateSchema>;

export const unitConversionCreateSchema = z.object({
  from_uom_id: uuidSchema,
  to_uom_id: uuidSchema,
  factor: moneyInputSchema,
}).refine((d) => d.from_uom_id !== d.to_uom_id, {
  message: 'A unit cannot convert to itself.',
});
export type UnitConversionCreateDto = z.infer<typeof unitConversionCreateSchema>;

// ---------- products ----------

export const productTypeSchema = z.enum(['stocked', 'non_stock', 'service']);

export const productCreateSchema = z.object({
  company_id: uuidSchema,
  sku: z.string().min(1).max(60),
  name_ar: z.string().min(1).max(200),
  name_en: z.string().min(1).max(200),
  type: productTypeSchema.default('stocked'),
  category_id: uuidSchema.nullable().optional(),
  base_uom_id: uuidSchema,
  purchase_price: moneyInputSchema.nullable().optional(),
  sales_price: moneyInputSchema.nullable().optional(),
  tax_code_id: uuidSchema.nullable().optional(),
  reorder_level: moneyInputSchema.nullable().optional(),
  preferred_supplier_id: uuidSchema.nullable().optional(),
  inventory_account_id: uuidSchema.nullable().optional(),
  cogs_account_id: uuidSchema.nullable().optional(),
  revenue_account_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().default(true),
});
export type ProductCreateDto = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  sku: z.string().min(1).max(60).optional(),
  name_ar: z.string().min(1).max(200).optional(),
  name_en: z.string().min(1).max(200).optional(),
  type: productTypeSchema.optional(),
  category_id: uuidSchema.nullable().optional(),
  base_uom_id: uuidSchema.optional(),
  purchase_price: moneyInputSchema.nullable().optional(),
  sales_price: moneyInputSchema.nullable().optional(),
  tax_code_id: uuidSchema.nullable().optional(),
  reorder_level: moneyInputSchema.nullable().optional(),
  preferred_supplier_id: uuidSchema.nullable().optional(),
  inventory_account_id: uuidSchema.nullable().optional(),
  cogs_account_id: uuidSchema.nullable().optional(),
  revenue_account_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
});
export type ProductUpdateDto = z.infer<typeof productUpdateSchema>;

export const productSortSchema = z.enum([
  'name', '-name', 'sku', '-sku', 'created_desc', 'created_asc',
]);

export const productListQuerySchema = z.object({
  company_id: uuidSchema,
  search: z.string().max(120).optional(),
  type: productTypeSchema.optional(),
  category_id: uuidSchema.optional(),
  status: statusSchema.optional(),
  sort: productSortSchema.default('created_desc'),
  ...pageQuery,
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// ---------- product variants ----------

export const productVariantCreateSchema = z.object({
  sku: z.string().min(1).max(60),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  is_active: z.boolean().default(true),
});
export type ProductVariantCreateDto = z.infer<typeof productVariantCreateSchema>;

export const productVariantUpdateSchema = z.object({
  sku: z.string().min(1).max(60).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  is_active: z.boolean().optional(),
});
export type ProductVariantUpdateDto = z.infer<typeof productVariantUpdateSchema>;

// ---------- document sequences ----------

export const resetPolicySchema = z.enum(['never', 'yearly']);

export const documentSequenceCreateSchema = z.object({
  company_id: uuidSchema,
  document_type: z.string().min(1).max(60),
  prefix: z.string().min(1).max(20),
  next_number: z.coerce.number().int().min(1).default(1),
  reset_policy: resetPolicySchema.default('never'),
});
export type DocumentSequenceCreateDto = z.infer<typeof documentSequenceCreateSchema>;

export const documentSequenceUpdateSchema = z.object({
  prefix: z.string().min(1).max(20).optional(),
  next_number: z.coerce.number().int().min(1).optional(),
  reset_policy: resetPolicySchema.optional(),
});
export type DocumentSequenceUpdateDto = z.infer<typeof documentSequenceUpdateSchema>;

export const documentSequenceListQuerySchema = z.object({
  company_id: uuidSchema,
  document_type: z.string().max(60).optional(),
});
export type DocumentSequenceListQuery = z.infer<typeof documentSequenceListQuerySchema>;

export const documentSequencePreviewQuerySchema = z.object({
  company_id: uuidSchema,
  document_type: z.string().min(1).max(60),
});
export type DocumentSequencePreviewQuery = z.infer<typeof documentSequencePreviewQuerySchema>;

// ---------- attachments ----------

export const attachmentUploadBodySchema = z.object({
  owner_type: attachmentOwnerTypeSchema,
  owner_id: uuidSchema,
});
export type AttachmentUploadBody = z.infer<typeof attachmentUploadBodySchema>;

export const attachmentListQuerySchema = z.object({
  owner_type: attachmentOwnerTypeSchema,
  owner_id: uuidSchema,
  ...pageQuery,
});
export type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;

// ---------- CSV import ----------

export const csvImportQuerySchema = z.object({
  company_id: uuidSchema,
});
export type CsvImportQuery = z.infer<typeof csvImportQuerySchema>;

export const csvExportQuerySchema = z.object({
  company_id: uuidSchema,
});
export type CsvExportQuery = z.infer<typeof csvExportQuerySchema>;

export { ownerTypeSchema };
