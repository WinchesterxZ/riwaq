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
  Table,
  TextInput,
} from "../../components/ui";
import { PdfButton } from "../../components/PdfButton";
import { Amount, PERMS, todayISO } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

function Section({
  title,
  lines,
  totalLabel,
  total,
  lang,
}: {
  title: string;
  lines: { code: string; name_ar: string; name_en: string; balance: string | number }[];
  totalLabel: string;
  total: string | number;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line-soft bg-surface-soft/50 px-4 py-3">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-soft">—</p>
      ) : (
        <Table head={[t("common.code"), t("finance.account"), t("finance.amount")]}>
          {lines.map((l, i) => (
            <tr key={`${l.code}-${i}`} className="hover:bg-surface-soft/50">
              <td className="whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold text-ink" dir="ltr">
                {l.code || "—"}
              </td>
              <td className="px-4 py-2.5 text-ink">{lang === "ar" ? l.name_ar : l.name_en}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                <Amount value={l.balance} />
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-line bg-surface-soft/60 font-bold">
            <td colSpan={2} className="px-4 py-3 text-ink">
              {totalLabel}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-end text-ink">
              <Amount value={total} />
            </td>
          </tr>
        </Table>
      )}
    </Card>
  );
}

export function BalanceSheetPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [asOf, setAsOf] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: ["balance-sheet", companyId, asOf, runKey],
    queryFn: () => api.balanceSheet(companyId!, asOf),
    enabled: !!companyId && !!asOf,
    retry: false,
  });

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.bsTitle")}
      subtitle={t("finance.bsSubtitle")}
      actions={
        report.data && (
          <Badge tone={report.data.balanced ? "success" : "danger"}>
            {report.data.balanced ? t("finance.aleCheck") : t("reports.unbalanced")}
          </Badge>
        )
      }
    >
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("finance.asOf")}>
            <TextInput type="date" dir="ltr" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Button onClick={() => setRunKey((k) => k + 1)} disabled={!asOf}>
            {t("reports.run")}
          </Button>
          <PdfButton
            permission={PERMS.reportExport}
            fetch={() => api.balanceSheetPdf({ company_id: companyId!, as_of: asOf })}
            filename={`balance-sheet-${asOf}.pdf`}
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
      ) : !report.data ? (
        <Card>
          <EmptyState title={t("reports.runFirst")} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Section
            title={t("finance.assets")}
            lines={report.data.assets}
            totalLabel={t("finance.totalAssets")}
            total={report.data.total_assets}
            lang={lang}
          />
          <Section
            title={t("finance.liabilities")}
            lines={report.data.liabilities}
            totalLabel={t("finance.totalLiabilities")}
            total={report.data.total_liabilities}
            lang={lang}
          />
          <Section
            title={t("finance.equity")}
            lines={report.data.equity}
            totalLabel={t("finance.totalEquity")}
            total={report.data.total_equity}
            lang={lang}
          />
        </div>
      )}
    </FinanceGuard>
  );
}
