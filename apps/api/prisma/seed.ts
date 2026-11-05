/**
 * ATLAS ERP seed — Phase 2 + Phase 3 (tax_code) + Phase 4 (master data).
 * Idempotent: safe to re-run. Seeds currencies, the full permission catalog,
 * and the 11 fixed system roles per PERMISSIONS_MATRIX.md.
 * (The 12th "role" in the spec is the per-organization Custom Role, created via API.)
 *
 * Phase 4: 'master_data' resource (categories, units, payment terms, document
 * sequences, attachments — gated by master_data:view / master_data:edit per the
 * web contract) plus 'deactivate'/'import' actions on customer, supplier,
 * product and master_data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// Minimal .env loader (no extra dependency for the seed script).
// Runs from apps/api, so .env is in the current working directory.
for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();

const ACTIONS = [
  'view', 'create', 'edit', 'delete_draft', 'submit',
  'approve', 'reject', 'post', 'reverse', 'export', 'manage',
] as const;

const RESOURCES = [
  'organization', 'company', 'branch', 'warehouse', 'user', 'role',
  'account', 'period', 'journal', 'tax_code', 'customer', 'supplier', 'product',
  'master_data',
  'quotation', 'sales_order', 'delivery', 'sales_invoice',
  'purchase_order', 'goods_receipt', 'supplier_bill', 'payment',
  'stock_transfer', 'stock_adjustment', 'bank_reconciliation',
  // Phase 5: inventory engine resources.
  'stock_movement', 'stock_balance', 'stock_reservation', 'inventory_count',
  'inventory_valuation',
  // Phase 6: sales credit notes.
  'credit_note',
  // Phase 7: purchasing requests.
  'purchase_request',
  // Phase 8: finance completion.
  'bank_statement', 'expense_bill',
  'report', 'audit', 'invitation',
  // Phase 9: notifications.
  'notification',
] as const;

const EXTRA_PERMS: Array<[string, string]> = [
  ['period', 'close'],
  ['period', 'reopen'],
  // Phase 4: soft-deactivation and CSV import actions on master-data resources.
  ['customer', 'deactivate'],
  ['customer', 'import'],
  ['supplier', 'deactivate'],
  ['supplier', 'import'],
  ['product', 'deactivate'],
  ['product', 'import'],
  ['master_data', 'deactivate'],
  ['master_data', 'import'],
];

type Grant = Record<string, string[]>; // resource -> actions; '*' = all actions
const ALL = [...ACTIONS];

const ROLES: Array<{ name: string; nameAr: string; grants: Grant | '*' }> = [
  { name: 'Platform Administrator', nameAr: 'مدير المنصة', grants: '*' },
  { name: 'Organization Owner', nameAr: 'مالك المنظمة', grants: '*' },
  {
    name: 'Company Administrator', nameAr: 'مدير الشركة',
    grants: {
      organization: ['view'],
      company: ALL, branch: ALL, warehouse: ALL,
      user: ALL, invitation: ALL,
      account: ALL, period: [...ALL, 'close', 'reopen'], journal: ALL, tax_code: ALL,
      customer: [...ALL, 'deactivate', 'import'], supplier: ['view'], product: ['view'],
      master_data: [...ALL, 'deactivate', 'import'],
      quotation: ['view'], sales_order: ['view'], delivery: ['view'], sales_invoice: ['view'],
      credit_note: ['view'],
      purchase_order: ['view', 'approve'], goods_receipt: ['view'], supplier_bill: ['view', 'approve'],
      purchase_request: ['view', 'approve'],
      payment: ['view'], stock_transfer: ['view'], stock_adjustment: ['view'],
      bank_reconciliation: ['view'], bank_statement: ['view'], expense_bill: ['view'],
      report: ['view', 'export'], notification: ['view'], audit: ['view'],
    },
  },
  {
    name: 'Finance Manager', nameAr: 'المدير المالي',
    grants: {
      company: ['view'], branch: ['view'], warehouse: ['view'],
      account: ALL, period: [...ALL, 'close', 'reopen'],
      journal: ALL, tax_code: ALL,
      customer: ['view'], supplier: ['view'], product: ['view'],
      master_data: ['view'],
      quotation: ['view'], sales_order: ['view'], sales_invoice: ['view', 'approve', 'post', 'export'],
      credit_note: ['view', 'approve', 'post', 'export'],
      purchase_order: ['view'], supplier_bill: ['view', 'approve', 'post', 'export'],
      purchase_request: ['view'],
      payment: ['view', 'approve', 'post', 'export'],
      bank_reconciliation: ALL, bank_statement: ALL, expense_bill: ALL,
      report: ALL, notification: ['view'], audit: ['view'],
      stock_movement: ['view'], stock_balance: ['view'], inventory_valuation: ['view'],
    },
  },
  {
    name: 'Accountant', nameAr: 'محاسب',
    grants: {
      account: ['view', 'create', 'edit'], period: ['view'],
      journal: ['view', 'create', 'edit', 'delete_draft', 'submit'], tax_code: ['view'],
      customer: ['view'], supplier: ['view'], product: ['view'],
      master_data: ['view'],
      sales_invoice: ['view', 'create', 'submit'], supplier_bill: ['view', 'create', 'submit'],
      purchase_request: ['view', 'create', 'submit'],
      credit_note: ['view', 'create', 'submit'],
      payment: ['view', 'create', 'submit'],
      bank_reconciliation: ['view', 'create', 'submit'],
      bank_statement: ['view', 'create', 'submit'], expense_bill: ['view', 'create', 'submit'],
      report: ['view', 'export'], notification: ['view'], audit: ['view'],
    },
  },
  {
    name: 'Sales Manager', nameAr: 'مدير المبيعات',
    grants: {
      customer: [...ALL, 'deactivate', 'import'],
      product: ['view', 'create', 'edit', 'deactivate', 'import', 'export'],
      master_data: ['view'],
      quotation: ALL, sales_order: ALL, delivery: ['view'], sales_invoice: ['view', 'approve'],
      credit_note: ['view', 'approve'],
      report: ['view', 'export'], notification: ['view'],
    },
  },
  {
    name: 'Sales Representative', nameAr: 'مندوب مبيعات',
    grants: {
      customer: ['view', 'create', 'edit'], product: ['view'],
      quotation: ['view', 'create', 'edit', 'submit'], sales_order: ['view', 'create', 'edit', 'submit'],
      delivery: ['view'], sales_invoice: ['view', 'create', 'submit'],
      credit_note: ['view', 'create', 'submit'],
      report: ['view'], notification: ['view'],
    },
  },
  {
    name: 'Purchasing Manager', nameAr: 'مدير المشتريات',
    grants: {
      supplier: [...ALL, 'deactivate', 'import'],
      product: ['view', 'create', 'edit', 'deactivate', 'import', 'export'],
      master_data: ['view'],
      purchase_order: ALL, purchase_request: ALL, goods_receipt: ['view'], supplier_bill: ['view', 'approve'],
      payment: ['view', 'create', 'submit'],
      report: ['view', 'export'], notification: ['view'],
    },
  },
  {
    name: 'Warehouse Manager', nameAr: 'مدير المخزن',
    grants: {
      product: ['view', 'create', 'edit', 'deactivate', 'import', 'export'],
      master_data: ['view', 'edit'],
      delivery: ['view', 'post'], goods_receipt: ALL,
      stock_transfer: ['view', 'create', 'submit', 'approve', 'post'],
      stock_adjustment: ['view', 'create', 'submit', 'approve', 'post'],
      stock_movement: ['view', 'create'], stock_balance: ['view'],
      stock_reservation: ['view', 'create'], inventory_count: ['view', 'create', 'submit', 'post'],
      inventory_valuation: ['view'],
      purchase_order: ['view'], purchase_request: ['view'],
      report: ['view', 'export'], notification: ['view'],
    },
  },
  {
    name: 'Warehouse Operator', nameAr: 'أمين مخزن',
    grants: {
      product: ['view'],
      master_data: ['view'],
      delivery: ['view', 'create', 'submit'], goods_receipt: ['view', 'create', 'submit'],
      stock_transfer: ['view', 'create', 'submit'], stock_adjustment: ['view', 'create', 'submit'],
      stock_movement: ['view', 'create'], stock_balance: ['view'],
      stock_reservation: ['view', 'create'], inventory_count: ['view', 'create', 'submit'],
      inventory_valuation: ['view'],
    },
  },
  {
    name: 'Auditor', nameAr: 'مراجع',
    grants: {
      organization: ['view'], company: ['view'], branch: ['view'], warehouse: ['view'],
      user: ['view'], role: ['view'],
      account: ['view'], period: ['view'], journal: ['view', 'export'], tax_code: ['view'],
      customer: ['view'], supplier: ['view'], product: ['view'],
      master_data: ['view'],
      quotation: ['view'], sales_order: ['view'], delivery: ['view'], sales_invoice: ['view'],
      credit_note: ['view'],
      purchase_order: ['view'], goods_receipt: ['view'], supplier_bill: ['view'],
      purchase_request: ['view'],
      payment: ['view'], stock_transfer: ['view'], stock_adjustment: ['view'],
      stock_movement: ['view'], stock_balance: ['view'], stock_reservation: ['view'],
      inventory_count: ['view'], inventory_valuation: ['view'],
      bank_reconciliation: ['view'], bank_statement: ['view'], expense_bill: ['view'],
      report: ['view', 'export'], notification: ['view'], audit: ['view', 'export'],
    },
  },
];

async function main() {
  // 1. Currencies
  for (const c of [
    { code: 'EGP', nameAr: 'جنيه مصري', nameEn: 'Egyptian Pound', decimals: 2 },
    { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar', decimals: 2 },
    { code: 'EUR', nameAr: 'يورو', nameEn: 'Euro', decimals: 2 },
    { code: 'SAR', nameAr: 'ريال سعودي', nameEn: 'Saudi Riyal', decimals: 2 },
  ]) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  // 1b. Account types (Phase 3 — global chart-of-accounts categories)
  for (const t of [
    { code: 'ASSET', nameAr: 'أصول', nameEn: 'Assets' },
    { code: 'LIABILITY', nameAr: 'التزامات', nameEn: 'Liabilities' },
    { code: 'EQUITY', nameAr: 'حقوق الملكية', nameEn: 'Equity' },
    { code: 'REVENUE', nameAr: 'إيرادات', nameEn: 'Revenue' },
    { code: 'EXPENSE', nameAr: 'مصروفات', nameEn: 'Expenses' },
  ]) {
    await prisma.accountType.upsert({ where: { code: t.code }, update: t, create: t });
  }

  // 2. Permission catalog
  const permId = new Map<string, string>();
  const allPerms: Array<[string, string]> = [
    ...RESOURCES.flatMap((r) => ACTIONS.map((a) => [r, a] as [string, string])),
    ...EXTRA_PERMS,
  ];
  for (const [resource, action] of allPerms) {
    const p = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    permId.set(`${resource}:${action}`, p.id);
  }

  // 3. System roles
  for (const r of ROLES) {
    let role = await prisma.role.findFirst({
      where: { name: r.name, isSystem: true, organizationId: null },
    });
    if (!role) {
      role = await prisma.role.create({
        data: { name: r.name, nameAr: r.nameAr, isSystem: true, organizationId: null },
      });
    }

    const wanted: string[] =
      r.grants === '*'
        ? [...permId.values()]
        : Object.entries(r.grants).flatMap(([res, acts]) =>
            acts.map((a) => {
              const id = permId.get(`${res}:${a}`);
              if (!id) throw new Error(`Unknown permission ${res}:${a}`);
              return id;
            }),
          );
    // Reconcile grants (idempotent)
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  const counts = {
    currencies: await prisma.currency.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count({ where: { isSystem: true } }),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
