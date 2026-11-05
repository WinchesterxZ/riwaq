import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Table,
} from "../../components/ui";
import { PERMS, Qty } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { InventoryGuard, WarehouseSelect } from "./shared";

export function BalancesPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const [warehouseId, setWarehouseId] = useState("");
  const list = useQuery({
    queryKey: ["inventory-balances", companyId, warehouseId],
    queryFn: () =>
      api.listBalances({
        company_id: companyId!,
        warehouse_id: warehouseId || undefined,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <InventoryGuard
      perm={PERMS.stockBalanceView}
      title={t("inventory.balancesTitle")}
      subtitle={t("inventory.balancesSubtitle")}
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("inventory.warehouse")}>
            <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll />
          </Field>
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <EmptyState title={t("inventory.noBalances")} />
        ) : (
          <>
            <Table
              head={[
                t("inventory.product"),
                t("inventory.warehouse"),
                t("inventory.onHand"),
                t("inventory.reserved"),
                t("inventory.available"),
                t("inventory.avgCost"),
                t("inventory.totalValue"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((b) => (
                <tr key={`${b.product_id}-${b.warehouse_id}`} className="hover:bg-surface-soft/50">
                  <td className="max-w-52 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                    {b.sku} — {i18n.language === "ar" ? b.name_ar : b.name_en}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft" dir="auto">
                    {b.warehouse_name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Qty value={b.on_hand} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Qty value={b.reserved} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    <Qty value={b.available} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <Qty value={b.avg_cost} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <Qty value={b.total_value} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {b.low_stock && <Badge tone="warning">{t("inventory.lowStockBadge")}</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </InventoryGuard>
  );
}
