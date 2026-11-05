import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  TextInput,
} from "../../components/ui";
import { Amount, monthStartISO, PERMS, todayISO } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

export function CashFlowPage() {
  const { t } = useTranslation();
  const { companyId } = useAuth();

  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: ["cash-flow", companyId, from, to, runKey],
    queryFn: () => api.cashFlow(companyId!, from, to),
    enabled: !!companyId && !!from && !!to,
    retry: false,
  });

  const d = report.data;

  const adj = d
    ? [
        { label: t("finance.netProfit"), value: d.net_profit, bold: true },
        { label: t("finance.changeInReceivables"), value: d.adjustments.change_in_receivables },
        { label: t("finance.changeInInventory"), value: d.adjustments.change_in_inventory },
        { label: t("finance.changeInGrni"), value: d.adjustments.change_in_grni },
        { label: t("finance.changeInInputVat"), value: d.adjustments.change_in_input_vat },
        { label: t("finance.changeInPayables"), value: d.adjustments.change_in_payables },
        { label: t("finance.changeInOutputVat"), value: d.adjustments.change_in_output_vat },
      ]
    : [];

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.cfTitle")}
      subtitle={t("finance.cfSubtitle")}
      actions={
        d && (
          <Badge tone={d.reconciles ? "success" : "danger"}>
            {d.reconciles ? t("finance.reconciles") : t("finance.doesNotReconcile")}
          </Badge>
        )
      }
    >
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("common.from")}>
            <TextInput type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t("common.to")}>
            <TextInput type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button onClick={() => setRunKey((k) => k + 1)} disabled={!from || !to}>
            {t("reports.run")}
          </Button>
        </div>
      </Card>

      {report.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : report.isError ? (
        <Card>
          <ErrorState message={errorMessage(report.error, t)} onRetry={() => report.refetch()} />
        </Card>
      ) : !d ? (
        <Card>
          <EmptyState title={t("reports.runFirst")} />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-line-soft bg-surface-soft/50 px-4 py-3">
              <h2 className="text-sm font-bold text-ink">{t("finance.operating")}</h2>
            </div>
            <div className="p-5">
              <div className="space-y-2 text-sm">
                {adj.map((a) => (
                  <div
                    key={a.label}
                    className={`flex items-center justify-between ${a.bold ? "font-semibold text-ink" : "text-ink-soft"}`}
                  >
                    <span>{a.label}</span>
                    <Amount value={a.value} />
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line-soft pt-2 font-bold text-ink">
                  <span>{t("finance.operating")}</span>
                  <Amount value={d.operating_cash_flow} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t("finance.investing")}</span>
                <Amount value={d.investing_cash_flow} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t("finance.financing")}</span>
                <Amount value={d.financing_cash_flow} />
              </div>
              <div className="flex items-center justify-between border-t border-line-soft pt-2 font-semibold text-ink">
                <span>{t("finance.netChangeInCash")}</span>
                <Amount value={d.net_change_in_cash} />
              </div>
              <div className="flex items-center justify-between text-ink-soft">
                <span>{t("finance.cashMovementPerGl")}</span>
                <Amount value={d.cash_movement_per_gl} />
              </div>
            </div>
          </Card>
        </div>
      )}
    </FinanceGuard>
  );
}
