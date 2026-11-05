import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Pagination,
  Table,
} from "../../components/ui";
import { PERMS, Qty } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { InventoryGuard, WarehouseSelect } from "./shared";

const PER_PAGE = 20;

export function ValuationPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [warehouseId, companyId]);

  const valuation = useQuery({
    queryKey: ["inventory-valuation", companyId, warehouseId, page],
    queryFn: () =>
      api.getValuation({
        company_id: companyId!,
        warehouse_id: warehouseId || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  const meta = valuation.data?.meta;

  return (
    <InventoryGuard
      perm={PERMS.inventoryValuationView}
      title={t("inventory.valuationTitle")}
      subtitle={t("inventory.valuationSubtitle")}
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("inventory.warehouse")}>
            <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll />
          </Field>
        </div>
      </Card>

      {meta && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <p className="text-sm font-medium text-ink-soft">{t("inventory.grandTotal")}</p>
            <p dir="ltr" className="tnum mt-2 text-2xl font-bold text-ink">
              {meta.total_value}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium text-ink-soft">{t("inventory.lineCount")}</p>
            <p dir="ltr" className="tnum mt-2 text-2xl font-bold text-ink">
              {meta.line_count}
            </p>
          </Card>
        </div>
      )}

      <Card>
        {valuation.isLoading ? (
          <LoadingBlock />
        ) : valuation.isError ? (
          <ErrorState message={errorMessage(valuation.error, t)} onRetry={() => valuation.refetch()} />
        ) : (valuation.data?.data ?? []).length === 0 ? (
          <EmptyState title={t("inventory.noValuation")} />
        ) : (
          <>
            <Table
              head={[
                t("inventory.product"),
                t("inventory.warehouse"),
                t("inventory.quantity"),
                t("inventory.avgCost"),
                t("inventory.totalValue"),
              ]}
            >
              {(valuation.data?.data ?? []).map((v) => (
                <tr key={`${v.product_id}-${v.warehouse_id}`} className="hover:bg-surface-soft/50">
                  <td className="max-w-52 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                    {v.sku} — {i18n.language === "ar" ? v.name_ar : v.name_en}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft" dir="auto">
                    {v.warehouse_name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Qty value={v.on_hand} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <Qty value={v.avg_cost} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    <Qty value={v.total_value} />
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil((meta?.line_count ?? 0) / PER_PAGE))} total={meta?.line_count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </InventoryGuard>
  );
}
