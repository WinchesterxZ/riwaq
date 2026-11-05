import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Standard Egyptian chart of accounts (ACCOUNTING_RULES.md §1).
 * 5 summary parents (non-postable) + 13 postable leaves. Per company,
 * configurable afterwards — the seed is a starting point, not a straitjacket.
 */

export type DbClient = PrismaClient | Prisma.TransactionClient;

interface SeedAccount {
  code: string;
  nameAr: string;
  nameEn: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentCode?: string;
  isPostable: boolean;
}

export const STANDARD_COA: SeedAccount[] = [
  // Summary parents (non-postable)
  { code: '1000', nameAr: 'الأصول', nameEn: 'Assets', type: 'ASSET', isPostable: false },
  { code: '2000', nameAr: 'الالتزامات', nameEn: 'Liabilities', type: 'LIABILITY', isPostable: false },
  { code: '3000', nameAr: 'حقوق الملكية', nameEn: 'Equity', type: 'EQUITY', isPostable: false },
  { code: '4000', nameAr: 'الإيرادات', nameEn: 'Revenue', type: 'REVENUE', isPostable: false },
  { code: '5000', nameAr: 'المصروفات', nameEn: 'Expenses', type: 'EXPENSE', isPostable: false },
  // Leaves (postable)
  { code: '1100', nameAr: 'النقدية بالخزينة', nameEn: 'Cash on hand', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '1110', nameAr: 'البنك - حساب جارٍ', nameEn: 'Bank — current account', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '1210', nameAr: 'العملاء', nameEn: 'Accounts receivable — customers', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '1230', nameAr: 'ضريبة القيمة المضافة - مدخلات', nameEn: 'Input VAT', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '1310', nameAr: 'المخزون', nameEn: 'Inventory on hand', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '1320', nameAr: 'بضاعة مستلمة غير مفوترة', nameEn: 'Goods received not invoiced (GRNI)', type: 'ASSET', parentCode: '1000', isPostable: true },
  { code: '2110', nameAr: 'الموردون', nameEn: 'Accounts payable — suppliers', type: 'LIABILITY', parentCode: '2000', isPostable: true },
  { code: '2120', nameAr: 'ضريبة القيمة المضافة - مخرجات', nameEn: 'Output VAT', type: 'LIABILITY', parentCode: '2000', isPostable: true },
  { code: '3010', nameAr: 'رأس المال', nameEn: 'Capital', type: 'EQUITY', parentCode: '3000', isPostable: true },
  { code: '3020', nameAr: 'الأرباح المحتجزة', nameEn: 'Retained earnings', type: 'EQUITY', parentCode: '3000', isPostable: true },
  { code: '4110', nameAr: 'إيرادات المبيعات', nameEn: 'Sales revenue', type: 'REVENUE', parentCode: '4000', isPostable: true },
  { code: '5110', nameAr: 'تكلفة البضاعة المباعة', nameEn: 'Cost of goods sold', type: 'EXPENSE', parentCode: '5000', isPostable: true },
  { code: '5210', nameAr: 'مصروفات عمومية وإدارية', nameEn: 'General & administrative expenses', type: 'EXPENSE', parentCode: '5000', isPostable: true },
  { code: '5390', nameAr: 'تسويات وفروق المخزون', nameEn: 'Inventory adjustments and variances', type: 'EXPENSE', parentCode: '5000', isPostable: true },
];

export interface CoaSeedResult {
  /** true when the company already had accounts and nothing was created */
  skipped: boolean;
  created: number;
}

/**
 * Idempotent standard CoA seed for one company.
 * Skips entirely when the company already has any accounts (never merges into
 * a customized chart). Safe to call on every company creation.
 */
export async function seedChartOfAccounts(
  db: DbClient,
  companyId: string,
  createdById?: string,
): Promise<CoaSeedResult> {
  const existing = await db.account.count({ where: { companyId } });
  if (existing > 0) return { skipped: true, created: 0 };

  const types = await db.accountType.findMany();
  const typeId = new Map(types.map((t) => [t.code, t.id]));
  for (const t of ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) {
    if (!typeId.has(t)) throw new Error(`Account type ${t} not seeded. Run the base seed first.`);
  }

  const idByCode = new Map<string, string>();
  let created = 0;
  // Parents first (no parentCode), then leaves.
  for (const pass of [STANDARD_COA.filter((a) => !a.parentCode), STANDARD_COA.filter((a) => a.parentCode)]) {
    for (const a of pass) {
      const account = await db.account.create({
        data: {
          companyId,
          code: a.code,
          nameAr: a.nameAr,
          nameEn: a.nameEn,
          accountTypeId: typeId.get(a.type)!,
          parentId: a.parentCode ? idByCode.get(a.parentCode) ?? null : null,
          isPostable: a.isPostable,
          isActive: true,
          createdById: createdById ?? null,
        },
      });
      idByCode.set(a.code, account.id);
      created += 1;
    }
  }
  return { skipped: false, created };
}
