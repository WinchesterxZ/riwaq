import { ApiError, apiErrorFromResponse } from "./errors.js";
import type {
  AcceptInvitationInput,
  Account,
  AccountingPeriod,
  AppNotification,
  Attachment,
  AuditEvent,
  Branch,
  ChangePasswordInput,
  Company,
  CreateAccountInput,
  CreateAdjustmentInput,
  CreateAdjustmentResult,
  CreateBranchInput,
  CreateCompanyInput,
  CreateCountInput,
  CreateCountResult,
  CreateCustomerInput,
  CreateDocumentSequenceInput,
  CreateFiscalYearInput,
  CreateInvitationInput,
  CreateInvitationResult,
  CreateJournalEntryInput,
  CreateOrganizationInput,
  CreatePartyAddressInput,
  CreatePartyContactInput,
  CreatePaymentTermInput,
  CreateProductCategoryInput,
  CreateProductInput,
  CreateProductVariantInput,
  CreateReservationInput,
  CreateReservationResult,
  CreateResult,
  CreateRoleInput,
  CreateSupplierInput,
  CreateTaxCodeInput,
  CreateTransferInput,
  CreateTransferResult,
  CreateUnitConversionInput,
  CreateUnitOfMeasureInput,
  CreateWarehouseInput,
  Customer,
  DashboardSummary,
  DocumentSequence,
  DocumentSequencePreview,
  FirstRunInput,
  FirstRunResult,
  FiscalYear,
  GetValuationParams,
  ImportResult,
  Invitation,
  JournalEntry,
  ListAdjustmentsParams,
  ListAuditEventsParams,
  ListBalancesParams,
  ListCountsParams,
  ListJournalEntriesParams,
  ListNotificationsParams,
  ListMovementsParams,
  ListPartiesParams,
  ListProductsParams,
  ListReservationsParams,
  ListTransfersParams,
  ListUsersParams,
  LoginInput,
  LoginResult,
  MeResponse,
  Membership,
  MfaSetupResult,
  Organization,
  Page,
  PartyAddress,
  PartyContact,
  PaymentTerm,
  Permission,
  PostIssueResult,
  PostMovementInput,
  PostMovementResult,
  Product,
  ProductCategory,
  ProductVariant,
  Role,
  SessionInfo,
  StockAdjustment,
  StockBalance,
  StockCount,
  StockMovement,
  StockMovementType,
  StockReservation,
  StockTransfer,
  Supplier,
  TaxCode,
  TrialBalance,
  AgingReport,
  BalanceSheet,
  BankStatement,
  BankStatementDetail,
  CashFlow,
  CreateBankStatementInput,
  CreateExpenseBillInput,
  ExpenseBill,
  ExpenseBillDetail,
  FinanceDashboard,
  GeneralLedger,
  ListBankStatementsParams,
  ListExpenseBillsParams,
  OutstandingItems,
  ProfitLoss,
  VatReport,
  UnitConversion,
  UnitOfMeasure,
  UpdateAccountInput,
  UpdateCustomerInput,
  UpdateDocumentSequenceInput,
  UpdateJournalEntryInput,
  UpdatePaymentTermInput,
  UpdateProductCategoryInput,
  UpdateProductInput,
  UpdateProductVariantInput,
  UpdateRoleInput,
  UpdateSupplierInput,
  UpdateTaxCodeInput,
  UpdateUnitOfMeasureInput,
  User,
  CreateCreditNoteInput,
  CreateDeliveryInput,
  CreateQuotationInput,
  CreateQuotationResult,
  CreateSalesInvoiceInput,
  CreateSalesOrderInput,
  CreateSalesOrderResult,
  CreateSalesPaymentInput,
  CreatePurchaseOrderInput,
  CreatePurchaseRequestInput,
  CreateGoodsReceiptInput,
  CreateSupplierBillInput,
  CreateSupplierPaymentInput,
  GoodsReceipt,
  GoodsReceiptRow,
  GoodsReceiptStatus,
  ListGoodsReceiptsParams,
  ListPurchaseOrdersParams,
  ListPurchaseRequestsParams,
  ListSupplierBillsParams,
  ListSupplierPaymentsParams,
  PurchaseOrder,
  PurchaseOrderRow,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestRow,
  PurchaseRequestStatus,
  SupplierBill,
  SupplierBillRow,
  SupplierBillStatus,
  SupplierPayment,
  SupplierPaymentRow,
  SupplierPaymentStatus,
  CreditNote,
  CreditNoteRow,
  CreditNoteStatus,
  Delivery,
  DeliveryRow,
  DeliveryStatus,
  ListCreditNotesParams,
  ListDeliveriesParams,
  ListQuotationsParams,
  ListSalesInvoicesParams,
  ListSalesOrdersParams,
  ListSalesPaymentsParams,
  Quotation,
  QuotationRow,
  ReportPdfParams,
  QuotationStatus,
  SalesInvoice,
  SalesInvoiceRow,
  SalesInvoiceStatus,
  SalesOrder,
  SalesOrderRow,
  SalesOrderStatus,
  SalesPayment,
  SalesPaymentRow,
  SalesPaymentStatus,
  UpdateQuotationInput,
  UserStatus,
  ValuationResult,
  Warehouse,
} from "./types.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  body?: unknown;
  /** Values are stringified; undefined / null / "" are dropped. */
  query?: { [key: string]: unknown };
  idempotencyKey?: string;
}

export interface ClientOptions {
  /** Defaults to http://localhost:3000 */
  baseUrl?: string;
  organizationId?: string;
  companyId?: string;
}

const DEFAULT_BASE_URL = "http://localhost:3000";
const CSRF_COOKIE = "atlas_csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Accept both bare arrays and { data, meta } envelopes for non-paginated lists. */
function toArray<T>(payload: T[] | Page<T> | null | undefined): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray((payload as Page<T>).data)) return (payload as Page<T>).data;
  return [];
}

/**
 * Typed client for the ATLAS ERP API.
 *
 * - Sends cookies (`credentials: "include"`, HttpOnly `atlas_session`).
 * - Auto-attaches `X-CSRF-Token` from the `atlas_csrf` cookie on non-GET requests.
 * - Attaches `X-Organization-Id` / `X-Company-Id` from the settable context.
 * - Throws {@link ApiError} on any non-2xx response.
 */
