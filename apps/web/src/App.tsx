import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
} from "react-router-dom";
import { Shell, ShellFallback } from "./components/Shell";
import { Button, Card } from "./components/ui";
import { api } from "./lib/api";
import { useAuth } from "./lib/auth";
import { errorMessage } from "./lib/errors";
import { AccountsPage } from "./pages/Accounts";
import { AuditLogPage } from "./pages/AuditLog";
import { CategoriesPage } from "./pages/Categories";
import { CustomerDetailPage, CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { FinanceDashboardPage } from "./pages/finance/FinanceDashboard";
import { GeneralLedgerPage } from "./pages/finance/GeneralLedger";
import { BalanceSheetPage } from "./pages/finance/BalanceSheet";
import { ProfitLossPage } from "./pages/finance/ProfitLoss";
import { CashFlowPage } from "./pages/finance/CashFlow";
import { ArAgingPage, ApAgingPage } from "./pages/finance/Aging";
import { VatReportPage } from "./pages/finance/VatReport";
import { BankReconciliationPage } from "./pages/finance/BankReconciliation";
import { ExpensesPage } from "./pages/finance/Expenses";
import { JournalEditorPage } from "./pages/JournalEditor";
import { JournalsPage } from "./pages/Journals";
import { AdjustmentDetailPage, AdjustmentsPage } from "./pages/inventory/Adjustments";
import { BalancesPage } from "./pages/inventory/Balances";
import { CountDetailPage, CountsPage } from "./pages/inventory/Counts";
import { InventoryDashboardPage } from "./pages/inventory/Inventory";
import { MovementsPage } from "./pages/inventory/Movements";
import { TransferDetailPage, TransfersPage } from "./pages/inventory/Transfers";
import { ValuationPage } from "./pages/inventory/Valuation";
import { LoginPage } from "./pages/Login";
import { MasterDataPage } from "./pages/MasterData";
import { NotificationsPage } from "./pages/Notifications";
import { PeriodsPage } from "./pages/Periods";
import { ProductEditorPage } from "./pages/ProductEditor";
import { ProductsPage } from "./pages/Products";
import { RolesPage } from "./pages/Roles";
import { CreditNoteDetailPage, CreditNotesPage } from "./pages/sales/CreditNotes";
import { DeliveriesPage, DeliveryDetailPage } from "./pages/sales/Deliveries";
import { InvoiceDetailPage, InvoicesPage } from "./pages/sales/Invoices";
import { OrderDetailPage, OrdersPage } from "./pages/sales/Orders";
import { PaymentDetailPage, PaymentsPage } from "./pages/sales/Payments";
import { QuotationDetailPage, QuotationsPage } from "./pages/sales/Quotations";
import { GoodsReceiptDetailPage, GoodsReceiptsPage } from "./pages/purchasing/GoodsReceipts";
import { PurchaseOrderDetailPage, PurchaseOrdersPage } from "./pages/purchasing/PurchaseOrders";
import { PurchaseRequestDetailPage, PurchaseRequestsPage } from "./pages/purchasing/PurchaseRequests";
import { SupplierBillDetailPage, SupplierBillsPage } from "./pages/purchasing/SupplierBills";
import { SupplierPaymentDetailPage, SupplierPaymentsPage } from "./pages/purchasing/SupplierPayments";
import { SessionsPage } from "./pages/Sessions";
import { SetupPage } from "./pages/Setup";
import { SupplierDetailPage, SuppliersPage } from "./pages/Suppliers";
import { TaxCodesPage } from "./pages/TaxCodes";
import { TrialBalancePage } from "./pages/TrialBalance";
import { UnitsPage } from "./pages/Units";
import { UsersPage } from "./pages/Users";

/**
 * Redirects to /setup when the API reports first-run mode (zero users exist).
 * Runs on every route except /setup and /login.
 */
function FirstRunGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const firstRun = useQuery({
    queryKey: ["first-run-status"],
    queryFn: () => api.firstRunStatus(),
    retry: false,
    staleTime: 60_000,
  });

  if (location.pathname === "/setup") {
    return <>{children}</>;
  }
  // Wait for the first-run check: rendering children while loading lets
  // RequireAuth bounce a fresh system to /login instead of /setup.
  if (firstRun.isLoading) {
    return <ShellFallback />;
  }
  if (firstRun.data?.firstRun) {
    return <Navigate to="/setup" replace />;
  }
  return <>{children}</>;
}

function AuthError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="max-w-md p-8 text-center">
        <p className="text-sm font-semibold text-ink">{t("common.error")}</p>
        <p className="mt-2 text-sm text-ink-soft">{t("errors.network")}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </Card>
    </div>
  );
}

/** Blocks the shell until GET /auth/me resolves; 401 → /login. */
function RequireAuth() {
  const { isLoading, isAuthed, authFailed, refresh } = useAuth();

  if (isLoading) return <ShellFallback />;
  if (authFailed) return <Navigate to="/login" replace />;
  if (isAuthed) return <Outlet />;
  // Non-401 failure (e.g. server unreachable): honest error, no login loop.
  return <AuthError onRetry={() => void refresh()} />;
}

