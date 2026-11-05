import { z } from 'zod';

export const emailSchema = z.string().email().max(255).toLowerCase();
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128);

export const firstRunSchema = z.object({
  organizationName: z.string().min(2).max(120),
  organizationNameAr: z.string().min(2).max(120),
  adminName: z.string().min(2).max(120),
  adminEmail: emailSchema,
  password: passwordSchema,
});
export type FirstRunDto = z.infer<typeof firstRunSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: passwordSchema,
});

export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const mfaDisableSchema = z.object({ password: z.string().min(1).max(128) });

export const invitationCreateSchema = z.object({
  email: emailSchema,
  roleIds: z.array(z.string().uuid()).min(1).max(10),
  companyIds: z.array(z.string().uuid()).max(20).optional(),
});
export type InvitationCreateDto = z.infer<typeof invitationCreateSchema>;

export const invitationAcceptSchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().min(2).max(120),
  password: passwordSchema,
});
export type InvitationAcceptDto = z.infer<typeof invitationAcceptSchema>;

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  status: string;
  mfaEnabled: boolean;
}

export interface MembershipDto {
  organizationId: string;
  organizationName: string;
  organizationNameAr: string;
  status: string;
  companyIds: string[];
  roles: string[];
}
