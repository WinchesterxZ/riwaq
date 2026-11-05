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
import {
  AGING_BUCKET_LABEL_KEYS,
  AGING_BUCKETS,
  Amount,
  formatDate,
  PERMS,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { FinanceGuard } from "./shared";

function AgingPage({
  kind,
}: {
  kind: "ar" | "ap";
}) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [asOf, setAsOf] = useState(todayISO());
  const [runKey, setRunKey] = useState(0);

  const report = useQuery({
    queryKey: [kind === "ar" ? "ar-aging" : "ap-aging", companyId, asOf, runKey],
    queryFn: () =>
      kind === "ar" ? api.arAging(companyId!, asOf) : api.apAging(companyId!, asOf),
    enabled: !!companyId && !!asOf,
    retry: false,
  });

  const d = report.data;
  const lines = d?.lines ?? [];

  return (
    <FinanceGuard
      perm={PERMS.financeView}
      title={kind === "ar" ? t("finance.arAgingTitle") : t("finance.apAgingTitle")}
      subtitle={kind === "ar" ? t("finance.arAgingSubtitle") : t("finance.apAgingSubtitle")}
    >
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("finance.asOf")}>
            <TextInput type="date" dir="ltr" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Button onClick={() => setRunKey((k) => k + 1)} disabled={!asOf}>
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
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {AGING_BUCKETS.map((b) => (
              <Card key={b} className="p-4">
                <p className="text-xs font-medium text-ink-soft">{t(AGING_BUCKET_LABEL_KEYS[b])}</p>
                <p className="mt-1 text-lg font-bold text-ink" dir="ltr">
                  <Amount value={d.buckets[b]} />
                </p>
              </Card>
            ))}
            <Card className="border-accent/40 bg-accent-soft/30 p-4">
              <p className="text-xs font-bold text-accent-deep">{t("common.total")}</p>
              <p className="mt-1 text-lg font-bold text-accent-deep" dir="ltr">
                <Amount value={d.total} />
              </p>
            </Card>
          </div>

          <Card>
            {lines.length === 0 ? (
              <EmptyState title={t("reports.noLines")} />
            ) : (
              <Table
                head={[
                  t("finance.docNumber"),
                  t("finance.party"),
                  t("finance.docDate"),
                  t("finance.dueDate"),
                  t("finance.daysOverdue"),
                  t("finance.bucket"),
                  t("finance.outstanding"),
                ]}
              >
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-soft/50">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink" dir="ltr">
                      {l.number}
                    </td>
                    <td className="px-4 py-2.5 text-ink" dir="auto">
                      {lang === "ar" ? l.party_name_ar : l.party_name_en}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                      {formatDate(l.doc_date, lang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                      {formatDate(l.due_date, lang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[13px]" dir="ltr">
                      {l.days_overdue > 0 ? (
                        <Badge tone="danger">{l.days_overdue}</Badge>
                      ) : (
                        <span className="text-ink-soft">0</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft">
                      {t(AGING_BUCKET_LABEL_KEYS[l.bucket])}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                      <Amount value={l.outstanding} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </FinanceGuard>
  );
}

export function ArAgingPage() {
  return <AgingPage kind="ar" />;
}

export function ApAgingPage() {
  return <AgingPage kind="ap" />;
}
