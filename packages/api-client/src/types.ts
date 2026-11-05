/**
 * DTOs for the Phase 2 API contract (frozen). Fields follow the contract;
 * optional fields reflect what the contract leaves unspecified.
 */

export type UserStatus = "active" | "inactive";

export interface User {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleRef {
  id: string;
  name: string;
  nameAr: string;
}

export interface CompanyRef {
  id: string;
  name: string;
  nameAr: string;
}

export interface OrganizationRef {
  id: string;
  name: string;
  nameAr: string;
  defaultCurrency: string;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationNameAr: string;
  status: string;
  companyIds: string[];
  roles: string[];
}

export interface MeResponse {
  user: User;
  memberships: Membership[];
}

export interface Organization {
  id: string;
  name: string;
  nameAr: string;
  defaultCurrency: string;
  createdAt: string;
}

export interface Company {
  id: string;
  organizationId: string;
  name: string;
  nameAr: string;
  baseCurrency: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  companyId: string;
  name: string;
  nameAr: string;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  branchId: string;
  name: string;
  nameAr: string;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  nameAr: string;
  isSystem: boolean;
  /** Permission names, e.g. "users:view". */
  permissions: string[];
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
}

export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface DashboardSummary {
  users: number;
  companies: number;
  branches: number;
  warehouses: number;
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
}

export interface PageMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

/* ---------- request / response payloads ---------- */

export interface FirstRunInput {
  organizationName: string;
  organizationNameAr: string;
  adminName: string;
  adminEmail: string;
  password: string;
}

export interface FirstRunResult {
  user: User;
  organization: Organization;
}

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string;
}

export interface LoginResult {
  user: User;
  mfaRequired?: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
}

export interface CreateOrganizationInput {
  name: string;
  nameAr: string;
  defaultCurrency?: string;
}

export interface CreateCompanyInput {
  organizationId: string;
  name: string;
  nameAr: string;
  baseCurrency: string;
}

export interface CreateBranchInput {
  companyId: string;
  name: string;
  nameAr: string;
}

export interface CreateWarehouseInput {
  branchId: string;
  name: string;
  nameAr: string;
}

export interface CreateRoleInput {
  name: string;
  nameAr: string;
  permissionIds: string[];
}

export interface UpdateRoleInput {
  name?: string;
  nameAr?: string;
  permissionIds?: string[];
}

export interface CreateInvitationInput {
  email: string;
  roleIds: string[];
  companyIds?: string[];
}

export interface CreateInvitationResult {
  invitation: Invitation;
  token: string;
}

export interface AcceptInvitationInput {
  token: string;
  name: string;
  password: string;
}

/* ---------- accounting (Phase 3) ---------- */

/** Fixed account type codes (no /account-types endpoint in the contract). */
export type AccountTypeCode = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface AccountTypeRef {
  code: string;
  name_ar: string;
  name_en: string;
}

export interface Account {
  id: string;
  company_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  account_type: AccountTypeRef;
  parent_id: string | null;
  is_postable: boolean;
  is_active: boolean;
}

export interface CreateAccountInput {
  company_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  account_type_id: string;
  parent_id?: string | null;
  is_postable?: boolean;
  description?: string;
}

export interface UpdateAccountInput {
  name_ar?: string;
  name_en?: string;
  description?: string;
  is_postable?: boolean;
}

