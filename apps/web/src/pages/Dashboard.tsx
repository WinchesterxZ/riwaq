import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";

function ModuleIcon({ index }: { index: number }) {
  const paths = ["M5 3h14v18H5zM9 8h6M9 12h6M9 16h3", "M3 7h18v14H3zM7 7V3h10v4M3 12h18M9 16h6", "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 5 9-5M12 12v9", "M4 20V10M10 20V4M16 20v-8M21 20H3"];
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={paths[index]} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { orgId, hasPermission } = useAuth();
  const summary = useQuery({ queryKey: ["dashboard-summary", orgId], queryFn: () => api.dashboardSummary(), enabled: !!orgId, retry: false });
  const modules = [
    { title: "nav.sales", text: "brand.salesText", to: "/sales/invoices", perm: "sales_invoice:view" },
    { title: "brand.purchasing", text: "brand.purchaseText", to: "/purchasing/orders", perm: "purchase_order:view" },
    { title: "nav.inventory", text: "brand.stockText", to: "/inventory", perm: "stock_balance:view" },
    { title: "nav.finance", text: "brand.financeText", to: "/finance", perm: "report:view" },
  ];
  return <>
    <PageHeader title={t("brand.overview")} subtitle={t("brand.today")} actions={<span className="dashboard-date">{new Intl.DateTimeFormat(i18n.language === "ar" ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span>} />
    <section className="workspace-banner">
      <div><h2>{t("brand.tagline")}</h2><p>{t("brand.intro")}</p></div>
      <div className="arch-art" aria-hidden="true"><i /><i /><i /></div>
    </section>
    <div className="section-title"><h2>{t("brand.directory")}</h2><p>{t("brand.directoryText")}</p></div>
    {!orgId ? <Card><EmptyState title={t("dashboard.emptyTitle")} text={t("dashboard.selectOrg")} /></Card>
      : summary.isLoading ? <Card><LoadingBlock /></Card>
      : summary.isError ? <Card><ErrorState message={errorMessage(summary.error, t)} onRetry={() => summary.refetch()} /></Card>
      : <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {([
          ["users", "peopleText"], ["companies", "companyText"], ["branches", "branchText"], ["warehouses", "warehouseText"],
        ] as const).map(([key, caption], i) => <Card key={key} className="p-5">
          <div className="flex items-center justify-between gap-2"><p className="text-[13px] text-ink-soft">{t(`dashboard.${key}`)}</p><span className="stat-icon"><ModuleIcon index={i} /></span></div>
          <p className="stat-value tnum">{summary.data?.[key]?.toLocaleString("en-US") ?? "0"}</p>
          <p className="stat-caption">{t(`brand.${caption}`)}</p>
        </Card>)}
      </div>}
    <div className="section-title"><h2>{t("brand.modules")}</h2><p>{t("brand.modulesText")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {modules.map((m, index) => hasPermission(m.perm) && <Link className="module-link" to={m.to} key={m.to}>
        <span className="text-accent-deep"><ModuleIcon index={index} /></span><h3>{t(m.title)}</h3><p>{t(m.text)}</p>
        <span className="module-open">{t("brand.open")}<span aria-hidden="true">{i18n.language === "ar" ? "←" : "→"}</span></span>
      </Link>)}
    </div>
    {!modules.some(m => hasPermission(m.perm)) && <Card><EmptyState title={t("brand.noModules")} /></Card>}
  </>;
}
