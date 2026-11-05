import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, Table } from "../../components/ui";
import {
  MOVEMENT_TYPE_LABEL_KEYS,
  PERMS,
  Qty,
  formatDate,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { InventoryGuard } from "./shared";

export function InventoryDashboardPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const valuation = useQuery({
    queryKey: ["inventory-valuation-summary", companyId],
    queryFn: () => api.getValuation({ company_id: companyId!, per_page: 1 }),
    enabled: !!companyId,
    retry: false,
  });

  const lowStock = useQuery({
    queryKey: ["inventory-low-stock", companyId],
    queryFn: () => api.listBalances({ company_id: companyId!, low_stock_only: true, per_page: 10 }),
    enabled: !!companyId,
    retry: false,
  });

  const recent = useQuery({
    queryKey: ["inventory-recent-movements", companyId],
    queryFn: () => api.listMovements({ company_id: companyId!, per_page: 8 }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <InventoryGuard perm={PERMS.stockBalanceView} title={t("inventory.dashboardTitle")} subtitle={t("inventory.dashboardSubtitle")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-medium text-ink-soft">{t("inventory.totalValue")}</p>
          {valuation.isLoading ? (
            <LoadingBlock />
          ) : valuation.isError ? (
            <ErrorState message={errorMessage(valuation.error, t)} onRetry={() => valuation.refetch()} />
          ) : (
            <p dir="ltr" className="tnum mt-2 text-3xl font-bold text-ink">
              {valuation.data?.meta.total_value ?? "0"}
            </p>
          )}
          <Link to="/inventory/valuation" className="mt-3 inline-block text-sm font-semibold text-accent-deep hover:underline">
            {t("common.viewAll")}
          </Link>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-ink-soft">{t("inventory.lowStockItems")}</p>
          {lowStock.isLoading ? (
            <LoadingBlock />
          ) : lowStock.isError ? (
            <ErrorState message={errorMessage(lowStock.error, t)} onRetry={() => lowStock.refetch()} />
          ) : (
            <p dir="ltr" className="tnum mt-2 text-3xl font-bold text-ink">
              {lowStock.data?.data.length ?? 0}
            </p>
          )}
          <Link to="/inventory/balances" className="mt-3 inline-block text-sm font-semibold text-accent-deep hover:underline">
            {t("common.viewAll")}
          </Link>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between p-4 pb-0">
          <h2 className="text-base font-bold text-ink">{t("inventory.lowStockItems")}</h2>
          <Link to="/inventory/balances" className="text-sm font-semibold text-accent-deep hover:underline">
            {t("common.viewAll")}
          </Link>
        </div>
        {lowStock.isLoading ? (
          <LoadingBlock />
        ) : lowStock.isError ? (
          <ErrorState message={errorMessage(lowStock.error, t)} onRetry={() => lowStock.refetch()} />
        ) : (lowStock.data?.data ?? []).length === 0 ? (
          <EmptyState title={t("inventory.noLowStock")} />
        ) : (
          <Table head={[t("inventory.product"), t("inventory.warehouse"), t("inventory.onHand"), t("inventory.available"), ""]}>
            {(lowStock.data?.data ?? []).map((b) => (
              <tr key={`${b.product_id}-${b.warehouse_id}`} className="hover:bg-surface-soft/50">
                <td className="px-4 py-3 font-medium text-ink" dir="auto">
                  {b.sku} — {lang === "ar" ? b.name_ar : b.name_en}
                </td>
                <td className="px-4 py-3 text-ink-soft" dir="auto">
                  {b.warehouse_name}
                </td>
                <td className="px-4 py-3">
                  <Qty value={b.on_hand} />
                </td>
                <td className="px-4 py-3">
                  <Qty value={b.available} />
                </td>
                <td className="px-4 py-3">
                  <Badge tone="warning">{t("inventory.lowStockBadge")}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between p-4 pb-0">
          <h2 className="text-base font-bold text-ink">{t("inventory.recentMovements")}</h2>
          <Link to="/inventory/movements" className="text-sm font-semibold text-accent-deep hover:underline">
            {t("common.viewAll")}
          </Link>
        </div>
        {recent.isLoading ? (
          <LoadingBlock />
        ) : recent.isError ? (
          <ErrorState message={errorMessage(recent.error, t)} onRetry={() => recent.refetch()} />
        ) : (recent.data?.data ?? []).length === 0 ? (
          <EmptyState title={t("inventory.noMovements")} />
        ) : (
          <Table head={[t("common.date"), t("inventory.type"), t("inventory.product"), t("inventory.warehouse"), t("inventory.quantity")]}>
            {(recent.data?.data ?? []).map((m) => (
              <tr key={m.id} className="hover:bg-surface-soft/50">
                <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatDate(m.movement_date, lang)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone="neutral">{t(MOVEMENT_TYPE_LABEL_KEYS[m.movement_type])}</Badge>
                </td>
                <td className="max-w-56 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                  {m.product ? `${m.product.sku} — ${lang === "ar" ? m.product.nameAr : m.product.nameEn}` : m.product_id}
                </td>
                <td className="px-4 py-3 text-ink-soft" dir="auto">
                  {m.warehouse ? (lang === "ar" ? m.warehouse.nameAr : m.warehouse.name) : m.warehouse_id}
                </td>
                <td className="px-4 py-3">
                  <Qty value={m.quantity} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </InventoryGuard>
  );
}
