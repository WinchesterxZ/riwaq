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

export function VatReportPage() {
  const { t } = useTranslation();
  const { companyId } = useAuth();

  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: ["vat-report", companyId, from, to, runKey],
    queryFn: () => api.vatReport(companyId!, from, to),
    enabled: !!companyId && !!from && !!to,
    retry: false,
  });

  const d = report.data;

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.vatTitle")}
      subtitle={t("finance.vatSubtitle")}
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
        <Card className="p-5">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">{t("finance.inputVat")}</span>
              <Amount value={d.input_vat_1230} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">{t("finance.outputVat")}</span>
              <Amount value={d.output_vat_2120} />
            </div>
            <div className="flex items-center justify-between border-t-2 border-line pt-3 text-base font-bold">
              <span className="text-ink">{t("finance.netVatPayable")}</span>
              <span dir="ltr" className="tnum text-ink">
                <Amount value={d.net_vat_payable} />
              </span>
            </div>
            <div className="pt-1">
              <Badge tone={Number(d.net_vat_payable) >= 0 ? "warning" : "success"}>
                {Number(d.net_vat_payable) >= 0 ? t("finance.outputVat") : t("finance.inputVat")}
              </Badge>
            </div>
          </div>
        </Card>
      )}
    </FinanceGuard>
  );
}
