import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Table,
  TextInput,
} from "../../components/ui";
import { PdfButton } from "../../components/PdfButton";
import { Amount, monthStartISO, PERMS, todayISO } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

function LinesTable({
  lines,
  lang,
}: {
  lines: { code: string; name_ar: string; name_en: string; balance: string | number }[];
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Table head={[t("common.code"), t("finance.account"), t("finance.amount")]}>
      {lines.map((l) => (
        <tr key={l.code} className="hover:bg-surface-soft/50">
          <td className="whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold text-ink" dir="ltr">
            {l.code}
          </td>
          <td className="px-4 py-2.5 text-ink">{lang === "ar" ? l.name_ar : l.name_en}</td>
          <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
            <Amount value={l.balance} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function ProfitLossPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: ["profit-loss", companyId, from, to, runKey],
    queryFn: () => api.profitLoss(companyId!, from, to),
    enabled: !!companyId && !!from && !!to,
    retry: false,
  });

  const d = report.data;

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.plTitle")}
      subtitle={t("finance.plSubtitle")}
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
          <PdfButton
            permission={PERMS.reportExport}
            fetch={() => api.profitLossPdf({ company_id: companyId!, from, to })}
            filename={`profit-loss-${from}-${to}.pdf`}
          />
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
              <h2 className="text-sm font-bold text-ink">{t("finance.revenue")}</h2>
            </div>
            <LinesTable lines={d.revenue_lines} lang={lang} />
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line-soft bg-surface-soft/50 px-4 py-3">
              <h2 className="text-sm font-bold text-ink">{t("finance.expenses")}</h2>
            </div>
            <LinesTable lines={d.expense_lines} lang={lang} />
          </Card>

          <Card className="p-5">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t("finance.totalRevenue")}</span>
                <Amount value={d.total_revenue} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t("finance.cogs")}</span>
                <Amount value={d.cogs} />
              </div>
              <div className="flex items-center justify-between border-t border-line-soft pt-2 font-semibold">
                <span className="text-ink">{t("finance.grossProfit")}</span>
                <span className="text-ink">
                  <Amount value={d.gross_profit} />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t("finance.totalExpenses")}</span>
                <Amount value={d.total_expenses} />
              </div>
              <div className="flex items-center justify-between border-t-2 border-line pt-2 text-base font-bold">
                <span className="text-ink">{t("finance.netProfit")}</span>
                <span className="text-ink">
                  <Amount value={d.net_profit} />
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </FinanceGuard>
  );
}