export interface FiscalYear {
  id: string;
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface CreateFiscalYearInput {
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export type AccountingPeriodStatus = "open" | "closed" | "locked";

export interface AccountingPeriod {
  id: string;
  fiscal_year_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: AccountingPeriodStatus;
}

export type JournalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "posted"
  | "reversed";

export interface JournalLine {
  id: string;
  account_id: string;
  account: { code: string; name_ar: string; name_en: string };
  debit: string | number;
  credit: string | number;
  description?: string | null;
}

export interface JournalEntry {
  id: string;
  posting_date: string;
  description: string;
  status: JournalStatus;
  currency: string;
  lines: JournalLine[];
  total_debit: string | number;
  total_credit: string | number;
  version: number;
}

export interface JournalLineInput {
  account_id: string;
  debit: string | number;
  credit: string | number;
  description?: string;
}

export interface CreateJournalEntryInput {
  company_id: string;
  posting_date: string;
  description: string;
  lines: JournalLineInput[];
  currency?: string;
  idempotency_key?: string;
}

export interface UpdateJournalEntryInput {
  posting_date?: string;
  description?: string;
  currency?: string;
  lines?: JournalLineInput[];
  version?: number;
}

export interface ListJournalEntriesParams {
  company_id: string;
  status?: JournalStatus | "";
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface TaxCode {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string;
  rate: string | number;
  type: string;
  tax_account_id?: string | null;
  is_active: boolean;
}

export interface CreateTaxCodeInput {
  company_id: string;
  name_ar: string;
  name_en: string;
  rate: string | number;
  type: string;
  tax_account_id?: string | null;
}

export interface UpdateTaxCodeInput {
  name_ar?: string;
  name_en?: string;
  rate?: string | number;
  type?: string;
  tax_account_id?: string | null;
}

export interface TrialBalanceLine {
  account_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  total_debit: string | number;
  total_credit: string | number;
}

export interface TrialBalance {
  lines: TrialBalanceLine[];
  total_debit: string | number;
  total_credit: string | number;
  balanced: boolean;
}

/* ---------- Phase 8: finance reports, bank reconciliation, expense bills ---------- */

export type Money = string | number;

export interface FinanceDashboard {
  company_id: string;
  as_of: string;
  currency: string;
  revenue_mtd: Money;
  revenue_ytd: Money;
  gross_margin_pct_mtd: Money;
  gross_margin_pct_ytd: Money;
  ar_total: Money;
  ap_total: Money;
  bank_balance: Money;
  overdue_ar: Money;
  overdue_ap: Money;
  net_profit_ytd: Money;
}

export interface GeneralLedgerLine {
  posting_date: string;
  journal_id: string;
  journal_type: string;
  description: string;
  source_type: string | null;
  source_id: string | null;
  debit: Money;
  credit: Money;
  running_balance: Money;
}

export interface GeneralLedgerAccount {
  account_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  type: string;
  opening_balance: Money;
  lines: GeneralLedgerLine[];
  total_debit: Money;
  total_credit: Money;
  closing_balance: Money;
}

export interface GeneralLedger {
  company_id: string;
  from: string;
  to: string;
  currency: string;
  accounts: GeneralLedgerAccount[];
}

export interface BalanceSheetLine {
  code: string;
  name_ar: string;
  name_en: string;
  balance: Money;
}

export interface BalanceSheet {
  company_id: string;
  as_of: string;
  currency: string;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  total_assets: Money;
  total_liabilities: Money;
  total_equity: Money;
  balanced: boolean;
}

export interface ProfitLossLine {
  code: string;
  name_ar: string;
  name_en: string;
  balance: Money;
}

export interface ProfitLoss {
  company_id: string;
  from: string;
  to: string;
  currency: string;
  revenue_lines: ProfitLossLine[];
  total_revenue: Money;
  cogs: Money;
  gross_profit: Money;
  expense_lines: ProfitLossLine[];
  total_expenses: Money;
  net_profit: Money;
}

export interface CashFlow {
  company_id: string;
  from: string;
  to: string;
  currency: string;
  net_profit: Money;
  adjustments: {
    change_in_receivables: Money;
    change_in_inventory: Money;
    change_in_grni: Money;
    change_in_input_vat: Money;
    change_in_payables: Money;
    change_in_output_vat: Money;
  };
  operating_cash_flow: Money;
  investing_cash_flow: Money;
  financing_cash_flow: Money;
  net_change_in_cash: Money;
  cash_movement_per_gl: Money;
  reconciles: boolean;
}

export interface AgingBucketLines {
  current: Money;
  d1_30: Money;
  d31_60: Money;
  d61_90: Money;
  d90_plus: Money;
}

export interface AgingLine {
  id: string;
  number: string;
  party_id: string;
  party_name_ar: string;
  party_name_en: string;
  doc_date: string;
  due_date: string;
  days_overdue: number;
  bucket: keyof AgingBucketLines;
  outstanding: Money;
}

export interface AgingReport {
  company_id: string;
  as_of: string;
  currency: string;
  buckets: AgingBucketLines;
  total: Money;
  lines: AgingLine[];
}

export interface VatReport {
  company_id: string;
  from: string;
  to: string;
  currency: string;
  input_vat_1230: Money;
  output_vat_2120: Money;
  net_vat_payable: Money;
}

export type BankStatementStatus = "draft" | "posted";

export interface BankStatement {
  id: string;
  number: string;
  status: BankStatementStatus;
  account_id: string;
  account_code: string;
  statement_date: string;
  opening_balance: Money;
  closing_balance: Money;
  lines_count: number;
}

export interface BankStatementLine {
  id: string;
  line_no: number;
  value_date: string;
  description: string;
  reference: string | null;
  amount: Money;
  reconciled_entry_id: string | null;
  reconciled_at: string | null;
}

export interface BankStatementDetail {
  id: string;
  number: string;
  status: BankStatementStatus;
  account_id: string;
  account_code: string;
  statement_date: string;
  opening_balance: Money;
  closing_balance: Money;
  notes: string | null;
  matched_lines: number;
  total_lines: number;
  lines: BankStatementLine[];
}

export interface CreateBankStatementLineInput {
  value_date: string;
  description: string;
  reference?: string;
  amount: string;
}

export interface CreateBankStatementInput {
  company_id: string;
  account_id: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  notes?: string;
  lines: CreateBankStatementLineInput[];
}

export interface ListBankStatementsParams {
  company_id: string;
  account_id?: string;
  status?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface OutstandingUnmatchedLine {
  id: string;
  line_no: number;
  value_date: string;
  description: string;
  reference: string | null;
  amount: Money;
}

export interface OutstandingGlLine {
  journal_entry_id: string;
  posting_date: string;
  description: string;
  source_type: string | null;
  amount: Money;
}

export interface OutstandingItems {
  statement_id: string;
  number: string;
  unmatched_statement_lines: OutstandingUnmatchedLine[];
  unmatched_gl_lines: OutstandingGlLine[];
}

export type ExpenseBillStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "posted";

export interface ExpenseBill {
  id: string;
  number: string;
  status: ExpenseBillStatus;
  bill_date: string;
  total: Money;
  outstanding: Money;
  pay_from: "supplier" | "bank" | "cash";
}

export interface ExpenseBillLine {
  id: string;
  account_id: string;
  account_code: string;
  description: string;
  quantity: Money;
  unit_price: Money;
  tax_rate: Money;
  line_total: Money;
  tax_amount: Money;
}

export interface ExpenseBillDetail {
  id: string;
  number: string;
  status: ExpenseBillStatus;
  supplier_id: string | null;
  supplier_name: string | null;
  bill_date: string;
  due_date: string | null;
  subtotal: Money;
  tax_total: Money;
  total: Money;
  paid_total: Money;
  outstanding: Money;
  pay_from: "supplier" | "bank" | "cash";
  bank_account_id: string | null;
  journal_entry_id: string | null;
  notes: string | null;
  lines: ExpenseBillLine[];
}

export interface CreateExpenseBillLineInput {
  account_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
}

export interface CreateExpenseBillInput {
  company_id: string;
  supplier_id?: string | null;
  bill_date: string;
  due_date?: string | null;
  pay_from: "supplier" | "bank" | "cash";
  bank_account_id?: string | null;
  notes?: string;
  lines: CreateExpenseBillLineInput[];
}

export interface ListExpenseBillsParams {
  company_id: string;
  status?: string;
  supplier_id?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface ListAuditEventsParams {
  page?: number;
  per_page?: number;
  entityType?: string;
  action?: string;
  [key: string]: unknown;
}

export interface ListUsersParams {
  page?: number;
  per_page?: number;
  search?: string;
  [key: string]: unknown;
}

/* ---------- shared master data (Phase 4) ---------- */

/** Idempotent-create envelope: POST returns 201 { data, warnings[] }. */
export interface CreateResult<T> {
  data: T;
  warnings: string[];
}

export type PartyKind = "individual" | "company";

export interface PartyBase {
  id: string;
  company_id: string;
  number: string;
  name_ar: string;
  name_en: string;
  kind: PartyKind;
  tax_id?: string | null;
  credit_limit?: string | number | null;
  status: "active" | "inactive";
}

export interface Customer extends PartyBase {}

export interface Supplier extends PartyBase {
  default_currency?: string | null;
}

export interface CreateCustomerInput {
  company_id: string;
  number?: string;
  name_ar: string;
  name_en: string;
  kind: PartyKind;
  tax_id?: string | null;
  credit_limit?: string | null;
}

export interface UpdateCustomerInput {
  name_ar?: string;
  name_en?: string;
  kind?: PartyKind;
  tax_id?: string | null;
  credit_limit?: string | null;
}

export interface CreateSupplierInput extends CreateCustomerInput {
  default_currency?: string | null;
}

export interface UpdateSupplierInput extends UpdateCustomerInput {
  default_currency?: string | null;
}

export interface ListPartiesParams {
  company_id: string;
  search?: string;
  status?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface PartyContact {
  id: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CreatePartyContactInput {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

export interface PartyAddress {
  id: string;
  label?: string | null;
  line1: string;
  city?: string | null;
  country?: string | null;
}

export interface CreatePartyAddressInput {
  label?: string;
  line1: string;
  city?: string;
  country?: string;
}

/* ---------- product categories ---------- */

export interface ProductCategory {
  id: string;
  company_id: string;
  code?: string | null;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_active: boolean;
  children?: ProductCategory[];
}

export interface CreateProductCategoryInput {
  company_id: string;
  code?: string;
  name_ar: string;
  name_en: string;
  parent_id?: string | null;
}

export interface UpdateProductCategoryInput {
  code?: string;
  name_ar?: string;
  name_en?: string;
  parent_id?: string | null;
}

/* ---------- units of measure ---------- */

export interface UnitOfMeasure {
  id: string;
  company_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}

export interface CreateUnitOfMeasureInput {
  company_id: string;
  code: string;
  name_ar: string;
  name_en: string;
}

export interface UpdateUnitOfMeasureInput {
  code?: string;
  name_ar?: string;
  name_en?: string;
}

export interface UnitConversion {
  id: string;
  from_uom: Pick<UnitOfMeasure, "id" | "code" | "name_ar" | "name_en">;
  to_uom: Pick<UnitOfMeasure, "id" | "code" | "name_ar" | "name_en">;
  factor: string | number;
}

export interface CreateUnitConversionInput {
  from_uom_id: string;
  to_uom_id: string;
  factor: string | number;
}

/* ---------- payment terms ---------- */

export interface PaymentTerm {
  id: string;
  company_id: string;
  name_ar: string;
  name_en: string;
  days: number;
  is_active: boolean;
}

export interface CreatePaymentTermInput {
  company_id: string;
  name_ar: string;
  name_en: string;
  days: number;
}

export interface UpdatePaymentTermInput {
  name_ar?: string;
  name_en?: string;
  days?: number;
}

/* ---------- products ---------- */

export type ProductType = "stocked" | "non_stock" | "service";

export interface Product {
  id: string;
  company_id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  type: ProductType;
  category_id?: string | null;
  base_uom_id: string;
  purchase_price?: string | number | null;
  sales_price?: string | number | null;
  tax_code_id?: string | null;
  reorder_level?: string | number | null;
  preferred_supplier_id?: string | null;
  inventory_account_id?: string | null;
  cogs_account_id?: string | null;
  revenue_account_id?: string | null;
  is_active: boolean;
}

export interface CreateProductInput {
  company_id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  type: ProductType;
  category_id?: string | null;
  base_uom_id: string;
  purchase_price?: string | null;
  sales_price?: string | null;
  tax_code_id?: string | null;
  reorder_level?: string | null;
  preferred_supplier_id?: string | null;
  inventory_account_id?: string | null;
  cogs_account_id?: string | null;
  revenue_account_id?: string | null;
}

export interface UpdateProductInput {
  name_ar?: string;
  name_en?: string;
  type?: ProductType;
  category_id?: string | null;
  base_uom_id?: string;
  purchase_price?: string | null;
  sales_price?: string | null;
  tax_code_id?: string | null;
  reorder_level?: string | null;
  preferred_supplier_id?: string | null;
  inventory_account_id?: string | null;
  cogs_account_id?: string | null;
  revenue_account_id?: string | null;
}

export interface ListProductsParams {
  company_id: string;
  search?: string;
  type?: string;
  category_id?: string;
  status?: string;
  page?: number;
  per_page?: number;
  sort?: string;
  [key: string]: unknown;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  attributes: Record<string, string>;
}

export interface CreateProductVariantInput {
  sku: string;
  attributes?: Record<string, string>;
}

export interface UpdateProductVariantInput {
  sku?: string;
  attributes?: Record<string, string>;
}

/* ---------- document sequences ---------- */

export interface DocumentSequence {
  id: string;
  company_id: string;
  document_type: string;
  prefix?: string | null;
  next_number: number;
  padding?: number | null;
  is_active: boolean;
}

export interface CreateDocumentSequenceInput {
  company_id: string;
  document_type: string;
  prefix?: string;
  next_number?: number;
  padding?: number;
}

export interface UpdateDocumentSequenceInput {
  prefix?: string;
  next_number?: number;
  padding?: number;
}

export interface DocumentSequencePreview {
  next: string;
}

/* ---------- attachments ---------- */

export interface Attachment {
  id: string;
  owner_type: string;
  owner_id: string;
  file_name: string;
  mime_type?: string | null;
  size?: number | null;
  created_at?: string;
}

/* ---------- CSV import ---------- */

export interface ImportRowError {
  row: number;
  errors: string[];
}

export interface ImportResult {
  imported: number;
  errors: ImportRowError[];
}

/* ---------- inventory (Phase 5) ---------- */

export type StockMovementType =
  | "receive"
  | "issue"
  | "transfer_in"
  | "transfer_out"
  | "adjustment"
  | "return"
  | "opening";

export interface StockMovementProduct {
  sku: string;
  nameAr: string;
  nameEn: string;
}

export interface StockMovementWarehouse {
  name: string;
  nameAr: string;
}

export interface StockMovement {
  id: string;
  company_id: string;
  warehouse_id: string;
  product_id: string;
  movement_type: StockMovementType;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  source_type: string | null;
  source_id: string | null;
  movement_date: string;
  created_at: string;
  product?: StockMovementProduct;
  warehouse?: StockMovementWarehouse;
}

export interface PostMovementInput {
  company_id: string;
  warehouse_id: string;
  location_id?: string;
  product_id: string;
  movement_type: "receive";
  quantity: string;
  unit_cost: string;
  movement_date?: string;
  source_type?: string;
  source_id?: string;
}

export interface PostMovementResult {
  movement: StockMovement;
  replayed: boolean;
  journal_id: string | null;
}

export interface PostIssueResult extends PostMovementResult {
  cogs: string | null;
}

export interface ListMovementsParams {
  company_id: string;
  warehouse_id?: string;
  product_id?: string;
  movement_type?: StockMovementType;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export type ReservationStatus = "active" | "released" | "consumed" | "expired";

export interface StockReservation {
  id: string;
  company_id: string;
  warehouse_id: string;
  product_id: string;
  quantity: string;
  remaining: string;
  status: ReservationStatus;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
}

export interface CreateReservationInput {
  company_id: string;
  warehouse_id: string;
  product_id: string;
  quantity: string;
  source_type?: string;
  source_id?: string;
}

export interface CreateReservationResult {
  reservation: StockReservation;
  replayed: boolean;
}

export interface ListReservationsParams {
  company_id: string;
  warehouse_id?: string;
  product_id?: string;
  status?: ReservationStatus;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface StockBalance {
  product_id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand: string;
  reserved: string;
  available: string;
  avg_cost: string;
  total_value: string;
  reorder_level: string | null;
  low_stock: boolean;
}

export interface ListBalancesParams {
  company_id: string;
  warehouse_id?: string;
  product_id?: string;
  low_stock_only?: boolean;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface ValuationLine {
  product_id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand: string;
  avg_cost: string;
  total_value: string;
}

export interface ValuationMeta {
  total_value: string;
  line_count: number;
}

export interface ValuationResult {
  data: ValuationLine[];
  meta: ValuationMeta;
}

export interface GetValuationParams {
  company_id: string;
  warehouse_id?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export type TransferStatus = "draft" | "dispatched" | "received" | "cancelled";

export interface TransferLine {
  id: string;
  product_id: string;
  quantity: string;
  product?: StockMovementProduct;
}

export interface StockTransfer {
  id: string;
  company_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  number: string;
  status: TransferStatus;
  created_at: string;
  lines: TransferLine[];
}

export interface CreateTransferInput {
  company_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  lines: { product_id: string; quantity: string }[];
}

export interface CreateTransferResult {
  transfer: StockTransfer;
  replayed: boolean;
}

export interface ListTransfersParams {
  company_id: string;
  status?: TransferStatus;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export type AdjustmentStatus = "draft" | "submitted" | "approved" | "posted" | "cancelled";

export interface AdjustmentLine {
  id: string;
  product_id: string;
  quantity_delta: string;
  unit_cost: string | null;
  product?: StockMovementProduct;
}

export interface StockAdjustment {
  id: string;
  company_id: string;
  warehouse_id: string;
  number: string;
  status: AdjustmentStatus;
  reason: string | null;
  created_at: string;
  lines: AdjustmentLine[];
}

export interface CreateAdjustmentInput {
  company_id: string;
  warehouse_id: string;
  reason?: string;
  lines: { product_id: string; quantity_delta: string; unit_cost?: string }[];
}

export interface CreateAdjustmentResult {
  adjustment: StockAdjustment;
  replayed: boolean;
}

export interface ListAdjustmentsParams {
  company_id: string;
  status?: AdjustmentStatus;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export type CountStatus = "draft" | "in_progress" | "posted" | "cancelled";

export interface CountLine {
  id: string;
  product_id: string;
  system_qty: string;
  counted_qty: string | null;
  variance: string | null;
  product?: StockMovementProduct;
}

export interface StockCount {
  id: string;
  company_id: string;
  warehouse_id: string;
  number: string;
  status: CountStatus;
  created_at: string;
  lines: CountLine[];
}

export interface CreateCountInput {
  company_id: string;
  warehouse_id: string;
  lines: { product_id: string }[];
}

export interface CreateCountResult {
  count: StockCount;
  replayed: boolean;
}

export interface ListCountsParams {
  company_id: string;
  status?: CountStatus;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ----- Phase 6: sales ----- */

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type SalesOrderStatus =
  | "draft" | "confirmed" | "partially_delivered" | "delivered"
  | "invoiced" | "closed" | "cancelled";
export type DeliveryStatus = "draft" | "posted" | "partially_invoiced" | "invoiced";
export type SalesInvoiceStatus = "draft" | "posted" | "partially_paid" | "paid";
export type SalesPaymentStatus = "draft" | "posted";
export type CreditNoteStatus = "draft" | "posted";

export interface SalesPartyRef {
  nameAr: string | null;
  nameEn: string | null;
  number: string;
}

export interface SalesLineProduct {
  sku: string;
  nameAr: string | null;
  nameEn: string | null;
  type?: string;
}

/** Backend GET /:id responses return the doc DTO directly (unwrapped). */
export interface PricedDocLine {
  id: string;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_rate: string;
  tax_rate: string;
  line_total: string;
  product?: SalesLineProduct | null;
}

export interface PricedLineInput {
  product_id?: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_rate?: string;
  tax_rate?: string;
}

export interface Quotation {
  id: string;
  company_id: string;
  customer_id: string;
  number: string;
  status: QuotationStatus;
  valid_until: string;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  notes: string | null;
  customer?: SalesPartyRef | null;
  lines: PricedDocLine[];
  created_at: string;
}

export interface QuotationRow {
  id: string;
  number: string;
  status: QuotationStatus;
  customer?: SalesPartyRef | null;
  valid_until: string;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  created_at: string;
}

export interface CreateQuotationInput {
  company_id: string;
  customer_id: string;
  valid_until: string;
  lines: PricedLineInput[];
  notes?: string;
}

export interface CreateQuotationResult {
  quotation: Quotation;
  replayed: boolean;
}

export interface UpdateQuotationInput {
  valid_until?: string;
  lines?: PricedLineInput[];
  notes?: string | null;
}

export interface ListQuotationsParams {
  company_id: string;
  status?: QuotationStatus;
  customer_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface SalesOrderLine extends PricedDocLine {
  delivered_quantity: string;
  invoiced_quantity: string;
}

export interface SalesOrder {
  id: string;
  company_id: string;
  customer_id: string;
  quotation_id: string | null;
  warehouse_id: string;
  number: string;
  status: SalesOrderStatus;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  notes: string | null;
  customer?: SalesPartyRef | null;
  warehouse?: { nameAr: string | null; name: string } | null;
  lines: SalesOrderLine[];
  created_at: string;
}

export interface SalesOrderRow {
  id: string;
  number: string;
  status: SalesOrderStatus;
  customer?: SalesPartyRef | null;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  created_at: string;
}

export interface CreateSalesOrderInput {
  company_id: string;
  customer_id: string;
  quotation_id?: string;
  warehouse_id: string;
  lines: (Omit<PricedLineInput, "product_id"> & { product_id: string })[];
  notes?: string;
}

export interface CreateSalesOrderResult {
  sales_order: SalesOrder;
  replayed: boolean;
}

export interface ListSalesOrdersParams {
  company_id: string;
  status?: SalesOrderStatus;
  customer_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface DeliveryLine {
  id: string;
  sales_order_line_id: string;
  product_id: string;
  quantity: string;
  description: string | null;
  product?: { sku: string; nameAr: string | null; nameEn: string | null } | null;
}

export interface Delivery {
  id: string;
  company_id: string;
  sales_order_id: string;
  warehouse_id: string;
  number: string;
  status: DeliveryStatus;
  delivery_date: string;
  notes: string | null;
  sales_order?: { number: string } | null;
  lines: DeliveryLine[];
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  number: string;
  status: DeliveryStatus;
  sales_order?: { number: string } | null;
  delivery_date: string;
  created_at: string;
}

export interface CreateDeliveryInput {
  company_id: string;
  sales_order_id: string;
  warehouse_id?: string;
  delivery_date?: string;
  lines: { sales_order_line_id: string; quantity: string }[];
  notes?: string;
}

export interface ListDeliveriesParams {
  company_id: string;
  status?: DeliveryStatus;
  sales_order_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface SalesInvoiceLine extends PricedDocLine {
  sales_order_line_id: string | null;
}

export interface SalesInvoice {
  id: string;
  company_id: string;
  customer_id: string;
  sales_order_id: string | null;
  number: string;
  status: SalesInvoiceStatus;
  invoice_date: string;
  subtotal: string;
  tax_total: string;
  total: string;
  paid_total: string;
  outstanding: string;
  currency: string;
  notes: string | null;
  customer?: SalesPartyRef | null;
  sales_order?: { number: string } | null;
  lines: SalesInvoiceLine[];
  created_at: string;
}

export interface SalesInvoiceRow {
  id: string;
  number: string;
  status: SalesInvoiceStatus;
  customer?: SalesPartyRef | null;
  invoice_date: string;
  total: string;
  paid_total: string;
  outstanding: string;
  currency: string;
  created_at: string;
}

export interface CreateSalesInvoiceInput {
  company_id: string;
  customer_id: string;
  sales_order_id?: string;
  delivery_ids?: string[];
  invoice_date?: string;
  lines?: (Omit<PricedLineInput, "product_id"> & { product_id: string })[];
  notes?: string;
}

export interface ListSalesInvoicesParams {
  company_id: string;
  status?: SalesInvoiceStatus;
  customer_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface SalesPaymentAllocation {
  id: string;
  sales_invoice_id: string;
  amount: string;
  invoice_number: string;
}

export interface SalesPayment {
  id: string;
  company_id: string;
  customer_id: string;
  number: string;
  status: SalesPaymentStatus;
  payment_date: string;
  amount: string;
  currency: string;
  notes: string | null;
  customer?: SalesPartyRef | null;
  allocations: SalesPaymentAllocation[];
  created_at: string;
}

export interface SalesPaymentRow {
  id: string;
  number: string;
  status: SalesPaymentStatus;
  customer?: SalesPartyRef | null;
  payment_date: string;
  amount: string;
  currency: string;
  created_at: string;
}

export interface CreateSalesPaymentInput {
  company_id: string;
  customer_id: string;
  payment_date?: string;
  amount: string;
  allocations?: { sales_invoice_id: string; amount: string }[];
  notes?: string;
}

export interface ListSalesPaymentsParams {
  company_id: string;
  status?: SalesPaymentStatus;
  customer_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface CreditNote {
  id: string;
  company_id: string;
  customer_id: string;
  sales_invoice_id: string | null;
  number: string;
  status: CreditNoteStatus;
  credit_date: string;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  reason: string;
  is_return: boolean;
  notes: string | null;
  customer?: SalesPartyRef | null;
  sales_invoice?: { number: string } | null;
  lines: PricedDocLine[];
  created_at: string;
}

export interface CreditNoteRow {
  id: string;
  number: string;
  status: CreditNoteStatus;
  customer?: SalesPartyRef | null;
  is_return: boolean;
  credit_date: string;
  total: string;
  currency: string;
  created_at: string;
}

export interface CreateCreditNoteInput {
  company_id: string;
  customer_id: string;
  sales_invoice_id?: string;
  credit_date?: string;
  reason: string;
  is_return?: boolean;
  lines: PricedLineInput[];
  notes?: string;
}

export interface ListCreditNotesParams {
  company_id: string;
  status?: CreditNoteStatus;
  customer_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ---------- Phase 7: purchasing ---------- */

export type PurchaseRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "ordered";

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "partially_received"
  | "received"
  | "billed"
  | "closed";

export type GoodsReceiptStatus = "draft" | "posted" | "cancelled";

export type SupplierBillStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "posted"
  | "partially_paid"
  | "paid";

export type SupplierPaymentStatus = "draft" | "posted";

export interface PurchaseLineInput {
  product_id?: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_rate?: string;
  tax_rate?: string;
}

export interface PurchaseDocLine {
  id: string;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_rate: string;
  tax_rate: string;
  line_total: string;
}

/** Supplier ref embedded in list rows (camelCase per backend list mapping). */
export interface PurchaseSupplierRef {
  nameAr?: string | null;
  nameEn?: string | null;
  number: string;
}

/* ----- purchase requests ----- */

export interface PurchaseRequestLine extends PurchaseDocLine {}

export interface PurchaseRequest {
  id: string;
  number: string;
  status: PurchaseRequestStatus;
  subtotal: string;
  total: string;
  currency: string;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
  lines: PurchaseRequestLine[];
  created_at: string;
}

export interface PurchaseRequestRow {
  id: string;
  number: string;
  status: PurchaseRequestStatus;
  total: string;
  currency: string;
  created_at: string;
}

export interface CreatePurchaseRequestInput {
  company_id: string;
  notes?: string;
  lines: PurchaseLineInput[];
}

export interface ListPurchaseRequestsParams {
  company_id: string;
  status?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ----- purchase orders ----- */

export interface PurchaseOrderLine extends PurchaseDocLine {
  received_quantity: string;
  billed_quantity: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier_id: string;
  purchase_request_id: string | null;
  rfq_id: string | null;
  warehouse_id: string;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
  lines: PurchaseOrderLine[];
  created_at: string;
}

export interface PurchaseOrderRow {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: PurchaseSupplierRef | null;
  total: string;
  currency: string;
  created_at: string;
}

export interface CreatePurchaseOrderInput {
  company_id: string;
  supplier_id: string;
  warehouse_id: string;
  purchase_request_id?: string;
  rfq_id?: string;
  notes?: string;
  lines: Array<PurchaseLineInput & { product_id: string }>;
}

export interface ListPurchaseOrdersParams {
  company_id: string;
  status?: string;
  supplier_id?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ----- goods receipts ----- */

export interface GoodsReceiptLine {
  id: string;
  purchase_order_line_id: string;
  product_id: string | null;
  quantity: string;
  unit_cost: string;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  purchase_order_id: string;
  warehouse_id: string;
  receipt_date: string;
  notes: string | null;
  lines: GoodsReceiptLine[];
  created_at: string;
}

export interface GoodsReceiptRow {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  receipt_date: string;
  created_at: string;
}

export interface CreateGoodsReceiptInput {
  company_id: string;
  purchase_order_id: string;
  warehouse_id?: string;
  receipt_date?: string;
  notes?: string;
  lines: Array<{
    purchase_order_line_id: string;
    quantity: string;
    unit_cost?: string;
  }>;
}

export interface ListGoodsReceiptsParams {
  company_id: string;
  status?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ----- supplier bills ----- */

export interface SupplierBillLine extends PurchaseDocLine {
  purchase_order_line_id: string | null;
  goods_receipt_line_id: string | null;
}

export interface SupplierBill {
  id: string;
  number: string;
  status: SupplierBillStatus;
  supplier_id: string;
  purchase_order_id: string | null;
  supplier_ref: string | null;
  bill_date: string;
  due_date: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
  paid_total: string;
  outstanding: string;
  currency: string;
  notes: string | null;
  approved_by: string | null;
  lines: SupplierBillLine[];
  created_at: string;
}

export interface SupplierBillRow {
  id: string;
  number: string;
  status: SupplierBillStatus;
  supplier: PurchaseSupplierRef | null;
  total: string;
  outstanding: string;
  currency: string;
  created_at: string;
}

export interface CreateSupplierBillInput {
  company_id: string;
  supplier_id: string;
  purchase_order_id?: string;
  goods_receipt_id?: string;
  supplier_ref?: string;
  bill_date?: string;
  due_date?: string;
  notes?: string;
  lines: Array<
    PurchaseLineInput & {
      purchase_order_line_id?: string;
      goods_receipt_line_id?: string;
    }
  >;
}

export interface ListSupplierBillsParams {
  company_id: string;
  status?: string;
  supplier_id?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ----- supplier payments ----- */

export interface SupplierPaymentAllocation {
  id: string;
  supplier_bill_id: string;
  amount: string;
}

export interface SupplierPayment {
  id: string;
  number: string;
  status: SupplierPaymentStatus;
  supplier_id: string;
  payment_date: string;
  amount: string;
  currency: string;
  notes: string | null;
  allocations: SupplierPaymentAllocation[];
  created_at: string;
}

export interface SupplierPaymentRow {
  id: string;
  number: string;
  status: SupplierPaymentStatus;
  amount: string;
  currency: string;
  created_at: string;
}

export interface CreateSupplierPaymentInput {
  company_id: string;
  supplier_id: string;
  payment_date?: string;
  amount: string;
  notes?: string;
  allocations: Array<{
    supplier_bill_id: string;
    amount: string;
  }>;
}

export interface ListSupplierPaymentsParams {
  company_id: string;
  status?: string;
  supplier_id?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/* ---------- notifications (Phase 9) ---------- */

export interface AppNotification {
  id: string;
  type: string;
  title_ar: string;
  title_en: string;
  body_ar: string | null;
  body_en: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ListNotificationsParams {
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface ReportPdfParams {
  company_id: string;
  from?: string;
  to?: string;
  as_of?: string;
  [key: string]: unknown;
}
