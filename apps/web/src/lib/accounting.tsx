import type {
  AccountingPeriodStatus,
  AccountTypeCode,
  JournalStatus,
} from "@atlas-erp/api-client";
import type {
  AdjustmentStatus,
  BankStatementStatus,
  CountStatus,
  CreditNoteStatus,
  DeliveryStatus,
  ExpenseBillStatus,
  GoodsReceiptStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  QuotationStatus,
  SalesInvoiceStatus,
  SalesOrderStatus,
  SalesPaymentStatus,
  StockMovementType,
  SupplierBillStatus,
  SupplierPaymentStatus,
  TransferStatus,
} from "@atlas-erp/api-client";

/**
 * Shared helpers for the Phase 3 accounting UI.
 *
 * Permission names below match the backend's Phase 2/3 vocabulary exactly:
 * singular resource + action ("account:view", "journal:post", "tax_code:manage"…).
 * The backend enforces everything server-side; these only gate UI visibility.
 */
export const PERMS = {
  accountsView: "account:view",
  accountsManage: "account:edit",
  accountsCreate: "account:create",
  journalsView: "journal:view",
  journalsCreate: "journal:create",
  journalsEdit: "journal:edit",
  journalsApprove: "journal:approve",
  journalsPost: "journal:post",
  journalsReverse: "journal:reverse",
  periodsView: "period:view",
  periodsManage: "period:close",
  periodsReopen: "period:reopen",
  reportsView: "report:view",
  reportExport: "report:export",
  taxView: "tax_code:view",
  taxManage: "tax_code:edit",
  taxCreate: "tax_code:create",
  customersView: "customer:view",
  customersCreate: "customer:create",
  customersManage: "customer:edit",
  suppliersView: "supplier:view",
  suppliersCreate: "supplier:create",
  suppliersManage: "supplier:edit",
  productsView: "product:view",
  productsCreate: "product:create",
  productsManage: "product:edit",
  masterDataView: "master_data:view",
  masterDataManage: "master_data:edit",
  stockMovementView: "stock_movement:view",
  stockMovementCreate: "stock_movement:create",
  stockReservationView: "stock_reservation:view",
  stockReservationCreate: "stock_reservation:create",
  stockBalanceView: "stock_balance:view",
  inventoryValuationView: "inventory_valuation:view",
  stockTransferView: "stock_transfer:view",
  stockTransferCreate: "stock_transfer:create",
  stockTransferSubmit: "stock_transfer:submit",
  stockTransferPost: "stock_transfer:post",
  stockAdjustmentView: "stock_adjustment:view",
  stockAdjustmentCreate: "stock_adjustment:create",
  stockAdjustmentSubmit: "stock_adjustment:submit",
  stockAdjustmentApprove: "stock_adjustment:approve",
  stockAdjustmentPost: "stock_adjustment:post",
  inventoryCountView: "inventory_count:view",
  inventoryCountCreate: "inventory_count:create",
  inventoryCountSubmit: "inventory_count:submit",
  inventoryCountPost: "inventory_count:post",
  /* ----- sales (Phase 6) ----- */
  quotationView: "quotation:view",
  quotationCreate: "quotation:create",
  quotationEdit: "quotation:edit",
  quotationSubmit: "quotation:submit",
  quotationManage: "quotation:manage",
  salesOrderView: "sales_order:view",
  salesOrderCreate: "sales_order:create",
  salesOrderEdit: "sales_order:edit",
  salesOrderSubmit: "sales_order:submit",
  deliveryView: "delivery:view",
  deliveryCreate: "delivery:create",
  deliverySubmit: "delivery:submit",
  deliveryPost: "delivery:post",
  salesInvoiceView: "sales_invoice:view",
  salesInvoiceCreate: "sales_invoice:create",
  salesInvoiceSubmit: "sales_invoice:submit",
  salesInvoicePost: "sales_invoice:post",
  paymentView: "payment:view",
  paymentCreate: "payment:create",
  paymentSubmit: "payment:submit",
  paymentPost: "payment:post",
  creditNoteView: "credit_note:view",
  creditNoteCreate: "credit_note:create",
  creditNoteSubmit: "credit_note:submit",
  creditNotePost: "credit_note:post",
  /* ----- purchasing (Phase 7) ----- */
  purchaseRequestView: "purchase_request:view",
  purchaseRequestCreate: "purchase_request:create",
  purchaseRequestSubmit: "purchase_request:submit",
  purchaseRequestApprove: "purchase_request:approve",
  purchaseRequestEdit: "purchase_request:edit",
  purchaseOrderView: "purchase_order:view",
  purchaseOrderCreate: "purchase_order:create",
  purchaseOrderSubmit: "purchase_order:submit",
  purchaseOrderApprove: "purchase_order:approve",
  purchaseOrderEdit: "purchase_order:edit",
  goodsReceiptView: "goods_receipt:view",
  goodsReceiptCreate: "goods_receipt:create",
  goodsReceiptPost: "goods_receipt:post",
  goodsReceiptEdit: "goods_receipt:edit",
  supplierBillView: "supplier_bill:view",
  supplierBillCreate: "supplier_bill:create",
  supplierBillSubmit: "supplier_bill:submit",
  supplierBillApprove: "supplier_bill:approve",
  supplierBillPost: "supplier_bill:post",
  supplierPaymentView: "payment:view",
  supplierPaymentCreate: "payment:create",
  supplierPaymentPost: "payment:post",
  /* ----- finance (Phase 8) ----- */
  financeView: "report:view",
  bankStatementView: "bank_statement:view",
  bankStatementCreate: "bank_statement:create",
  bankStatementPost: "bank_statement:post",
  bankReconciliationView: "bank_reconciliation:view",
  bankReconciliationMatch: "bank_reconciliation:match",
  expenseBillView: "expense_bill:view",
  expenseBillCreate: "expense_bill:create",
  expenseBillSubmit: "expense_bill:submit",
  expenseBillApprove: "expense_bill:approve",
  expenseBillPost: "expense_bill:post",
} as const;