export class AtlasApiClient {
  private baseUrl: string;
  private organizationId?: string;
  private companyId?: string;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.organizationId = opts.organizationId;
    this.companyId = opts.companyId;
  }

  /* ----- scoping context ----- */

  setOrganizationId(id?: string): void {
    this.organizationId = id;
  }
  getOrganizationId(): string | undefined {
    return this.organizationId;
  }
  setCompanyId(id?: string): void {
    this.companyId = id;
  }
  getCompanyId(): string | undefined {
    return this.companyId;
  }

  /* ----- core request ----- */

  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") {
      const csrf = readCookie(CSRF_COOKIE);
      if (csrf) headers["X-CSRF-Token"] = csrf;
    }
    if (this.organizationId) headers["X-Organization-Id"] = this.organizationId;
    if (this.companyId) headers["X-Company-Id"] = this.companyId;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) throw await apiErrorFromResponse(res);
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return undefined as T;
    return (await res.json()) as T;
  }

  /* ----- system ----- */

  health(): Promise<{ status: string; version: string }> {
    // /health and /ready live outside /api/v1.
    return fetch(`${this.baseUrl}/health`).then(async (r) => {
      if (!r.ok) throw await apiErrorFromResponse(r);
      return r.json();
    });
  }

  ready(): Promise<{ status: string; db: string }> {
    return fetch(`${this.baseUrl}/ready`).then(async (r) => {
      if (!r.ok) throw await apiErrorFromResponse(r);
      return r.json();
    });
  }

  /* ----- auth ----- */

  firstRunStatus(): Promise<{ firstRun: boolean }> {
    return this.request("GET", "/auth/first-run/status");
  }

  firstRun(input: FirstRunInput): Promise<FirstRunResult> {
    return this.request("POST", "/auth/first-run", { body: input });
  }

  login(input: LoginInput): Promise<LoginResult> {
    return this.request("POST", "/auth/login", { body: input });
  }

  logout(): Promise<void> {
    return this.request("POST", "/auth/logout");
  }

  me(): Promise<MeResponse> {
    return this.request("GET", "/auth/me");
  }

  changePassword(input: ChangePasswordInput): Promise<void> {
    return this.request("POST", "/auth/change-password", { body: input });
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.request("POST", "/auth/password-reset/request", { body: { email } });
  }

  confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    return this.request("POST", "/auth/password-reset/confirm", { body: { token, newPassword } });
  }

  mfaSetup(): Promise<MfaSetupResult> {
    return this.request("POST", "/auth/mfa/setup");
  }

  mfaVerify(code: string): Promise<void> {
    return this.request("POST", "/auth/mfa/verify", { body: { code } });
  }

  mfaDisable(password: string): Promise<void> {
    return this.request("POST", "/auth/mfa/disable", { body: { password } });
  }

  async sessions(): Promise<SessionInfo[]> {
    const payload = await this.request<SessionInfo[] | Page<SessionInfo>>("GET", "/auth/sessions");
    return toArray(payload);
  }

  revokeSession(id: string): Promise<void> {
    return this.request("DELETE", `/auth/sessions/${encodeURIComponent(id)}`);
  }

  async createInvitation(
    input: CreateInvitationInput,
    idempotencyKey?: string,
  ): Promise<CreateInvitationResult> {
    return this.request("POST", "/auth/invitations", { body: input, idempotencyKey });
  }

  async listInvitations(): Promise<Invitation[]> {
    const payload = await this.request<Invitation[] | Page<Invitation>>("GET", "/auth/invitations");
    return toArray(payload);
  }

  acceptInvitation(input: AcceptInvitationInput): Promise<{ user: User; membership?: Membership }> {
    return this.request("POST", "/auth/invitations/accept", { body: input });
  }

  /* ----- memberships / org structure ----- */

  memberships(): Promise<Membership[]> {
    return this.request("GET", "/memberships");
  }

  createOrganization(input: CreateOrganizationInput, idempotencyKey?: string): Promise<Organization> {
    return this.request("POST", "/organizations", { body: input, idempotencyKey });
  }

  getOrganization(id: string): Promise<Organization> {
    return this.request("GET", `/organizations/${encodeURIComponent(id)}`);
  }

  createCompany(input: CreateCompanyInput, idempotencyKey?: string): Promise<Company> {
    return this.request("POST", "/companies", { body: input, idempotencyKey });
  }

  async listCompanies(): Promise<Company[]> {
    const payload = await this.request<Company[] | Page<Company>>("GET", "/companies");
    return toArray(payload);
  }

  createBranch(input: CreateBranchInput, idempotencyKey?: string): Promise<Branch> {
    return this.request("POST", "/branches", { body: input, idempotencyKey });
  }

  async listBranches(companyId: string): Promise<Branch[]> {
    const payload = await this.request<Branch[] | Page<Branch>>("GET", "/branches", {
      query: { companyId },
    });
    return toArray(payload);
  }

  createWarehouse(input: CreateWarehouseInput, idempotencyKey?: string): Promise<Warehouse> {
    return this.request("POST", "/warehouses", { body: input, idempotencyKey });
  }

  async listWarehouses(branchId: string): Promise<Warehouse[]> {
    const payload = await this.request<Warehouse[] | Page<Warehouse>>("GET", "/warehouses", {
      query: { branchId },
    });
    return toArray(payload);
  }

  /* ----- users / roles / permissions ----- */

  listUsers(params: ListUsersParams = {}): Promise<Page<User>> {
    return this.request("GET", "/users", { query: params });
  }

  setUserStatus(id: string, status: UserStatus): Promise<User> {
    return this.request("PATCH", `/users/${encodeURIComponent(id)}/status`, { body: { status } });
  }

  async listRoles(): Promise<Role[]> {
    const payload = await this.request<Role[] | Page<Role>>("GET", "/roles");
    return toArray(payload);
  }

  createRole(input: CreateRoleInput): Promise<Role> {
    return this.request("POST", "/roles", { body: input });
  }

  updateRole(id: string, input: UpdateRoleInput): Promise<Role> {
    return this.request("PATCH", `/roles/${encodeURIComponent(id)}`, { body: input });
  }

  async listPermissions(): Promise<Permission[]> {
    const payload = await this.request<Permission[] | Page<Permission>>("GET", "/permissions");
    return toArray(payload);
  }

  /* ----- audit / dashboard ----- */

  listAuditEvents(params: ListAuditEventsParams = {}): Promise<Page<AuditEvent>> {
    return this.request("GET", "/audit-events", { query: params });
  }

  dashboardSummary(): Promise<DashboardSummary> {
    return this.request("GET", "/dashboard/summary");
  }

  /* ----- chart of accounts (Phase 3) ----- */

  async listAccounts(companyId: string): Promise<Account[]> {
    const payload = await this.request<Account[] | Page<Account>>("GET", "/accounts", {
      query: { company_id: companyId },
    });
    return toArray(payload);
  }

  createAccount(input: CreateAccountInput, idempotencyKey?: string): Promise<Account> {
    return this.request("POST", "/accounts", { body: input, idempotencyKey });
  }

  updateAccount(id: string, input: UpdateAccountInput): Promise<Account> {
    return this.request("PATCH", `/accounts/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateAccount(id: string): Promise<Account> {
    return this.request("POST", `/accounts/${encodeURIComponent(id)}/deactivate`);
  }

  seedChartOfAccounts(companyId: string): Promise<{ created: number }> {
    return this.request("POST", `/companies/${encodeURIComponent(companyId)}/chart-of-accounts/seed`);
  }

  /* ----- fiscal years & accounting periods ----- */

  async listFiscalYears(companyId: string): Promise<FiscalYear[]> {
    const payload = await this.request<FiscalYear[] | Page<FiscalYear>>("GET", "/fiscal-years", {
      query: { company_id: companyId },
    });
    return toArray(payload);
  }

  createFiscalYear(input: CreateFiscalYearInput, idempotencyKey?: string): Promise<FiscalYear> {
    return this.request("POST", "/fiscal-years", { body: input, idempotencyKey });
  }

  async listAccountingPeriods(fiscalYearId: string): Promise<AccountingPeriod[]> {
    const payload = await this.request<AccountingPeriod[] | Page<AccountingPeriod>>(
      "GET",
      "/accounting-periods",
      { query: { fiscal_year_id: fiscalYearId } },
    );
    return toArray(payload);
  }

  closePeriod(id: string): Promise<AccountingPeriod> {
    return this.request("POST", `/accounting-periods/${encodeURIComponent(id)}/close`);
  }

  lockPeriod(id: string): Promise<AccountingPeriod> {
    return this.request("POST", `/accounting-periods/${encodeURIComponent(id)}/lock`);
  }

  reopenPeriod(id: string): Promise<AccountingPeriod> {
    return this.request("POST", `/accounting-periods/${encodeURIComponent(id)}/reopen`);
  }

  /* ----- journal entries ----- */

  listJournalEntries(params: ListJournalEntriesParams): Promise<Page<JournalEntry>> {
    return this.request("GET", "/journal-entries", { query: params });
  }

  getJournalEntry(id: string): Promise<JournalEntry> {
    return this.request("GET", `/journal-entries/${encodeURIComponent(id)}`);
  }

  createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry> {
    const { idempotency_key, ...body } = input;
    return this.request("POST", "/journal-entries", { body, idempotencyKey: idempotency_key });
  }

  updateJournalEntry(id: string, input: UpdateJournalEntryInput): Promise<JournalEntry> {
    return this.request("PATCH", `/journal-entries/${encodeURIComponent(id)}`, { body: input });
  }

  deleteJournalEntry(id: string): Promise<void> {
    return this.request("DELETE", `/journal-entries/${encodeURIComponent(id)}`);
  }

  submitJournalEntry(id: string): Promise<JournalEntry> {
    return this.request("POST", `/journal-entries/${encodeURIComponent(id)}/submit`);
  }

  approveJournalEntry(id: string): Promise<JournalEntry> {
    return this.request("POST", `/journal-entries/${encodeURIComponent(id)}/approve`);
  }

  rejectJournalEntry(id: string): Promise<JournalEntry> {
    return this.request("POST", `/journal-entries/${encodeURIComponent(id)}/reject`);
  }

  postJournalEntry(id: string, version: number): Promise<JournalEntry> {
    return this.request("POST", `/journal-entries/${encodeURIComponent(id)}/post`, {
      body: { version },
    });
  }

  reverseJournalEntry(id: string): Promise<JournalEntry> {
    return this.request("POST", `/journal-entries/${encodeURIComponent(id)}/reverse`);
  }

  /* ----- tax codes ----- */

  async listTaxCodes(companyId: string): Promise<TaxCode[]> {
    const payload = await this.request<TaxCode[] | Page<TaxCode>>("GET", "/tax-codes", {
      query: { company_id: companyId },
    });
    return toArray(payload);
  }

  createTaxCode(input: CreateTaxCodeInput, idempotencyKey?: string): Promise<TaxCode> {
    return this.request("POST", "/tax-codes", { body: input, idempotencyKey });
  }

  updateTaxCode(id: string, input: UpdateTaxCodeInput): Promise<TaxCode> {
    return this.request("PATCH", `/tax-codes/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateTaxCode(id: string): Promise<TaxCode> {
    return this.request("POST", `/tax-codes/${encodeURIComponent(id)}/deactivate`);
  }

  seedStandardTaxCodes(companyId: string): Promise<{ created: number }> {
    return this.request("POST", `/companies/${encodeURIComponent(companyId)}/tax-codes/seed-standard`);
  }

  /* ----- reports ----- */

  trialBalance(companyId: string, from: string, to: string): Promise<TrialBalance> {
    return this.request("GET", "/reports/trial-balance", {
      query: { company_id: companyId, from, to },
    });
  }

  /* ----- Phase 8: finance reports ----- */

  financeDashboard(companyId: string): Promise<FinanceDashboard> {
    return this.request("GET", "/reports/finance-dashboard", {
      query: { company_id: companyId },
    });
  }

  generalLedger(
    companyId: string,
    from: string,
    to: string,
    accountId?: string,
  ): Promise<GeneralLedger> {
    return this.request("GET", "/reports/general-ledger", {
      query: { company_id: companyId, from, to, account_id: accountId },
    });
  }

  balanceSheet(companyId: string, asOf: string): Promise<BalanceSheet> {
    return this.request("GET", "/reports/balance-sheet", {
      query: { company_id: companyId, as_of: asOf },
    });
  }

  profitLoss(companyId: string, from: string, to: string): Promise<ProfitLoss> {
    return this.request("GET", "/reports/profit-loss", {
      query: { company_id: companyId, from, to },
    });
  }

  cashFlow(companyId: string, from: string, to: string): Promise<CashFlow> {
    return this.request("GET", "/reports/cash-flow", {
      query: { company_id: companyId, from, to },
    });
  }

  arAging(companyId: string, asOf: string): Promise<AgingReport> {
    return this.request("GET", "/reports/ar-aging", {
      query: { company_id: companyId, as_of: asOf },
    });
  }

  apAging(companyId: string, asOf: string): Promise<AgingReport> {
    return this.request("GET", "/reports/ap-aging", {
      query: { company_id: companyId, as_of: asOf },
    });
  }

  vatReport(companyId: string, from: string, to: string): Promise<VatReport> {
    return this.request("GET", "/reports/vat", {
      query: { company_id: companyId, from, to },
    });
  }

  /* ----- Phase 8: bank statements ----- */

  listBankStatements(params: ListBankStatementsParams): Promise<Page<BankStatement>> {
    return this.request("GET", "/finance/bank-statements", { query: params });
  }

  getBankStatement(id: string): Promise<BankStatementDetail> {
    return this.request("GET", `/finance/bank-statements/${encodeURIComponent(id)}`);
  }

  createBankStatement(
    input: CreateBankStatementInput,
    idempotencyKey?: string,
  ): Promise<{ bank_statement: BankStatementDetail; replayed: boolean }> {
    return this.request("POST", "/finance/bank-statements", { body: input, idempotencyKey });
  }

  postBankStatement(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ bank_statement: BankStatementDetail }> {
    return this.request("POST", `/finance/bank-statements/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  matchBankStatementLine(
    lineId: string,
    journalEntryId: string,
  ): Promise<{ matched: boolean; line_id: string; journal_entry_id: string }> {
    return this.request("POST", `/finance/bank-statements/lines/${encodeURIComponent(lineId)}/match`, {
      body: { journal_entry_id: journalEntryId },
    });
  }

  unmatchBankStatementLine(lineId: string): Promise<{ matched: boolean; line_id: string }> {
    return this.request("POST", `/finance/bank-statements/lines/${encodeURIComponent(lineId)}/unmatch`, {
      body: {},
    });
  }

  outstandingBankItems(id: string): Promise<OutstandingItems> {
    return this.request("GET", `/finance/bank-statements/${encodeURIComponent(id)}/outstanding`);
  }

  /* ----- Phase 8: expense bills ----- */

  listExpenseBills(params: ListExpenseBillsParams): Promise<Page<ExpenseBill>> {
    return this.request("GET", "/finance/expense-bills", { query: params });
  }

  getExpenseBill(id: string): Promise<ExpenseBillDetail> {
    return this.request("GET", `/finance/expense-bills/${encodeURIComponent(id)}`);
  }

  createExpenseBill(
    input: CreateExpenseBillInput,
    idempotencyKey?: string,
  ): Promise<{ expense_bill: ExpenseBillDetail; replayed: boolean }> {
    return this.request("POST", "/finance/expense-bills", { body: input, idempotencyKey });
  }

  transitionExpenseBill(
    id: string,
    action: "submit" | "approve" | "reject" | "cancel",
  ): Promise<{ expense_bill: ExpenseBillDetail }> {
    return this.request(
      "POST",
      `/finance/expense-bills/${encodeURIComponent(id)}/${action}`,
      { body: {} },
    );
  }

  postExpenseBill(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ expense_bill: ExpenseBillDetail; journal_id: string }> {
    return this.request("POST", `/finance/expense-bills/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  /* ----- Phase 4: raw helpers (multipart / blob) ----- */

  /** POST/PUT with a FormData body; browser sets the multipart boundary itself. */
  private async requestForm<T>(method: HttpMethod, path: string, form: FormData): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {};
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (this.organizationId) headers["X-Organization-Id"] = this.organizationId;
    if (this.companyId) headers["X-Company-Id"] = this.companyId;
    const res = await fetch(url, { method, headers, credentials: "include", body: form });
    if (!res.ok) throw await apiErrorFromResponse(res);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return undefined as T;
    return (await res.json()) as T;
  }

  /** Authenticated GET that returns the body as a Blob (CSV exports, attachment downloads). */
  private async requestBlob(path: string, query?: { [key: string]: unknown }): Promise<Blob> {
    const url = `${this.baseUrl}/api/v1${path}${buildQuery(query)}`;
    const headers: Record<string, string> = {};
    if (this.organizationId) headers["X-Organization-Id"] = this.organizationId;
    if (this.companyId) headers["X-Company-Id"] = this.companyId;
    const res = await fetch(url, { method: "GET", headers, credentials: "include" });
    if (!res.ok) throw await apiErrorFromResponse(res);
    return res.blob();
  }

  /* ----- customers ----- */

  listCustomers(params: ListPartiesParams): Promise<Page<Customer>> {
    return this.request("GET", "/customers", { query: params });
  }

  createCustomer(input: CreateCustomerInput, idempotencyKey?: string): Promise<CreateResult<Customer>> {
    return this.request("POST", "/customers", { body: input, idempotencyKey });
  }

  getCustomer(id: string): Promise<Customer> {
    return this.request("GET", `/customers/${encodeURIComponent(id)}`);
  }

  updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.request("PATCH", `/customers/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateCustomer(id: string): Promise<Customer> {
    return this.request("POST", `/customers/${encodeURIComponent(id)}/deactivate`);
  }

  async listCustomerContacts(id: string): Promise<PartyContact[]> {
    const payload = await this.request<PartyContact[] | Page<PartyContact>>(
      "GET",
      `/customers/${encodeURIComponent(id)}/contacts`,
    );
    return toArray(payload);
  }

  createCustomerContact(id: string, input: CreatePartyContactInput): Promise<PartyContact> {
    return this.request("POST", `/customers/${encodeURIComponent(id)}/contacts`, { body: input });
  }

  deleteCustomerContact(id: string, contactId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/customers/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`,
    );
  }

  async listCustomerAddresses(id: string): Promise<PartyAddress[]> {
    const payload = await this.request<PartyAddress[] | Page<PartyAddress>>(
      "GET",
      `/customers/${encodeURIComponent(id)}/addresses`,
    );
    return toArray(payload);
  }

  createCustomerAddress(id: string, input: CreatePartyAddressInput): Promise<PartyAddress> {
    return this.request("POST", `/customers/${encodeURIComponent(id)}/addresses`, { body: input });
  }

  deleteCustomerAddress(id: string, addressId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/customers/${encodeURIComponent(id)}/addresses/${encodeURIComponent(addressId)}`,
    );
  }

  exportCustomers(companyId: string): Promise<Blob> {
    return this.requestBlob("/customers/export", { company_id: companyId });
  }

  importCustomers(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    return this.requestForm<ImportResult>("POST", "/customers/import", form);
  }

  /* ----- suppliers ----- */

  listSuppliers(params: ListPartiesParams): Promise<Page<Supplier>> {
    return this.request("GET", "/suppliers", { query: params });
  }

  createSupplier(input: CreateSupplierInput, idempotencyKey?: string): Promise<CreateResult<Supplier>> {
    return this.request("POST", "/suppliers", { body: input, idempotencyKey });
  }

  getSupplier(id: string): Promise<Supplier> {
    return this.request("GET", `/suppliers/${encodeURIComponent(id)}`);
  }

  updateSupplier(id: string, input: UpdateSupplierInput): Promise<Supplier> {
    return this.request("PATCH", `/suppliers/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateSupplier(id: string): Promise<Supplier> {
    return this.request("POST", `/suppliers/${encodeURIComponent(id)}/deactivate`);
  }

  async listSupplierContacts(id: string): Promise<PartyContact[]> {
    const payload = await this.request<PartyContact[] | Page<PartyContact>>(
      "GET",
      `/suppliers/${encodeURIComponent(id)}/contacts`,
    );
    return toArray(payload);
  }

  createSupplierContact(id: string, input: CreatePartyContactInput): Promise<PartyContact> {
    return this.request("POST", `/suppliers/${encodeURIComponent(id)}/contacts`, { body: input });
  }

  deleteSupplierContact(id: string, contactId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/suppliers/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`,
    );
  }

  async listSupplierAddresses(id: string): Promise<PartyAddress[]> {
    const payload = await this.request<PartyAddress[] | Page<PartyAddress>>(
      "GET",
      `/suppliers/${encodeURIComponent(id)}/addresses`,
    );
    return toArray(payload);
  }

  createSupplierAddress(id: string, input: CreatePartyAddressInput): Promise<PartyAddress> {
    return this.request("POST", `/suppliers/${encodeURIComponent(id)}/addresses`, { body: input });
  }

  deleteSupplierAddress(id: string, addressId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/suppliers/${encodeURIComponent(id)}/addresses/${encodeURIComponent(addressId)}`,
    );
  }

  exportSuppliers(companyId: string): Promise<Blob> {
    return this.requestBlob("/suppliers/export", { company_id: companyId });
  }

  importSuppliers(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    return this.requestForm<ImportResult>("POST", "/suppliers/import", form);
  }

  /* ----- product categories ----- */

  async listProductCategories(companyId: string): Promise<ProductCategory[]> {
    const payload = await this.request<ProductCategory[] | Page<ProductCategory>>(
      "GET",
      "/product-categories",
      { query: { company_id: companyId } },
    );
    return toArray(payload);
  }

  createProductCategory(input: CreateProductCategoryInput): Promise<ProductCategory> {
    return this.request("POST", "/product-categories", { body: input });
  }

  updateProductCategory(id: string, input: UpdateProductCategoryInput): Promise<ProductCategory> {
    return this.request("PATCH", `/product-categories/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateProductCategory(id: string): Promise<ProductCategory> {
    return this.request("POST", `/product-categories/${encodeURIComponent(id)}/deactivate`);
  }

  /* ----- units of measure ----- */

  async listUnitsOfMeasure(companyId: string): Promise<UnitOfMeasure[]> {
    const payload = await this.request<UnitOfMeasure[] | Page<UnitOfMeasure>>(
      "GET",
      "/units-of-measure",
      { query: { company_id: companyId } },
    );
    return toArray(payload);
  }

  createUnitOfMeasure(input: CreateUnitOfMeasureInput): Promise<UnitOfMeasure> {
    return this.request("POST", "/units-of-measure", { body: input });
  }

  updateUnitOfMeasure(id: string, input: UpdateUnitOfMeasureInput): Promise<UnitOfMeasure> {
    return this.request("PATCH", `/units-of-measure/${encodeURIComponent(id)}`, { body: input });
  }

  async listUnitConversions(companyId: string): Promise<UnitConversion[]> {
    const payload = await this.request<UnitConversion[] | Page<UnitConversion>>(
      "GET",
      "/unit-conversions",
      { query: { company_id: companyId } },
    );
    return toArray(payload);
  }

  createUnitConversion(input: CreateUnitConversionInput): Promise<UnitConversion> {
    return this.request("POST", "/unit-conversions", { body: input });
  }

  deleteUnitConversion(id: string): Promise<void> {
    return this.request("DELETE", `/unit-conversions/${encodeURIComponent(id)}`);
  }

  /* ----- payment terms ----- */

  async listPaymentTerms(companyId: string): Promise<PaymentTerm[]> {
    const payload = await this.request<PaymentTerm[] | Page<PaymentTerm>>("GET", "/payment-terms", {
      query: { company_id: companyId },
    });
    return toArray(payload);
  }

  createPaymentTerm(input: CreatePaymentTermInput): Promise<PaymentTerm> {
    return this.request("POST", "/payment-terms", { body: input });
  }

  updatePaymentTerm(id: string, input: UpdatePaymentTermInput): Promise<PaymentTerm> {
    return this.request("PATCH", `/payment-terms/${encodeURIComponent(id)}`, { body: input });
  }

  deactivatePaymentTerm(id: string): Promise<PaymentTerm> {
    return this.request("POST", `/payment-terms/${encodeURIComponent(id)}/deactivate`);
  }

  /* ----- products ----- */

  listProducts(params: ListProductsParams): Promise<Page<Product>> {
    return this.request("GET", "/products", { query: params });
  }

  createProduct(input: CreateProductInput, idempotencyKey?: string): Promise<Product> {
    return this.request("POST", "/products", { body: input, idempotencyKey });
  }

  getProduct(id: string): Promise<Product> {
    return this.request("GET", `/products/${encodeURIComponent(id)}`);
  }

  updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
    return this.request("PATCH", `/products/${encodeURIComponent(id)}`, { body: input });
  }

  deactivateProduct(id: string): Promise<Product> {
    return this.request("POST", `/products/${encodeURIComponent(id)}/deactivate`);
  }

  async listProductVariants(productId: string): Promise<ProductVariant[]> {
    const payload = await this.request<ProductVariant[] | Page<ProductVariant>>(
      "GET",
      `/products/${encodeURIComponent(productId)}/variants`,
    );
    return toArray(payload);
  }

  createProductVariant(productId: string, input: CreateProductVariantInput): Promise<ProductVariant> {
    return this.request("POST", `/products/${encodeURIComponent(productId)}/variants`, {
      body: input,
    });
  }

  updateProductVariant(
    productId: string,
    variantId: string,
    input: UpdateProductVariantInput,
  ): Promise<ProductVariant> {
    return this.request(
      "PATCH",
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { body: input },
    );
  }

  deleteProductVariant(productId: string, variantId: string): Promise<void> {
    return this.request(
      "DELETE",
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
    );
  }

  exportProducts(companyId: string): Promise<Blob> {
    return this.requestBlob("/products/export", { company_id: companyId });
  }

  importProducts(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    return this.requestForm<ImportResult>("POST", "/products/import", form);
  }

  /* ----- document sequences ----- */

  async listDocumentSequences(companyId: string): Promise<DocumentSequence[]> {
    const payload = await this.request<DocumentSequence[] | Page<DocumentSequence>>(
      "GET",
      "/document-sequences",
      { query: { company_id: companyId } },
    );
    return toArray(payload);
  }

  createDocumentSequence(input: CreateDocumentSequenceInput): Promise<DocumentSequence> {
    return this.request("POST", "/document-sequences", { body: input });
  }

  updateDocumentSequence(id: string, input: UpdateDocumentSequenceInput): Promise<DocumentSequence> {
    return this.request("PATCH", `/document-sequences/${encodeURIComponent(id)}`, { body: input });
  }

  previewDocumentSequence(
    companyId: string,
    documentType: string,
  ): Promise<DocumentSequencePreview> {
    return this.request("GET", "/document-sequences/preview", {
      query: { company_id: companyId, document_type: documentType },
    });
  }

  /* ----- attachments ----- */

  uploadAttachment(file: File, ownerType: string, ownerId: string): Promise<Attachment> {
    const form = new FormData();
    form.append("file", file);
    form.append("owner_type", ownerType);
    form.append("owner_id", ownerId);
    return this.requestForm<Attachment>("POST", "/attachments", form);
  }

  async listAttachments(ownerType: string, ownerId: string): Promise<Attachment[]> {
    const payload = await this.request<Attachment[] | Page<Attachment>>("GET", "/attachments", {
      query: { owner_type: ownerType, owner_id: ownerId },
    });
    return toArray(payload);
  }

  downloadAttachment(id: string): Promise<Blob> {
    return this.requestBlob(`/attachments/${encodeURIComponent(id)}/download`);
  }

  deleteAttachment(id: string): Promise<void> {
    return this.request("DELETE", `/attachments/${encodeURIComponent(id)}`);
  }

  /* ----- accounts (filtered variant; existing listAccounts signature unchanged) ----- */

  async listAccountsFiltered(
    companyId: string,
    params: { is_postable?: boolean } = {},
  ): Promise<Account[]> {
    const payload = await this.request<Account[] | Page<Account>>("GET", "/accounts", {
      query: { company_id: companyId, is_postable: params.is_postable },
    });
    return toArray(payload);
  }

  /* ----- Phase 5: inventory ----- */

  /**
   * All warehouses across every branch of a company (used by inventory filters).
   */
  async listCompanyWarehouses(companyId: string): Promise<Warehouse[]> {
    const branches = await this.listBranches(companyId);
    const perBranch = await Promise.all(branches.map((b) => this.listWarehouses(b.id)));
    return perBranch.flat();
  }

  postStockMovement(
    kind: "receive" | "issue" | "return" | "opening",
    input: PostMovementInput,
    idempotencyKey?: string,
  ): Promise<PostMovementResult> {
    return this.request("POST", `/inventory/movements/${kind}`, { body: input, idempotencyKey });
  }

  issueStock(input: PostMovementInput, idempotencyKey?: string): Promise<PostIssueResult> {
    return this.request("POST", "/inventory/movements/issue", { body: input, idempotencyKey });
  }

  listMovements(params: ListMovementsParams): Promise<Page<StockMovement>> {
    return this.request("GET", "/inventory/movements", { query: params });
  }

  createReservation(input: CreateReservationInput, idempotencyKey?: string): Promise<CreateReservationResult> {
    return this.request("POST", "/inventory/reservations", { body: input, idempotencyKey });
  }

  releaseReservation(id: string): Promise<{ reservation: StockReservation }> {
    return this.request("POST", `/inventory/reservations/${encodeURIComponent(id)}/release`);
  }

  listReservations(params: ListReservationsParams): Promise<Page<StockReservation>> {
    return this.request("GET", "/inventory/reservations", { query: params });
  }

  listBalances(params: ListBalancesParams): Promise<{ data: StockBalance[] }> {
    return this.request("GET", "/inventory/balances", { query: params });
  }

  getValuation(params: GetValuationParams): Promise<ValuationResult> {
    return this.request("GET", "/inventory/valuation", { query: params });
  }

  createTransfer(input: CreateTransferInput, idempotencyKey?: string): Promise<CreateTransferResult> {
    return this.request("POST", "/inventory/transfers", { body: input, idempotencyKey });
  }

  getTransfer(id: string): Promise<{ transfer: StockTransfer }> {
    return this.request("GET", `/inventory/transfers/${encodeURIComponent(id)}`);
  }

  listTransfers(params: ListTransfersParams): Promise<Page<StockTransfer>> {
    return this.request("GET", "/inventory/transfers", { query: params });
  }

  dispatchTransfer(id: string): Promise<{ transfer: StockTransfer }> {
    return this.request("POST", `/inventory/transfers/${encodeURIComponent(id)}/dispatch`);
  }

  receiveTransfer(id: string): Promise<{ transfer: StockTransfer }> {
    return this.request("POST", `/inventory/transfers/${encodeURIComponent(id)}/receive`);
  }

  cancelTransfer(id: string): Promise<{ transfer: StockTransfer }> {
    return this.request("POST", `/inventory/transfers/${encodeURIComponent(id)}/cancel`);
  }

  createAdjustment(input: CreateAdjustmentInput, idempotencyKey?: string): Promise<CreateAdjustmentResult> {
    return this.request("POST", "/inventory/adjustments", { body: input, idempotencyKey });
  }

  getAdjustment(id: string): Promise<{ adjustment: StockAdjustment }> {
    return this.request("GET", `/inventory/adjustments/${encodeURIComponent(id)}`);
  }

  listAdjustments(params: ListAdjustmentsParams): Promise<Page<StockAdjustment>> {
    return this.request("GET", "/inventory/adjustments", { query: params });
  }

  submitAdjustment(id: string): Promise<{ adjustment: StockAdjustment }> {
    return this.request("POST", `/inventory/adjustments/${encodeURIComponent(id)}/submit`);
  }

  approveAdjustment(id: string): Promise<{ adjustment: StockAdjustment }> {
    return this.request("POST", `/inventory/adjustments/${encodeURIComponent(id)}/approve`);
  }

  postAdjustment(id: string): Promise<{ adjustment: StockAdjustment }> {
    return this.request("POST", `/inventory/adjustments/${encodeURIComponent(id)}/post`);
  }

  cancelAdjustment(id: string): Promise<{ adjustment: StockAdjustment }> {
    return this.request("POST", `/inventory/adjustments/${encodeURIComponent(id)}/cancel`);
  }

  createCount(input: CreateCountInput, idempotencyKey?: string): Promise<CreateCountResult> {
    return this.request("POST", "/inventory/counts", { body: input, idempotencyKey });
  }

  getCount(id: string): Promise<{ count: StockCount }> {
    return this.request("GET", `/inventory/counts/${encodeURIComponent(id)}`);
  }

  listCounts(params: ListCountsParams): Promise<Page<StockCount>> {
    return this.request("GET", "/inventory/counts", { query: params });
  }

  startCount(id: string): Promise<{ count: StockCount }> {
    return this.request("POST", `/inventory/counts/${encodeURIComponent(id)}/start`);
  }

  updateCountLines(
    id: string,
    lines: { product_id: string; counted_qty: string }[],
  ): Promise<{ count: StockCount }> {
    return this.request("PATCH", `/inventory/counts/${encodeURIComponent(id)}/lines`, {
      body: { lines },
    });
  }

  postCount(id: string): Promise<{ count: StockCount }> {
    return this.request("POST", `/inventory/counts/${encodeURIComponent(id)}/post`);
  }

  cancelCount(id: string): Promise<{ count: StockCount }> {
    return this.request("POST", `/inventory/counts/${encodeURIComponent(id)}/cancel`);
  }

  /* ----- Phase 6: sales ----- */

  createQuotation(
    input: CreateQuotationInput,
    idempotencyKey?: string,
  ): Promise<CreateQuotationResult> {
    return this.request("POST", "/sales/quotations", { body: input, idempotencyKey });
  }

  listQuotations(params: ListQuotationsParams): Promise<Page<QuotationRow>> {
    return this.request("GET", "/sales/quotations", { query: params });
  }

  /** GET /sales/quotations/:id returns the quotation DTO directly (unwrapped). */
  getQuotation(id: string): Promise<Quotation> {
    return this.request("GET", `/sales/quotations/${encodeURIComponent(id)}`);
  }

  updateQuotation(id: string, input: UpdateQuotationInput): Promise<{ quotation: Quotation }> {
    return this.request("PATCH", `/sales/quotations/${encodeURIComponent(id)}`, { body: input });
  }

  sendQuotation(id: string): Promise<{ quotation: Quotation }> {
    return this.request("POST", `/sales/quotations/${encodeURIComponent(id)}/send`);
  }

  withdrawQuotation(id: string): Promise<{ quotation: Quotation }> {
    return this.request("POST", `/sales/quotations/${encodeURIComponent(id)}/withdraw`);
  }

  rejectQuotation(id: string): Promise<{ quotation: Quotation }> {
    return this.request("POST", `/sales/quotations/${encodeURIComponent(id)}/reject`);
  }

  acceptQuotation(
    id: string,
    warehouseId: string,
  ): Promise<{ quotation: Quotation; sales_order: SalesOrder }> {
    return this.request("POST", `/sales/quotations/${encodeURIComponent(id)}/accept`, {
      body: { warehouse_id: warehouseId },
    });
  }

  expireDueQuotations(): Promise<{ expired: number }> {
    return this.request("POST", "/sales/quotations/expire-due");
  }

  createSalesOrder(
    input: CreateSalesOrderInput,
    idempotencyKey?: string,
  ): Promise<CreateSalesOrderResult> {
    return this.request("POST", "/sales/orders", { body: input, idempotencyKey });
  }

  listSalesOrders(params: ListSalesOrdersParams): Promise<Page<SalesOrderRow>> {
    return this.request("GET", "/sales/orders", { query: params });
  }

  /** GET /sales/orders/:id returns the order DTO directly (unwrapped). */
  getSalesOrder(id: string): Promise<SalesOrder> {
    return this.request("GET", `/sales/orders/${encodeURIComponent(id)}`);
  }

  confirmSalesOrder(id: string): Promise<{
    sales_order: SalesOrder;
    reservations: { line_id: string; reservation_id: string }[];
  }> {
    return this.request("POST", `/sales/orders/${encodeURIComponent(id)}/confirm`);
  }

  cancelSalesOrder(id: string): Promise<{ sales_order: SalesOrder }> {
    return this.request("POST", `/sales/orders/${encodeURIComponent(id)}/cancel`);
  }

  createDelivery(
    input: CreateDeliveryInput,
    idempotencyKey?: string,
  ): Promise<{ delivery: Delivery; replayed: boolean }> {
    return this.request("POST", "/sales/deliveries", { body: input, idempotencyKey });
  }

  listDeliveries(params: ListDeliveriesParams): Promise<Page<DeliveryRow>> {
    return this.request("GET", "/sales/deliveries", { query: params });
  }

  /** GET /sales/deliveries/:id returns the delivery DTO directly (unwrapped). */
  getDelivery(id: string): Promise<Delivery> {
    return this.request("GET", `/sales/deliveries/${encodeURIComponent(id)}`);
  }

  postDelivery(id: string): Promise<{
    delivery: Delivery;
    issues: { movement_id: string; cogs: string }[];
  }> {
    return this.request("POST", `/sales/deliveries/${encodeURIComponent(id)}/post`);
  }

  createSalesInvoice(
    input: CreateSalesInvoiceInput,
    idempotencyKey?: string,
  ): Promise<{ invoice: SalesInvoice; replayed: boolean }> {
    return this.request("POST", "/sales/invoices", { body: input, idempotencyKey });
  }

  listSalesInvoices(params: ListSalesInvoicesParams): Promise<Page<SalesInvoiceRow>> {
    return this.request("GET", "/sales/invoices", { query: params });
  }

  /** GET /sales/invoices/:id returns the invoice DTO directly (unwrapped). */
  getSalesInvoice(id: string): Promise<SalesInvoice> {
    return this.request("GET", `/sales/invoices/${encodeURIComponent(id)}`);
  }

  postSalesInvoice(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ invoice: SalesInvoice; journal_id: string }> {
    return this.request("POST", `/sales/invoices/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  createSalesPayment(
    input: CreateSalesPaymentInput,
    idempotencyKey?: string,
  ): Promise<{ payment: SalesPayment; replayed: boolean }> {
    return this.request("POST", "/sales/payments", { body: input, idempotencyKey });
  }

  listSalesPayments(params: ListSalesPaymentsParams): Promise<Page<SalesPaymentRow>> {
    return this.request("GET", "/sales/payments", { query: params });
  }

  /** GET /sales/payments/:id returns the payment DTO directly (unwrapped). */
  getSalesPayment(id: string): Promise<SalesPayment> {
    return this.request("GET", `/sales/payments/${encodeURIComponent(id)}`);
  }

  postSalesPayment(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ payment: SalesPayment; journal_id: string }> {
    return this.request("POST", `/sales/payments/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  createCreditNote(
    input: CreateCreditNoteInput,
    idempotencyKey?: string,
  ): Promise<{ credit_note: CreditNote; replayed: boolean }> {
    return this.request("POST", "/sales/credit-notes", { body: input, idempotencyKey });
  }

  listCreditNotes(params: ListCreditNotesParams): Promise<Page<CreditNoteRow>> {
    return this.request("GET", "/sales/credit-notes", { query: params });
  }

  /** GET /sales/credit-notes/:id returns the credit note DTO directly (unwrapped). */
  getCreditNote(id: string): Promise<CreditNote> {
    return this.request("GET", `/sales/credit-notes/${encodeURIComponent(id)}`);
  }

  postCreditNote(
    id: string,
    opts: { warehouse_id?: string; idempotencyKey?: string } = {},
  ): Promise<{ credit_note: CreditNote; journal_id: string }> {
    return this.request("POST", `/sales/credit-notes/${encodeURIComponent(id)}/post`, {
      body: { warehouse_id: opts.warehouse_id },
      idempotencyKey: opts.idempotencyKey,
    });
  }

  /* ----- Phase 7: purchasing ----- */

  createPurchaseRequest(
    input: CreatePurchaseRequestInput,
    idempotencyKey?: string,
  ): Promise<{ purchase_request: PurchaseRequest; replayed: boolean }> {
    return this.request("POST", "/purchasing/purchase-requests", { body: input, idempotencyKey });
  }

  listPurchaseRequests(params: ListPurchaseRequestsParams): Promise<Page<PurchaseRequestRow>> {
    return this.request("GET", "/purchasing/purchase-requests", { query: params });
  }

  /** GET /purchasing/purchase-requests/:id returns the request DTO directly (unwrapped). */
  getPurchaseRequest(id: string): Promise<PurchaseRequest> {
    return this.request("GET", `/purchasing/purchase-requests/${encodeURIComponent(id)}`);
  }

  submitPurchaseRequest(id: string): Promise<{ purchase_request: PurchaseRequest }> {
    return this.request("POST", `/purchasing/purchase-requests/${encodeURIComponent(id)}/submit`, { body: {} });
  }

  approvePurchaseRequest(id: string): Promise<{ purchase_request: PurchaseRequest }> {
    return this.request("POST", `/purchasing/purchase-requests/${encodeURIComponent(id)}/approve`, { body: {} });
  }

  /** Backend records no rejection reason; kept reason-free by design. */
  rejectPurchaseRequest(id: string): Promise<{ purchase_request: PurchaseRequest }> {
    return this.request("POST", `/purchasing/purchase-requests/${encodeURIComponent(id)}/reject`, { body: {} });
  }

  cancelPurchaseRequest(id: string): Promise<{ purchase_request: PurchaseRequest }> {
    return this.request("POST", `/purchasing/purchase-requests/${encodeURIComponent(id)}/cancel`, { body: {} });
  }

  convertPurchaseRequest(
    id: string,
    input: { supplier_id: string; warehouse_id: string },
  ): Promise<{ purchase_order: PurchaseOrder }> {
    return this.request("POST", `/purchasing/purchase-requests/${encodeURIComponent(id)}/convert`, {
      body: input,
    });
  }

  createPurchaseOrder(
    input: CreatePurchaseOrderInput,
    idempotencyKey?: string,
  ): Promise<{ purchase_order: PurchaseOrder; replayed: boolean }> {
    return this.request("POST", "/purchasing/orders", { body: input, idempotencyKey });
  }

  listPurchaseOrders(params: ListPurchaseOrdersParams): Promise<Page<PurchaseOrderRow>> {
    return this.request("GET", "/purchasing/orders", { query: params });
  }

  /** GET /purchasing/orders/:id returns the order DTO directly (unwrapped). */
  getPurchaseOrder(id: string): Promise<PurchaseOrder> {
    return this.request("GET", `/purchasing/orders/${encodeURIComponent(id)}`);
  }

  submitPurchaseOrder(id: string): Promise<{ purchase_order: PurchaseOrder }> {
    return this.request("POST", `/purchasing/orders/${encodeURIComponent(id)}/submit`, { body: {} });
  }

  approvePurchaseOrder(id: string): Promise<{ purchase_order: PurchaseOrder }> {
    return this.request("POST", `/purchasing/orders/${encodeURIComponent(id)}/approve`, { body: {} });
  }

  rejectPurchaseOrder(id: string): Promise<{ purchase_order: PurchaseOrder }> {
    return this.request("POST", `/purchasing/orders/${encodeURIComponent(id)}/reject`, { body: {} });
  }

  cancelPurchaseOrder(id: string): Promise<{ purchase_order: PurchaseOrder }> {
    return this.request("POST", `/purchasing/orders/${encodeURIComponent(id)}/cancel`, { body: {} });
  }

  createGoodsReceipt(
    input: CreateGoodsReceiptInput,
    idempotencyKey?: string,
  ): Promise<{ goods_receipt: GoodsReceipt; replayed: boolean }> {
    return this.request("POST", "/purchasing/goods-receipts", { body: input, idempotencyKey });
  }

  listGoodsReceipts(params: ListGoodsReceiptsParams): Promise<Page<GoodsReceiptRow>> {
    return this.request("GET", "/purchasing/goods-receipts", { query: params });
  }

  /** GET /purchasing/goods-receipts/:id returns the receipt DTO directly (unwrapped). */
  getGoodsReceipt(id: string): Promise<GoodsReceipt> {
    return this.request("GET", `/purchasing/goods-receipts/${encodeURIComponent(id)}`);
  }

  postGoodsReceipt(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ goods_receipt: GoodsReceipt; replayed: boolean }> {
    return this.request("POST", `/purchasing/goods-receipts/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  cancelGoodsReceipt(id: string): Promise<{ goods_receipt: GoodsReceipt }> {
    return this.request("POST", `/purchasing/goods-receipts/${encodeURIComponent(id)}/cancel`, { body: {} });
  }

  createSupplierBill(
    input: CreateSupplierBillInput,
    idempotencyKey?: string,
  ): Promise<{ supplier_bill: SupplierBill; replayed: boolean }> {
    return this.request("POST", "/purchasing/bills", { body: input, idempotencyKey });
  }

  listSupplierBills(params: ListSupplierBillsParams): Promise<Page<SupplierBillRow>> {
    return this.request("GET", "/purchasing/bills", { query: params });
  }

  /** GET /purchasing/bills/:id returns the bill DTO directly (unwrapped). */
  getSupplierBill(id: string): Promise<SupplierBill> {
    return this.request("GET", `/purchasing/bills/${encodeURIComponent(id)}`);
  }

  submitSupplierBill(id: string): Promise<{ supplier_bill: SupplierBill }> {
    return this.request("POST", `/purchasing/bills/${encodeURIComponent(id)}/submit`, { body: {} });
  }

  approveSupplierBill(id: string): Promise<{ supplier_bill: SupplierBill }> {
    return this.request("POST", `/purchasing/bills/${encodeURIComponent(id)}/approve`, { body: {} });
  }

  postSupplierBill(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ supplier_bill: SupplierBill; journal_id: string }> {
    return this.request("POST", `/purchasing/bills/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  createSupplierPayment(
    input: CreateSupplierPaymentInput,
    idempotencyKey?: string,
  ): Promise<{ supplier_payment: SupplierPayment; replayed: boolean }> {
    return this.request("POST", "/purchasing/payments", { body: input, idempotencyKey });
  }

  listSupplierPayments(params: ListSupplierPaymentsParams): Promise<Page<SupplierPaymentRow>> {
    return this.request("GET", "/purchasing/payments", { query: params });
  }

  /** GET /purchasing/payments/:id returns the payment DTO directly (unwrapped). */
  getSupplierPayment(id: string): Promise<SupplierPayment> {
    return this.request("GET", `/purchasing/payments/${encodeURIComponent(id)}`);
  }

  postSupplierPayment(
    id: string,
    idempotencyKey?: string,
  ): Promise<{ supplier_payment: SupplierPayment; journal_id: string }> {
    return this.request("POST", `/purchasing/payments/${encodeURIComponent(id)}/post`, {
      body: {},
      idempotencyKey,
    });
  }

  /* ----- notifications (Phase 9) ----- */

  listNotifications(params: ListNotificationsParams = {}): Promise<Page<AppNotification>> {
    return this.request("GET", "/notifications", { query: params });
  }

  unreadNotificationCount(): Promise<{ count: number }> {
    return this.request("GET", "/notifications/unread-count");
  }

  markNotificationRead(id: string): Promise<AppNotification> {
    return this.request("POST", `/notifications/${encodeURIComponent(id)}/read`, { body: {} });
  }

  markAllNotificationsRead(): Promise<{ marked: number }> {
    return this.request("POST", "/notifications/read-all", { body: {} });
  }

  /* ----- document PDFs (Phase 9, application/pdf blobs) ----- */

  salesInvoicePdf(id: string): Promise<Blob> {
    return this.requestBlob(`/sales/invoices/${encodeURIComponent(id)}/pdf`);
  }

  quotationPdf(id: string): Promise<Blob> {
    return this.requestBlob(`/sales/quotations/${encodeURIComponent(id)}/pdf`);
  }

  purchaseOrderPdf(id: string): Promise<Blob> {
    return this.requestBlob(`/purchasing/orders/${encodeURIComponent(id)}/pdf`);
  }

  supplierBillPdf(id: string): Promise<Blob> {
    return this.requestBlob(`/purchasing/bills/${encodeURIComponent(id)}/pdf`);
  }

  trialBalancePdf(params: ReportPdfParams): Promise<Blob> {
    return this.requestBlob("/reports/trial-balance/pdf", params);
  }

  balanceSheetPdf(params: ReportPdfParams): Promise<Blob> {
    return this.requestBlob("/reports/balance-sheet/pdf", params);
  }

  profitLossPdf(params: ReportPdfParams): Promise<Blob> {
    return this.requestBlob("/reports/profit-loss/pdf", params);
  }
}

export function createClient(opts?: ClientOptions): AtlasApiClient {
  return new AtlasApiClient(opts);
}
