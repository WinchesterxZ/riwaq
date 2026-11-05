import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Amount, PERMS, monthStartISO, todayISO } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Table,
  TextInput,
} from "../components/ui";
import { PdfButton } from "../components/PdfButton";

export function TrialBalancePage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.reportsView);

  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: ["trial-balance", companyId, from, to, runKey],
    queryFn: () => api.trialBalance(companyId!, from, to),
    enabled: !!companyId && canView && !!from && !!to,
    retry: false,
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("reports.trialBalanceTitle")} subtitle={t("reports.trialBalanceSubtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("reports.trialBalanceTitle")} subtitle={t("reports.trialBalanceSubtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const lines = report.data?.lines ?? [];
  const lang = i18n.language;

  return (
    <>
      <PageHeader
        title={t("reports.trialBalanceTitle")}
        subtitle={t("reports.trialBalanceSubtitle")}
        actions={
          report.data && (
            <Badge tone={report.data.balanced ? "success" : "danger"}>
              {report.data.balanced ? t("reports.balanced") : t("reports.unbalanced")}
            </Badge>
          )
        }
      />

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
          <PdfButton
            permission={PERMS.reportExport}
            fetch={() => api.trialBalancePdf({ company_id: companyId!, from, to })}
            filename={`trial-balance-${from}-${to}.pdf`}
          />
        </div>
      </Card>

      <Card>
        {report.isLoading ? (
          <LoadingBlock />
        ) : report.isError ? (
          <ErrorState message={errorMessage(report.error, t)} onRetry={() => report.refetch()} />
        ) : lines.length === 0 ? (
          <EmptyState title={t("reports.noLines")} />
        ) : (
          <Table head={[t("common.code"), t("common.name"), t("common.debit"), t("common.credit")]}>
            {lines.map((l) => (
              <tr key={l.account_id} className="hover:bg-surface-soft/50">
                <td className="tnum whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold text-ink" dir="ltr">
                  {l.code}
                </td>
                <td className="px-4 py-2.5 text-ink">{lang === "ar" ? l.name_ar : l.name_en}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                  <Amount value={l.total_debit} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                  <Amount value={l.total_credit} />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line bg-surface-soft/60 font-bold">
              <td colSpan={2} className="px-4 py-3 text-ink">
                {t("common.total")}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-end text-ink">
                <Amount value={report.data!.total_debit} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-end text-ink">
                <Amount value={report.data!.total_credit} />
              </td>
            </tr>
          </Table>
        )}
      </Card>
    </>
  );
}
