import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Document numbering for Phase 4 master data — and the clean interface that
 * future sales/purchasing phases will reuse for invoices, orders, etc.
 *
 * Concurrency: allocation runs in a single transaction that does
 *   INSERT ... ON CONFLICT DO NOTHING
 *   SELECT ... FOR UPDATE
 * so parallel requests serialize on the sequence row and numbers can never
 * collide. Pure helpers (format/pad, yearly-reset decision) are exported for
 * unit testing without a database.
 */

/** Default prefixes for on-demand sequences (document_type -> prefix). */
export const DOCUMENT_PREFIXES: Record<string, string> = {
  customer: 'CUST-',
  supplier: 'SUP-',
  product: 'PRD-',
  sales_order: 'SO-',
  purchase_order: 'PO-',
  sales_invoice: 'INV-',
  supplier_bill: 'BILL-',
  payment: 'PAY-',
  // Phase 6: sales lifecycle
  quotation: 'QUOT-',
  delivery: 'DEL-',
  sales_payment: 'SPAY-',
  credit_note: 'CN-',
  inventory_transfer: 'TR-',
  inventory_adjustment: 'ADJ-',
  inventory_count: 'CNT-',
  // Phase 7: purchasing
  purchase_request: 'PR-',
  rfq: 'RFQ-',
  goods_receipt: 'GRN-',
  supplier_payment: 'PPAY-',
};

export const DEFAULT_PREFIX = 'DOC-';
export const NUMBER_WIDTH = 6;

export function prefixFor(documentType: string): string {
  return DOCUMENT_PREFIXES[documentType] ?? DEFAULT_PREFIX;
}

/** Format PREFIX + zero-padded 6 digits, e.g. CUST-000042. */
export function formatSequenceNumber(prefix: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid sequence number: ${n}`);
  }
  return `${prefix}${String(n).padStart(NUMBER_WIDTH, '0')}`;
}

export interface SequenceState {
  nextNumber: number;
  resetPolicy: string; // 'never' | 'yearly'
  lastResetYear: number | null;
}

/**
 * Decide which number to hand out (and the new stored state) without touching
 * the DB. When resetPolicy is 'yearly' and the stored lastResetYear differs
 * from the current year, numbering restarts at 1 and the year is recorded.
 */
export function resolveNextNumber(
  state: SequenceState,
  year: number,
): { next: number; lastResetYear: number | null } {
  if (state.resetPolicy === 'yearly' && state.lastResetYear !== year) {
    return { next: 1, lastResetYear: year };
  }
  return { next: state.nextNumber, lastResetYear: state.lastResetYear };
}

export interface SequencePreview {
  document_type: string;
  prefix: string;
  next_number: number;
  preview: string;
  reset_policy: string;
  last_reset_year: number | null;
}

interface SequenceRow {
  id: string;
  prefix: string;
  next_number: number;
  reset_policy: string;
  last_reset_year: number | null;
}

@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocate the next number for (companyId, documentType).
   * Creates the sequence row on demand; serializes concurrent callers with
   * SELECT ... FOR UPDATE so numbers are unique even under parallel load.
   */
  async nextNumber(companyId: string, documentType: string): Promise<string> {
    const { prefix, next } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO document_sequences (id, company_id, document_type, prefix, next_number, reset_policy)
        VALUES (gen_random_uuid(), ${companyId}::uuid, ${documentType}, ${prefixFor(documentType)}, 1, 'never')
        ON CONFLICT (company_id, document_type) DO NOTHING`;
      const rows = await tx.$queryRaw<SequenceRow[]>`
        SELECT id, prefix, next_number, reset_policy, last_reset_year
        FROM document_sequences
        WHERE company_id = ${companyId}::uuid AND document_type = ${documentType}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new Error('Sequence row missing after upsert');
      const year = new Date().getUTCFullYear();
      const { next, lastResetYear } = resolveNextNumber(
        { nextNumber: row.next_number, resetPolicy: row.reset_policy, lastResetYear: row.last_reset_year },
        year,
      );
      await tx.$executeRaw`
        UPDATE document_sequences
        SET next_number = ${next + 1}, last_reset_year = ${lastResetYear}
        WHERE id = ${row.id}::uuid`;
      return { prefix: row.prefix, next };
    });
    return formatSequenceNumber(prefix, next);
  }

  /** Read-only preview of the next number (does not allocate). */
  async preview(companyId: string, documentType: string): Promise<SequencePreview> {
    const row = await this.prisma.documentSequence.findUnique({
      where: { companyId_documentType: { companyId, documentType } },
    });
    const year = new Date().getUTCFullYear();
    if (!row) {
      const prefix = prefixFor(documentType);
      return {
        document_type: documentType,
        prefix,
        next_number: 1,
        preview: formatSequenceNumber(prefix, 1),
        reset_policy: 'never',
        last_reset_year: null,
      };
    }
    const { next, lastResetYear } = resolveNextNumber(
      { nextNumber: row.nextNumber, resetPolicy: row.resetPolicy, lastResetYear: row.lastResetYear },
      year,
    );
    return {
      document_type: row.documentType,
      prefix: row.prefix,
      next_number: next,
      preview: formatSequenceNumber(row.prefix, next),
      reset_policy: row.resetPolicy,
      last_reset_year: lastResetYear,
    };
  }
}
