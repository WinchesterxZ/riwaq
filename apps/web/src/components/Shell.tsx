import { Brand } from "./Brand";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { NotificationBell } from "./Notifications";
import { ThemeToggle } from "./ThemeToggle";
import { ConfirmDialog, Select, Spinner } from "./ui";

/* ---------- icons (inline SVG, no emoji) ---------- */

function Icon({ d }: { d: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  dashboard: <Icon d="M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z" />,
  accounts: <Icon d="M4 6h16M4 12h16M4 18h10" />,
  journals: <Icon d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />,
  periods: <Icon d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  trialBalance: <Icon d="M5 4h4v16H5zM11 4h4v10h-4zM17 4h4v7h-4z" />,
  financeDashboard: <Icon d="M4 13a8 8 0 1 1 16 0M12 13l4-4M4 17h16" />,
  generalLedger: <Icon d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 4v12M9 9h7M9 13h7" />,
  balanceSheet: <Icon d="M12 4v16M7 20h10M12 6L5 8m7-2l7 2M5 8l-2 5a3 3 0 0 0 5 0L5 8zM19 8l-2 5a3 3 0 0 0 5 0l-3-5z" />,
  profitLoss: <Icon d="M4 20V10M10 20V4M16 20v-8M20 20H4M14 6l3-3 3 3M17 3v6" />,
  cashFlow: <Icon d="M7 16V8m0 0L4 11m3-3l3 3M17 8v8m0 0l3-3m-3 3l-3-3" />,
  arAging: <Icon d="M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4l3 2" />,
  apAging: <Icon d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l-3 2" />,
  vatReport: <Icon d="M19 5L5 19M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  bankReconciliation: <Icon d="M4 9l8-5 8 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18" />,
  expenseBills: <Icon d="M6 3h12v18H6zM6 7h12M9 12h6M9 16h6" />,
  taxCodes: <Icon d="M19 5L5 19M7.5 9.5a2.5 2.5 0 1 0 0-.01M16.5 15.5a2.5 2.5 0 1 0 0-.01" />,
  users: <Icon d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.74" />,
  roles: <Icon d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z" />,
  audit: <Icon d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" />,
  sessions: <Icon d="M9 3h6v4H9zM7 7H5v14h14V7h-2M10 13h4" />,
  customers: <Icon d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.74" />,
  suppliers: <Icon d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" />,
  products: <Icon d="M20 7l-8-4-8 4v10l8 4 8-4zM4 7l8 4 8-4M12 11v10M8 5.5l8 4" />,
  masterData: <Icon d="M4 5h16M4 10h16M4 15h10M4 20h7" />,
  inventory: <Icon d="M20 7l-8-4-8 4v10l8 4 8-4zM4 7l8 4 8-4M12 11v10M8 5.5l8 4" />,
  balances: <Icon d="M3 5h18M6 5v14M18 5v14M6 12h12" />,
  movements: <Icon d="M7 4v13M4 10l3 3 3-3M17 20V7M14 14l3-3 3 3" />,
  transfers: <Icon d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" />,
  adjustments: <Icon d="M4 8h10M18 8h2M4 16h4M12 16h8M14 4v8M8 12v8" />,
  counts: <Icon d="M9 11l3 3 8-8M4 5h16v14H4z" />,
  valuation: <Icon d="M12 3c4 0 7 1.3 7 3s-3 3-7 3-7-1.3-7-3 3-3 7-3zM5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6" />,
  quotations: <Icon d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4" />,
  orders: <Icon d="M4 4h16v12H4zM4 8h16M8 20h8M12 16v4" />,
  deliveries: <Icon d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a1.6 1.6 0 1 0 0-.01M17 18a1.6 1.6 0 1 0 0-.01" />,
  invoices: <Icon d="M6 3h12v18H6zM9 8h6M9 12h6M12 15v4M9 19h6" />,
  payments: <Icon d="M4 10h16v9H4zM4 7h16l-1-3H5zM8 14h4" />,
  creditNotes: <Icon d="M12 3v10M8 9l4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />,
  purchaseRequests: <Icon d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4M12 21v-3" />,
  purchaseOrders: <Icon d="M4 4h16v12H4zM4 9h16M8 20h8M12 16v4" />,
  goodsReceipts: <Icon d="M12 3v10M8 9l4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />,
  supplierBills: <Icon d="M6 3h12v18H6zM9 8h6M9 12h6M12 15v4M9 19h6" />,
  supplierPayments: <Icon d="M4 10h16v9H4zM4 7h16l-1-3H5zM8 14h4" />,
  notifications: <Icon d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6zM10 20a2.2 2.2 0 0 0 4 0" />,
};

/* ---------- connection status ---------- */

/**
 * Prominent offline banner (desktop + web). When the API is unreachable we
 * show this instead of letting the user act on stale data — mutating actions
 * keep working against the API client (which will fail loudly), but nothing
 * is ever fake-posted: the banner makes the offline state unmissable.
 */
function OfflineBanner() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ready"],
    queryFn: () => api.ready(),
    retry: false,
    refetchInterval: 30_000,
  });
  const online = isLoading || (!isError && data?.status === "ok");
  if (online) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 bg-danger px-4 py-2 text-sm font-medium text-white"
    >
      <span aria-hidden="true">⚠</span>
      {t("header.offlineBanner", "You are offline — changes cannot be saved right now.")}
    </div>
  );
}