/** Fixed account type codes — the contract has no /account-types endpoint. */
export const ACCOUNT_TYPE_CODES: AccountTypeCode[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

export const ACCOUNT_TYPE_LABEL_KEYS: Record<AccountTypeCode, string> = {
  ASSET: "accounts.typeAsset",
  LIABILITY: "accounts.typeLiability",
  EQUITY: "accounts.typeEquity",
  REVENUE: "accounts.typeRevenue",
  EXPENSE: "accounts.typeExpense",
};

export const JOURNAL_STATUS_LABEL_KEYS: Record<JournalStatus, string> = {
  draft: "journals.statusDraft",
  submitted: "journals.statusSubmitted",
  approved: "journals.statusApproved",
  rejected: "journals.statusRejected",
  posted: "journals.statusPosted",
  reversed: "journals.statusReversed",
};

export type BadgeTone = "neutral" | "success" | "danger" | "accent" | "warning";

export function journalStatusTone(status: JournalStatus): BadgeTone {
  switch (status) {
    case "posted":
      return "success";
    case "approved":
      return "accent";
    case "submitted":
      return "warning";
    case "rejected":
    case "reversed":
      return "danger";
    default:
      return "neutral";
  }
}

export const PERIOD_STATUS_LABEL_KEYS: Record<AccountingPeriodStatus, string> = {
  open: "periods.statusOpen",
  closed: "periods.statusClosed",
  locked: "periods.statusLocked",
};

export function periodStatusTone(status: AccountingPeriodStatus): BadgeTone {
  switch (status) {
    case "open":
      return "success";
    case "closed":
      return "warning";
    case "locked":
      return "danger";
  }
}

export function toNumber(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

const CENT = 100;
/** Parse an amount string/number to integer cents (avoids float drift). */
export function toCents(v: string | number | null | undefined): number {
  return Math.round(toNumber(v) * CENT);
}

/**
 * Format a monetary amount with 2 decimals, always LTR digits.
 * Render inside an element with dir="ltr" (see Amount below).
 */
export function formatAmount(v: string | number | null | undefined): string {
  return (toCents(v) / CENT).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Right-aligned LTR amount cell content. */
export function Amount({ value }: { value: string | number | null | undefined }) {
  return (
    <span dir="ltr" className="tnum">
      {formatAmount(value)}
    </span>
  );
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  // Plain YYYY-MM-DD dates must not shift a day through the timezone.
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { dateStyle: "medium" });
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthStartISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-01`;
}

/* ---------- inventory (Phase 5) ---------- */

export const MOVEMENT_TYPE_LABEL_KEYS: Record<StockMovementType, string> = {
  receive: "inventory.receive",
  issue: "inventory.issue",
  transfer_in: "inventory.transferIn",
  transfer_out: "inventory.transferOut",
  adjustment: "inventory.adjustmentKind",
  return: "inventory.return",
  opening: "inventory.opening",
};

export const TRANSFER_STATUS_LABEL_KEYS: Record<TransferStatus, string> = {
  draft: "inventory.statusDraft",
  dispatched: "inventory.statusDispatched",
  received: "inventory.statusReceived",
  cancelled: "inventory.statusCancelled",
};

export function transferStatusTone(s: TransferStatus): BadgeTone {
  switch (s) {
    case "received":
      return "success";
    case "dispatched":
      return "accent";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const ADJUSTMENT_STATUS_LABEL_KEYS: Record<AdjustmentStatus, string> = {
  draft: "inventory.statusDraft",
  submitted: "inventory.statusSubmitted",
  approved: "inventory.statusApproved",
  posted: "inventory.statusPosted",
  cancelled: "inventory.statusCancelled",
};

export function adjustmentStatusTone(s: AdjustmentStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    case "approved":
      return "accent";
    case "submitted":
      return "warning";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const COUNT_STATUS_LABEL_KEYS: Record<CountStatus, string> = {
  draft: "inventory.statusDraft",
  in_progress: "inventory.statusInProgress",
  posted: "inventory.statusPosted",
  cancelled: "inventory.statusCancelled",
};

export function countStatusTone(s: CountStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    case "in_progress":
      return "accent";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

const DECIMAL_RE = /^\d+(\.\d{1,4})?$/;
const SIGNED_DECIMAL_RE = /^[+-]?\d+(\.\d{1,4})?$/;

/** Validate a quantity decimal string the backend accepts (up to 4 decimals). */
export function isValidDecimal(v: string): boolean {
  return DECIMAL_RE.test(v.trim());
}

export function isValidSignedDecimal(v: string): boolean {
  return SIGNED_DECIMAL_RE.test(v.trim());
}

export function isPositiveDecimal(v: string): boolean {
  if (!isValidDecimal(v)) return false;
  return !/^(0+(\.0{1,4})?)$/.test(v.trim());
}

/** Display a decimal string as-is (never parseFloat for math). */
export function Qty({ value }: { value: string | number | null | undefined }) {
  if (value == null || value === "") return <span dir="ltr">—</span>;
  return (
    <span dir="ltr" className="tnum">
      {String(value)}
    </span>
  );
}

/* ---------- sales (Phase 6) ---------- */

export const QUOTATION_STATUS_LABEL_KEYS: Record<QuotationStatus, string> = {
  draft: "sales.statusDraft",
  sent: "sales.statusSent",
  accepted: "sales.statusAccepted",
  rejected: "sales.statusRejected",
  expired: "sales.statusExpired",
};

export function quotationStatusTone(s: QuotationStatus): BadgeTone {
  switch (s) {
    case "accepted":
      return "success";
    case "sent":
      return "accent";
    case "rejected":
    case "expired":
      return "danger";
    default:
      return "neutral";
  }
}

export const SALES_ORDER_STATUS_LABEL_KEYS: Record<SalesOrderStatus, string> = {
  draft: "sales.statusDraft",
  confirmed: "sales.statusConfirmed",
  partially_delivered: "sales.statusPartiallyDelivered",
  delivered: "sales.statusDelivered",
  invoiced: "sales.statusInvoiced",
  closed: "sales.statusClosed",
  cancelled: "sales.statusCancelled",
};

export function salesOrderStatusTone(s: SalesOrderStatus): BadgeTone {
  switch (s) {
    case "invoiced":
    case "closed":
      return "success";
    case "confirmed":
    case "partially_delivered":
    case "delivered":
      return "accent";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const DELIVERY_STATUS_LABEL_KEYS: Record<DeliveryStatus, string> = {
  draft: "sales.statusDraft",
  posted: "sales.statusPosted",
  partially_invoiced: "sales.statusPartiallyInvoiced",
  invoiced: "sales.statusInvoiced",
};

export function deliveryStatusTone(s: DeliveryStatus): BadgeTone {
  switch (s) {
    case "invoiced":
      return "success";
    case "posted":
    case "partially_invoiced":
      return "accent";
    default:
      return "neutral";
  }
}

export const SALES_INVOICE_STATUS_LABEL_KEYS: Record<SalesInvoiceStatus, string> = {
  draft: "sales.statusDraft",
  posted: "sales.statusPosted",
  partially_paid: "sales.statusPartiallyPaid",
  paid: "sales.statusPaid",
};

export function salesInvoiceStatusTone(s: SalesInvoiceStatus): BadgeTone {
  switch (s) {
    case "paid":
      return "success";
    case "posted":
    case "partially_paid":
      return "accent";
    default:
      return "neutral";
  }
}

export const SALES_PAYMENT_STATUS_LABEL_KEYS: Record<SalesPaymentStatus, string> = {
  draft: "sales.statusDraft",
  posted: "sales.statusPosted",
};

export function salesPaymentStatusTone(s: SalesPaymentStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    default:
      return "neutral";
  }
}

export const CREDIT_NOTE_STATUS_LABEL_KEYS: Record<CreditNoteStatus, string> = {
  draft: "sales.statusDraft",
  posted: "sales.statusPosted",
};

export function creditNoteStatusTone(s: CreditNoteStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    default:
      return "neutral";
  }
}

/* ---------- purchasing (Phase 7) ---------- */

export const PURCHASE_REQUEST_STATUS_LABEL_KEYS: Record<PurchaseRequestStatus, string> = {
  draft: "purchasing.statusDraft",
  submitted: "purchasing.statusSubmitted",
  approved: "purchasing.statusApproved",
  rejected: "purchasing.statusRejected",
  cancelled: "purchasing.statusCancelled",
  ordered: "purchasing.statusOrdered",
};

export function purchaseRequestStatusTone(s: PurchaseRequestStatus): BadgeTone {
  switch (s) {
    case "approved":
    case "ordered":
      return "success";
    case "submitted":
      return "accent";
    case "rejected":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const PURCHASE_ORDER_STATUS_LABEL_KEYS: Record<PurchaseOrderStatus, string> = {
  draft: "purchasing.statusDraft",
  submitted: "purchasing.statusSubmitted",
  approved: "purchasing.statusApproved",
  rejected: "purchasing.statusRejected",
  cancelled: "purchasing.statusCancelled",
  partially_received: "purchasing.statusPartiallyReceived",
  received: "purchasing.statusReceived",
  billed: "purchasing.statusBilled",
  closed: "purchasing.statusClosed",
};

export function purchaseOrderStatusTone(s: PurchaseOrderStatus): BadgeTone {
  switch (s) {
    case "billed":
    case "closed":
      return "success";
    case "approved":
    case "partially_received":
    case "received":
    case "submitted":
      return "accent";
    case "rejected":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const GOODS_RECEIPT_STATUS_LABEL_KEYS: Record<GoodsReceiptStatus, string> = {
  draft: "purchasing.statusDraft",
  posted: "purchasing.statusPosted",
  cancelled: "purchasing.statusCancelled",
};

export function goodsReceiptStatusTone(s: GoodsReceiptStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export const SUPPLIER_BILL_STATUS_LABEL_KEYS: Record<SupplierBillStatus, string> = {
  draft: "purchasing.statusDraft",
  submitted: "purchasing.statusSubmitted",
  approved: "purchasing.statusApproved",
  posted: "purchasing.statusPosted",
  partially_paid: "purchasing.statusPartiallyPaid",
  paid: "purchasing.statusPaid",
};

export function supplierBillStatusTone(s: SupplierBillStatus): BadgeTone {
  switch (s) {
    case "paid":
      return "success";
    case "posted":
    case "partially_paid":
      return "accent";
    default:
      return "neutral";
  }
}

export const SUPPLIER_PAYMENT_STATUS_LABEL_KEYS: Record<SupplierPaymentStatus, string> = {
  draft: "purchasing.statusDraft",
  posted: "purchasing.statusPosted",
};

export function supplierPaymentStatusTone(s: SupplierPaymentStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    default:
      return "neutral";
  }
}

/** Supplier name from the backend's embedded list-row ref (camelCase names). */
export function purchaseSupplierName(
  s: { nameAr?: string | null; nameEn?: string | null; number: string } | null | undefined,
  lang: string,
): string {
  if (!s) return "—";
  const name = lang === "ar" ? s.nameAr ?? s.nameEn : s.nameEn ?? s.nameAr;
  return `${s.number} — ${name ?? ""}`;
}

/* ---------- finance (Phase 8) ---------- */

export const BANK_STATEMENT_STATUS_LABEL_KEYS: Record<BankStatementStatus, string> = {
  draft: "finance.statusDraft",
  posted: "finance.statusPosted",
};

export function bankStatementStatusTone(s: BankStatementStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    default:
      return "neutral";
  }
}

export const EXPENSE_BILL_STATUS_LABEL_KEYS: Record<ExpenseBillStatus, string> = {
  draft: "finance.statusDraft",
  submitted: "finance.statusSubmitted",
  approved: "finance.statusApproved",
  rejected: "finance.statusRejected",
  cancelled: "finance.statusCancelled",
  posted: "finance.statusPosted",
};

export function expenseBillStatusTone(s: ExpenseBillStatus): BadgeTone {
  switch (s) {
    case "posted":
      return "success";
    case "approved":
      return "accent";
    case "submitted":
      return "warning";
    case "rejected":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

/** Aging bucket keys in display order. */
export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL_KEYS: Record<AgingBucket, string> = {
  current: "finance.bucketCurrent",
  d1_30: "finance.bucket1_30",
  d31_60: "finance.bucket31_60",
  d61_90: "finance.bucket61_90",
  d90_plus: "finance.bucket90Plus",
};

/** Account label: code + localized name. */
export function accountLabel(
  a: { code: string; name_ar?: string | null; name_en?: string | null } | null | undefined,
  lang: string,
): string {
  if (!a) return "—";
  const name = lang === "ar" ? a.name_ar ?? a.name_en : a.name_en ?? a.name_ar;
  return `${a.code} — ${name ?? ""}`;
}
