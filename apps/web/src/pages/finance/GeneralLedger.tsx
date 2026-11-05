import { useMemo, useState } from "react";
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
  Select,
  Table,
  TextInput,
} from "../../components/ui";
import {
  Amount,
  accountLabel,
  formatDate,
  monthStartISO,
  PERMS,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

export function GeneralLedgerPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [runKey, setRunKey] = useState(0);

  const accounts = useQuery({
    queryKey: ["accounts-filtered", companyId],
    queryFn: () => api.listAccountsFiltered(companyId!, {}),
    enabled: !!companyId,
    retry: false,
  });

  const report = useQuery({
    queryKey: ["general-ledger", companyId, from, to, accountId, runKey],
    queryFn: () => api.generalLedger(companyId!, from, to, accountId || undefined),
    enabled: !!companyId && !!from && !!to,
    retry: false,
  });

  const accountOptions = useMemo(() => accounts.data ?? [], [accounts.data]);

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={t("finance.glTitle")}
      subtitle={t("finance.glSubtitle")}
    >
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("finance.account")}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="min-w-52">
              <option value="">{t("finance.allAccounts")}</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a, lang)}
                </option>
              ))}
            </Select>
          </Field>
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
      ) : (report.data?.accounts ?? []).length === 0 ? (
        <Card>
          <EmptyState title={t("reports.noLines")} />
        </Card>
      ) : (
        <div className="space-y-4">
          {report.data!.accounts.map((a) => (
            <Card key={a.account_id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface-soft/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-ink" dir="ltr">
                    {a.code}
                  </span>
                  <span className="text-sm font-semibold text-ink">
                    {lang === "ar" ? a.name_ar : a.name_en}
                  </span>
                  <Badge tone="neutral">{a.type}</Badge>
                </div>
                <div className="flex items-center gap-4 text-[13px] text-ink-soft">
                  <span>
                    {t("finance.openingBalance")}: <Amount value={a.opening_balance} />
                  </span>
                  <span className="font-bold text-ink">
                    {t("finance.closingBalance")}: <Amount value={a.closing_balance} />
                  </span>
                </div>
              </div>
              {a.lines.length === 0 ? (
                <p className="px-4 py-4 text-sm text-ink-soft">{t("reports.noLines")}</p>
              ) : (
                <Table
                  head={[
                    t("finance.date"),
                    t("finance.journal"),
                    t("finance.description"),
                    t("common.debit"),
                    t("common.credit"),
                    t("finance.runningBalance"),
                  ]}
                >
                  {a.lines.map((l, i) => (
                    <tr key={`${l.journal_id}-${i}`} className="hover:bg-surface-soft/50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                        {formatDate(l.posting_date, lang)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                        {l.journal_type}
                      </td>
                      <td className="px-4 py-2.5 text-ink" dir="auto">
                        {l.description || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                        <Amount value={l.debit} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                        <Amount value={l.credit} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                        <Amount value={l.running_balance} />
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}
    </FinanceGuard>
  );
}