function ConnectionStatus() {  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ready"],
    queryFn: () => api.ready(),
    retry: false,
    refetchInterval: 30_000,
  });
  const online = !isLoading && !isError && data?.status === "ok";
  const label = isLoading ? t("header.connectionChecking") : online ? t("header.connectionOnline") : t("header.connectionOffline");
  return (
    <span
      title={label}
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft"
    >
      <span
        className={`h-2 w-2 rounded-full ${isLoading ? "bg-warning" : online ? "bg-success" : "bg-danger"}`}
        aria-hidden="true"
      />
      <span className="hidden lg:inline">{label}</span>
    </span>
  );
}

/* ---------- language toggle ---------- */

function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const next = i18n.language === "ar" ? "en" : "ar";
  return (
    <button
      onClick={() => void i18n.changeLanguage(next)}
      title={t("common.language")}
      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
    >
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}

/* ---------- user menu ---------- */

function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open ]);

  const doLogout = async () => {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    setLogoutOpen(false);
    toast.success(t("header.loggedOut"));
    navigate("/login", { replace: true });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={user?.name ?? t("header.changePassword")}
        className="user-menu-trigger flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-soft"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep">
          {(user?.name ?? "?").trim().charAt(0).toUpperCase()}
        </span>
        <span title={user?.name} className="hidden max-w-36 truncate md:inline">{user?.name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="user-menu-panel absolute end-0 top-full z-[80] mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="px-3 py-2">
            <p className="break-words text-sm font-bold text-ink">{user?.name}</p>
            <p className="break-all text-[13px] text-ink-soft" dir="ltr">{user?.email}</p>
          </div>
          <div className="my-1 border-t border-line-soft" />
          <button
            onClick={() => { setOpen(false); setPwOpen(true); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-surface-soft"
          >
            {t("header.changePassword")}
          </button>
          <button
            onClick={() => { setOpen(false); navigate("/sessions"); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-surface-soft"
          >
            {t("nav.sessions")}
          </button>
          <button
            onClick={() => { setOpen(false); setLogoutOpen(true); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-semibold text-danger hover:bg-danger-soft"
          >
            {t("header.logout")}
          </button>
        </div>
      )}
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <ConfirmDialog
        open={logoutOpen}
        title={t("header.logoutConfirmTitle")}
        text={t("header.logoutConfirmText")}
        confirmLabel={t("header.logout")}
        loading={loggingOut}
        onConfirm={() => void doLogout()}
        onClose={() => setLogoutOpen(false)}
      />
    </div>
  );
}

/* ---------- nav list (shared by desktop sidebar + mobile drawer) ---------- */

interface NavEntry {
  to: string;
  key: string;
  icon: React.ReactNode;
}

function NavGroup({ label, entries, collapsed, onNavigate }: { label: string; entries: NavEntry[]; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = entries.some(item => item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`));
  const [expanded, setExpanded] = useState(active);
  useEffect(() => { if (active) setExpanded(true); }, [active]);
  return <section className="nav-group">
    {!collapsed && <button type="button" className="nav-group-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
      <span>{label}</span><svg className={expanded ? "rotate-180" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>}
    {(collapsed || expanded) && entries.map(item => <NavLink key={item.to} to={item.to}
      end={["/", "/inventory", "/finance"].includes(item.to)} onClick={onNavigate} title={t(`nav.${item.key}`)}
      className={({isActive}) => `nav-entry ${isActive ? "is-active" : ""} ${collapsed ? "is-compact" : ""}`}>
      {item.icon}{!collapsed && <span>{t(`nav.${item.key}`)}</span>}
    </NavLink>)}
  </section>;
}

function NavList({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavEntry[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="workspace-nav flex-1 overflow-y-auto p-3" aria-label={t("nav.menu")}>
      {[
        { label: t("brand.workspace"), test: (p: string) => p === "/" || p === "/notifications" },
        { label: t("nav.sales"), test: (p: string) => p.startsWith("/sales") || p === "/customers" },
        { label: t("brand.purchasing"), test: (p: string) => p.startsWith("/purchasing") || p === "/suppliers" },
        { label: t("nav.inventory"), test: (p: string) => p.startsWith("/inventory") || p === "/products" },
        { label: t("nav.finance"), test: (p: string) => p.startsWith("/finance") || ["/accounts", "/journals", "/periods", "/reports/trial-balance"].includes(p) },
        { label: t("brand.administration"), test: (p: string) => ["/master-data", "/tax-codes", "/users", "/roles", "/audit", "/sessions"].includes(p) },
      ].map(group => {
        const entries = items.filter(item => group.test(item.to));
        if (!entries.length) return null;
        return <NavGroup key={group.label} label={group.label} entries={entries} collapsed={collapsed} onNavigate={onNavigate} />;
      })}
    </nav>
  );
}

/* ---------- shell ---------- */

const ROUTE_LABELS: Record<string, string> = {
  "/": "nav.dashboard",
  "/accounts": "nav.accounts",
  "/journals": "nav.journals",
  "/periods": "nav.periods",
  "/reports/trial-balance": "nav.trialBalance",
  "/finance": "nav.financeDashboard",
  "/finance/general-ledger": "nav.generalLedger",
  "/finance/balance-sheet": "nav.balanceSheet",
  "/finance/profit-loss": "nav.profitLoss",
  "/finance/cash-flow": "nav.cashFlow",
  "/finance/ar-aging": "nav.arAging",
  "/finance/ap-aging": "nav.apAging",
  "/finance/vat": "nav.vatReport",
  "/finance/bank-reconciliation": "nav.bankReconciliation",
  "/finance/expenses": "nav.expenseBills",
  "/tax-codes": "nav.taxCodes",
  "/customers": "nav.customers",
  "/suppliers": "nav.suppliers",
  "/products": "nav.products",
  "/inventory": "nav.inventory",
  "/inventory/balances": "nav.balances",
  "/inventory/movements": "nav.movements",
  "/inventory/transfers": "nav.transfers",
  "/inventory/adjustments": "nav.adjustments",
  "/inventory/counts": "nav.counts",
  "/inventory/valuation": "nav.valuation",
  "/sales/quotations": "nav.quotations",
  "/sales/orders": "nav.orders",
  "/sales/deliveries": "nav.deliveries",
  "/sales/invoices": "nav.invoices",
  "/sales/payments": "nav.payments",
  "/sales/credit-notes": "nav.creditNotes",
  "/purchasing/requests": "nav.purchaseRequests",
  "/purchasing/orders": "nav.purchaseOrders",
  "/purchasing/receipts": "nav.goodsReceipts",
  "/purchasing/bills": "nav.supplierBills",
  "/purchasing/payments": "nav.supplierPayments",
  "/master-data": "nav.masterData",
  "/master-data/categories": "nav.masterData",
  "/master-data/units": "nav.masterData",
  "/users": "nav.users",
  "/roles": "nav.roles",
  "/audit": "nav.auditLog",
  "/sessions": "nav.sessions",
  "/notifications": "nav.notifications",
};

export function Shell() {
  const { t, i18n } = useTranslation();
  const { memberships, orgId, companyId, setOrg, setCompany, hasPermission } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("atlas.sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab") {
        const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button, a, [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [mobileOpen ]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("atlas.sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  };

  const membership = memberships.find((m) => m.organizationId === orgId);
  const companiesQuery = useQuery({
    queryKey: ["companies", orgId],
    queryFn: () => api.listCompanies(),
    enabled: !!orgId,
    retry: false,
  });
  const allCompanies = companiesQuery.data ?? [];
  const allowedCompanyIds = membership?.companyIds ?? [];
  const companies =
    allowedCompanyIds.length > 0
      ? allCompanies.filter((c) => allowedCompanyIds.includes(c.id))
      : allCompanies;

  const navItems = [
    { to: "/", key: "dashboard", icon: ICONS.dashboard, show: true },
    { to: "/accounts", key: "accounts", icon: ICONS.accounts, show: hasPermission("account:view") },
    { to: "/journals", key: "journals", icon: ICONS.journals, show: hasPermission("journal:view") },
    { to: "/periods", key: "periods", icon: ICONS.periods, show: hasPermission("period:view") },
    { to: "/reports/trial-balance", key: "trialBalance", icon: ICONS.trialBalance, show: hasPermission("report:view") },
    { to: "/finance", key: "financeDashboard", icon: ICONS.financeDashboard, show: hasPermission("report:view") },
    { to: "/finance/general-ledger", key: "generalLedger", icon: ICONS.generalLedger, show: hasPermission("report:view") },
    { to: "/finance/balance-sheet", key: "balanceSheet", icon: ICONS.balanceSheet, show: hasPermission("report:view") },
    { to: "/finance/profit-loss", key: "profitLoss", icon: ICONS.profitLoss, show: hasPermission("report:view") },
    { to: "/finance/cash-flow", key: "cashFlow", icon: ICONS.cashFlow, show: hasPermission("report:view") },
    { to: "/finance/ar-aging", key: "arAging", icon: ICONS.arAging, show: hasPermission("report:view") },
    { to: "/finance/ap-aging", key: "apAging", icon: ICONS.apAging, show: hasPermission("report:view") },
    { to: "/finance/vat", key: "vatReport", icon: ICONS.vatReport, show: hasPermission("report:view") },
    { to: "/finance/bank-reconciliation", key: "bankReconciliation", icon: ICONS.bankReconciliation, show: hasPermission("bank_reconciliation:view") },
    { to: "/finance/expenses", key: "expenseBills", icon: ICONS.expenseBills, show: hasPermission("expense_bill:view") },
    { to: "/customers", key: "customers", icon: ICONS.customers, show: hasPermission("customer:view") },
    { to: "/suppliers", key: "suppliers", icon: ICONS.suppliers, show: hasPermission("supplier:view") },
    { to: "/products", key: "products", icon: ICONS.products, show: hasPermission("product:view") },
    { to: "/inventory", key: "inventory", icon: ICONS.inventory, show: hasPermission("stock_balance:view") },
    { to: "/inventory/balances", key: "balances", icon: ICONS.balances, show: hasPermission("stock_balance:view") },
    { to: "/inventory/movements", key: "movements", icon: ICONS.movements, show: hasPermission("stock_movement:view") },
    { to: "/inventory/transfers", key: "transfers", icon: ICONS.transfers, show: hasPermission("stock_transfer:view") },
    { to: "/inventory/adjustments", key: "adjustments", icon: ICONS.adjustments, show: hasPermission("stock_adjustment:view") },
    { to: "/inventory/counts", key: "counts", icon: ICONS.counts, show: hasPermission("inventory_count:view") },
    { to: "/inventory/valuation", key: "valuation", icon: ICONS.valuation, show: hasPermission("inventory_valuation:view") },
    { to: "/sales/quotations", key: "quotations", icon: ICONS.quotations, show: hasPermission("quotation:view") },
    { to: "/sales/orders", key: "orders", icon: ICONS.orders, show: hasPermission("sales_order:view") },
    { to: "/sales/deliveries", key: "deliveries", icon: ICONS.deliveries, show: hasPermission("delivery:view") },
    { to: "/sales/invoices", key: "invoices", icon: ICONS.invoices, show: hasPermission("sales_invoice:view") },
    { to: "/sales/payments", key: "payments", icon: ICONS.payments, show: hasPermission("payment:view") },
    { to: "/sales/credit-notes", key: "creditNotes", icon: ICONS.creditNotes, show: hasPermission("credit_note:view") },
    { to: "/purchasing/requests", key: "purchaseRequests", icon: ICONS.purchaseRequests, show: hasPermission("purchase_request:view") },
    { to: "/purchasing/orders", key: "purchaseOrders", icon: ICONS.purchaseOrders, show: hasPermission("purchase_order:view") },
    { to: "/purchasing/receipts", key: "goodsReceipts", icon: ICONS.goodsReceipts, show: hasPermission("goods_receipt:view") },
    { to: "/purchasing/bills", key: "supplierBills", icon: ICONS.supplierBills, show: hasPermission("supplier_bill:view") },
    { to: "/purchasing/payments", key: "supplierPayments", icon: ICONS.supplierPayments, show: hasPermission("payment:view") },
    { to: "/master-data", key: "masterData", icon: ICONS.masterData, show: hasPermission("master_data:view") },
    { to: "/tax-codes", key: "taxCodes", icon: ICONS.taxCodes, show: hasPermission("tax_code:view") },
    { to: "/users", key: "users", icon: ICONS.users, show: hasPermission("user:view") },
    { to: "/roles", key: "roles", icon: ICONS.roles, show: hasPermission("role:view") },
    { to: "/audit", key: "auditLog", icon: ICONS.audit, show: hasPermission("audit:view") },
    { to: "/sessions", key: "sessions", icon: ICONS.sessions, show: true },
    { to: "/notifications", key: "notifications", icon: ICONS.notifications, show: hasPermission("notification:view") },
  ].filter((i) => i.show);

  const crumbs = location.pathname.split("/").filter(Boolean);
  const crumbLabel =
    ROUTE_LABELS[location.pathname] ??
    (location.pathname.startsWith("/journals/") ? "nav.journals"
      : location.pathname.startsWith("/customers") ? "nav.customers"
      : location.pathname.startsWith("/suppliers") ? "nav.suppliers"
      : location.pathname.startsWith("/products") ? "nav.products"
      : location.pathname.startsWith("/inventory/transfers") ? "nav.transfers"
      : location.pathname.startsWith("/inventory/adjustments") ? "nav.adjustments"
      : location.pathname.startsWith("/inventory/counts") ? "nav.counts"
      : location.pathname.startsWith("/inventory/balances") ? "nav.balances"
      : location.pathname.startsWith("/inventory/movements") ? "nav.movements"
      : location.pathname.startsWith("/inventory/valuation") ? "nav.valuation"
      : location.pathname.startsWith("/sales/quotations") ? "nav.quotations"
      : location.pathname.startsWith("/sales/orders") ? "nav.orders"
      : location.pathname.startsWith("/sales/deliveries") ? "nav.deliveries"
      : location.pathname.startsWith("/sales/invoices") ? "nav.invoices"
      : location.pathname.startsWith("/sales/payments") ? "nav.payments"
      : location.pathname.startsWith("/sales/credit-notes") ? "nav.creditNotes"
      : location.pathname.startsWith("/purchasing/requests") ? "nav.purchaseRequests"
      : location.pathname.startsWith("/purchasing/orders") ? "nav.purchaseOrders"
      : location.pathname.startsWith("/purchasing/receipts") ? "nav.goodsReceipts"
      : location.pathname.startsWith("/purchasing/bills") ? "nav.supplierBills"
      : location.pathname.startsWith("/purchasing/payments") ? "nav.supplierPayments"
      : location.pathname.startsWith("/finance") ? "nav.finance"
      : location.pathname.startsWith("/inventory") ? "nav.inventory"
      : location.pathname.startsWith("/master-data") ? "nav.masterData"
      : "nav.dashboard");

  return (
    <div className="flex min-h-screen bg-paper text-ink">
      <a className="skip-link" href="#main-content">{t("brand.skip")}</a>
      {/* Desktop sidebar */}
      <aside
        className={`workspace-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-e border-line bg-surface transition-all lg:flex ${collapsed ? "w-16" : "w-64"}`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-line-soft px-4">
          <Brand compact={collapsed} />
        </div>
        <NavList items={navItems} collapsed={collapsed} />
        <div className="border-t border-line-soft p-3">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-surface-soft"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={collapsed ? "rotate-180" : ""}>
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!collapsed && <span className="text-xs">{t("nav.collapse")}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[75] lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside ref={drawerRef} className="workspace-sidebar absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e border-line bg-surface shadow-pop">
            <div className="flex h-16 items-center justify-between border-b border-line-soft px-4">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label={t("common.close")}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-soft hover:text-ink"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <NavList items={navItems} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header className="workspace-header sticky top-0 z-[70] flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur lg:gap-3 lg:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label={t("nav.menu")}
            className="workspace-menu-button rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          {/* Org / company switchers */}
          <div className="workspace-scope">
            <label className="scope-field">
            <span>{t("header.organization")}</span>
            <Select
              aria-label={t("header.organization")}
              value={orgId ?? ""}
              onChange={(e) => setOrg(e.target.value || undefined)}
              className="scope-select font-semibold"
              title={t("header.switchOrgHint")}
            >
              {memberships.length === 0 && <option value="">{t("header.noOrganization")}</option>}
              {memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {i18n.language === "ar" ? m.organizationNameAr || m.organizationName : m.organizationName || m.organizationNameAr}
                </option>
              ))}
            </Select>
            </label>
            {companies.length > 0 && (
              <label className="scope-field">
              <span>{t("header.company")}</span>
              <Select
                aria-label={t("header.company")}
                value={companyId ?? ""}
                onChange={(e) => setCompany(e.target.value || undefined)}
                className="scope-select"
                title={companyId ? (i18n.language === "ar" ? companies.find(c => c.id === companyId)?.nameAr || companies.find(c => c.id === companyId)?.name : companies.find(c => c.id === companyId)?.name) : t("header.allCompanies")}
              >
                <option value="">{t("header.allCompanies")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {i18n.language === "ar" ? c.nameAr || c.name : c.name || c.nameAr}
                  </option>
                ))}
              </Select>
              </label>
            )}
          </div>

          <div className="workspace-tools ms-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <span className="hidden xl:inline"><ConnectionStatus /></span>
            <ThemeToggle />
            <NotificationBell />
            <LanguageToggle />
            <UserMenu />
          </div>
        </header>

        {/* Breadcrumbs */}
        <div className="border-b border-line-soft bg-paper px-4 py-2.5 lg:px-6">
          <nav className="flex items-center gap-1.5 text-[13px] text-ink-soft" aria-label="breadcrumb">
            <Link to="/" className="hover:text-accent-deep">{t("nav.dashboard")}</Link>
            {crumbs.length > 0 && location.pathname !== "/" && (
              <>
                <span className="text-ink-faint">/</span>
                <span className="font-semibold text-ink">{t(crumbLabel)}</span>
              </>
            )}
          </nav>
        </div>

        <main id="main-content" tabIndex={-1} className="workspace-main flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function ShellFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 bg-paper text-ink-soft">
      <Spinner />
      <span className="text-sm">{t("common.loading")}</span>
    </div>
  );
}
