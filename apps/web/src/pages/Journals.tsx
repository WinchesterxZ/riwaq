import type { JournalStatus } from "@atlas-erp/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Amount,
  JOURNAL_STATUS_LABEL_KEYS,
  PERMS,
  formatDate,
  journalStatusTone,
} from "../lib/accounting";
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
  Pagination,
  Select,
  Table,
  TextInput,
} from "../components/ui";

const PER_PAGE = 15;
const STATUSES: JournalStatus[] = ["draft", "submitted", "approved", "rejected", "posted", "reversed"];

export function JournalsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.journalsView);
  const canCreate = hasPermission(PERMS.journalsCreate);

  const [status, setStatus] = useState<"" | JournalStatus>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [status, from, to, companyId]);

  const locale = i18n.language === "ar" ? "ar-EG" : "en-US";

  const entries = useQuery({
    queryKey: ["journal-entries", companyId, status, from, to, page],
    queryFn: () =>
      api.listJournalEntries({
        company_id: companyId!,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && canView,
    retry: false,
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("journals.title")} subtitle={t("journals.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("journals.title")} subtitle={t("journals.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const rows = entries.data?.data ?? [];
  const meta = entries.data?.meta;

  return (
    <>
      <PageHeader
        title={t("journals.title")}
        subtitle={t("journals.subtitle")}
        actions={
          <Link to="/journals/new">
            <Button size="sm" disabled={!canCreate} title={canCreate ? undefined : t("common.noPermission")}>
              {t("journals.new")}
            </Button>
          </Link>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("journals.statusFilter")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as "" | JournalStatus)}>
              <option value="">{t("journals.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(JOURNAL_STATUS_LABEL_KEYS[s])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.from")}>
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t("common.to")}>
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
          </Field>
        </div>
      </Card>

      <Card>
        {entries.isLoading ? (
          <LoadingBlock />
        ) : entries.isError ? (
          <ErrorState message={errorMessage(entries.error, t)} onRetry={() => entries.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("journals.noLines")} />
        ) : (
          <>
            <Table
              head={[
                t("common.date"),
                t("common.description"),
                t("common.status"),
                t("common.debit"),
                t("common.credit"),
                t("common.actions"),
              ]}
            >
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-surface-soft/50">
                  <td className="tnum whitespace-nowrap px-4 py-3 text-[13px]" dir="ltr">
                    {formatDate(e.posting_date, locale)}
                  </td>
                  <td className="max-w-72 cell-readable px-4 py-3 text-ink">{e.description}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={journalStatusTone(e.status)}>{t(JOURNAL_STATUS_LABEL_KEYS[e.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end text-ink-soft">
                    <Amount value={e.total_debit} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end text-ink-soft">
                    <Amount value={e.total_credit} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/journals/${e.id}`}>
                      <Button variant="secondary" size="sm">
                        {t("journals.details")}
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
            {meta && (
              <Pagination page={meta.page} totalPages={meta.total_pages} total={meta.total} onPage={setPage} />
            )}
          </>
        )}
      </Card>
    </>
  );
}
