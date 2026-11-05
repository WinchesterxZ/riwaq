import { z } from 'zod';

export const organizationCreateSchema = z.object({
  name: z.string().min(2).max(120),
  nameAr: z.string().min(2).max(120),
  defaultCurrency: z.string().length(3).default('EGP'),
  defaultTimezone: z.string().max(60).default('Africa/Cairo'),
});
export type OrganizationCreateDto = z.infer<typeof organizationCreateSchema>;

export const companyCreateSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(2).max(120),
  nameAr: z.string().min(2).max(120),
  baseCurrency: z.string().length(3).default('EGP'),
  taxId: z.string().max(60).optional(),
});
export type CompanyCreateDto = z.infer<typeof companyCreateSchema>;

export const branchCreateSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  nameAr: z.string().min(2).max(120),
});
export type BranchCreateDto = z.infer<typeof branchCreateSchema>;

export const warehouseCreateSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(2).max(120),
  nameAr: z.string().min(2).max(120),
});
export type WarehouseCreateDto = z.infer<typeof warehouseCreateSchema>;

export const userStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

export const roleCreateSchema = z.object({
  name: z.string().min(2).max(120),
  nameAr: z.string().min(2).max(120),
  permissionIds: z.array(z.string().uuid()).min(1).max(300),
});
export type RoleCreateDto = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  nameAr: z.string().min(2).max(120).optional(),
  permissionIds: z.array(z.string().uuid()).min(1).max(300).optional(),
});
export type RoleUpdateDto = z.infer<typeof roleUpdateSchema>;
