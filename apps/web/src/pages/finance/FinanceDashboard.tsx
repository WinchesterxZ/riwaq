import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Card,
  ErrorState,
  LoadingBlock,
} from "../../components/ui";
import { Amount, PERMS } from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

function Stat({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string | number | null | undefined;
  suffix?: string;
  tone?: "success" | "danger" | "accent";
}) {
  const tones: Record<string, string> = {
    success: "text-success",
    danger: "text-danger",
    accent: "text-accent-deep",
  };
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <p className={`mt-2 text-2xl font-bold tnum ${tone ? tones[tone] : "text-ink"}`} dir="ltr">
        <Amount value={value} />
        {suffix && <span className="ms-1 text-sm font-semibold text-ink-soft">{suffix}</span>}
      </p>
    </Card>
  );
}

export function FinanceDashboardPage() {
  const { t } = useTranslation();
  const { companyId } = useAuth();

  const q = useQuery({
    queryKey: ["finance-dashboard", companyId],
    queryFn: () => api.financeDashboard(companyId!),
    enabled: !!companyId,
    retry: false,
  });

  const d = q.data;

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.dashboardTitle")}
      subtitle={t("finance.dashboardSubtitle")}
    >
      {q.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : q.isError || !d ? (
        <Card>
          <ErrorState message={q.isError ? errorMessage(q.error, t) : t("common.error")} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="finance-metrics grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={t("finance.revenueMtd")} value={d.revenue_mtd} />
          <Stat label={t("finance.revenueYtd")} value={d.revenue_ytd} />
          <Stat label={t("finance.netProfitYtd")} value={d.net_profit_ytd} tone="success" />
          <Stat
            label={t("finance.grossMarginMtd")}
            value={d.gross_margin_pct_mtd}
            suffix="%"
            tone="accent"
          />
          <Stat
            label={t("finance.grossMarginYtd")}
            value={d.gross_margin_pct_ytd}
            suffix="%"
            tone="accent"
          />
          <Stat label={t("finance.bankBalance")} value={d.bank_balance} />
          <Stat label={t("finance.arTotal")} value={d.ar_total} />
          <Stat label={t("finance.apTotal")} value={d.ap_total} />
          <Stat label={t("finance.overdueAr")} value={d.overdue_ar} tone="danger" />
          <Stat label={t("finance.overdueAp")} value={d.overdue_ap} tone="danger" />
        </div>
      )}
    </FinanceGuard>
  );
}