const router = createBrowserRouter([
  { path: "/login", element: <FirstRunGate><LoginPage /></FirstRunGate> },
  { path: "/setup", element: <SetupPage /> },
  {
    element: (
      <FirstRunGate>
        <RequireAuth />
      </FirstRunGate>
    ),
    children: [
      {
        element: <Shell />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/accounts", element: <AccountsPage /> },
          { path: "/journals", element: <JournalsPage /> },
          { path: "/journals/new", element: <JournalEditorPage isNew /> },
          { path: "/journals/:id", element: <JournalEditorPage /> },
          { path: "/periods", element: <PeriodsPage /> },
          { path: "/reports/trial-balance", element: <TrialBalancePage /> },
          { path: "/finance", element: <FinanceDashboardPage /> },
          { path: "/finance/general-ledger", element: <GeneralLedgerPage /> },
          { path: "/finance/balance-sheet", element: <BalanceSheetPage /> },
          { path: "/finance/profit-loss", element: <ProfitLossPage /> },
          { path: "/finance/cash-flow", element: <CashFlowPage /> },
          { path: "/finance/ar-aging", element: <ArAgingPage /> },
          { path: "/finance/ap-aging", element: <ApAgingPage /> },
          { path: "/finance/vat", element: <VatReportPage /> },
          { path: "/finance/bank-reconciliation", element: <BankReconciliationPage /> },
          { path: "/finance/expenses", element: <ExpensesPage /> },
          { path: "/tax-codes", element: <TaxCodesPage /> },
          { path: "/customers", element: <CustomersPage /> },
          { path: "/customers/:id", element: <CustomerDetailPage /> },
          { path: "/suppliers", element: <SuppliersPage /> },
          { path: "/suppliers/:id", element: <SupplierDetailPage /> },
          { path: "/products", element: <ProductsPage /> },
          { path: "/products/new", element: <ProductEditorPage key="new" isNew /> },
          { path: "/products/:id", element: <ProductEditorPage key="edit" /> },
          { path: "/inventory", element: <InventoryDashboardPage /> },
          { path: "/inventory/balances", element: <BalancesPage /> },
          { path: "/inventory/movements", element: <MovementsPage /> },
          { path: "/inventory/transfers", element: <TransfersPage /> },
          { path: "/inventory/transfers/:id", element: <TransferDetailPage /> },
          { path: "/inventory/adjustments", element: <AdjustmentsPage /> },
          { path: "/inventory/adjustments/:id", element: <AdjustmentDetailPage /> },
          { path: "/inventory/counts", element: <CountsPage /> },
          { path: "/inventory/counts/:id", element: <CountDetailPage /> },
          { path: "/inventory/valuation", element: <ValuationPage /> },
          { path: "/sales/quotations", element: <QuotationsPage /> },
          { path: "/sales/quotations/:id", element: <QuotationDetailPage /> },
          { path: "/sales/orders", element: <OrdersPage /> },
          { path: "/sales/orders/:id", element: <OrderDetailPage /> },
          { path: "/sales/deliveries", element: <DeliveriesPage /> },
          { path: "/sales/deliveries/:id", element: <DeliveryDetailPage /> },
          { path: "/sales/invoices", element: <InvoicesPage /> },
          { path: "/sales/invoices/:id", element: <InvoiceDetailPage /> },
          { path: "/sales/payments", element: <PaymentsPage /> },
          { path: "/sales/payments/:id", element: <PaymentDetailPage /> },
          { path: "/sales/credit-notes", element: <CreditNotesPage /> },
          { path: "/sales/credit-notes/:id", element: <CreditNoteDetailPage /> },
          { path: "/purchasing/requests", element: <PurchaseRequestsPage /> },
          { path: "/purchasing/requests/:id", element: <PurchaseRequestDetailPage /> },
          { path: "/purchasing/orders", element: <PurchaseOrdersPage /> },
          { path: "/purchasing/orders/:id", element: <PurchaseOrderDetailPage /> },
          { path: "/purchasing/receipts", element: <GoodsReceiptsPage /> },
          { path: "/purchasing/receipts/:id", element: <GoodsReceiptDetailPage /> },
          { path: "/purchasing/bills", element: <SupplierBillsPage /> },
          { path: "/purchasing/bills/:id", element: <SupplierBillDetailPage /> },
          { path: "/purchasing/payments", element: <SupplierPaymentsPage /> },
          { path: "/purchasing/payments/:id", element: <SupplierPaymentDetailPage /> },
          { path: "/master-data", element: <MasterDataPage /> },
          { path: "/master-data/categories", element: <CategoriesPage /> },
          { path: "/master-data/units", element: <UnitsPage /> },
          { path: "/users", element: <UsersPage /> },
          { path: "/roles", element: <RolesPage /> },
          { path: "/audit", element: <AuditLogPage /> },
          { path: "/sessions", element: <SessionsPage /> },
          { path: "/notifications", element: <NotificationsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
