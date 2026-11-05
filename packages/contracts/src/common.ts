import { z } from 'zod';

/** Standard bilingual error envelope (ARCHITECTURE.md §5). */
export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  message_ar: z.string(),
  details: z.unknown().nullable(),
  correlation_id: z.string(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().max(100).optional(),
  /** Alias for `q` (used by the web client). */
  search: z.string().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const auditQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().max(80).optional(),
  action: z.string().max(120).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}

export const uuidSchema = z.string().uuid();
