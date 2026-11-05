import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  Table,
  TextInput,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";

const PER_PAGE = 20;

function formatDateTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const { orgId, hasPermission } = useAuth();
  const canView = hasPermission("audit:view");

  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState<{ entityType?: string; action?: string }>({});

  const events = useQuery({
    queryKey: ["audit-events", orgId, page, applied],
    queryFn: () =>
      api.listAuditEvents({ page, per_page: PER_PAGE, ...applied }),
    enabled: !!orgId && canView,
    retry: false,
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
        <Card>
          <EmptyState title={t("audit.noPermission")} />
        </Card>
      </>
    );
  }

  const rows = events.data?.data ?? [];
  const meta = events.data?.meta;
  const locale = i18n.language === "ar" ? "ar-EG" : "en-US";

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied({
      ...(entityType.trim() ? { entityType: entityType.trim() } : {}),
      ...(action.trim() ? { action: action.trim() } : {}),
    });
  };

  const clear = () => {
    setEntityType("");
    setAction("");
    setApplied({});
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <Card>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3 border-b border-line-soft p-4">
          <div className="w-48">
            <Field label={t("audit.entityType")}>
              <TextInput dir="ltr" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="user" />
            </Field>
          </div>
          <div className="w-48">
            <Field label={t("audit.action")}>
              <TextInput dir="ltr" value={action} onChange={(e) => setAction(e.target.value)} placeholder="created" />
            </Field>
          </div>
          <div className="flex gap-2 pb-0.5">
            <Button type="submit" size="sm">{t("audit.applyFilters")}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={clear}>
              {t("audit.clearFilters")}
            </Button>
          </div>
        </form>

        {events.isLoading ? (
          <LoadingBlock />
        ) : events.isError ? (
          <ErrorState message={errorMessage(events.error, t)} onRetry={() => events.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("common.noResults")} />
        ) : (
          <>
            <Table head={[t("common.date"), t("audit.entityType"), t("audit.action"), t("audit.actor"), t("common.id")]}>
              {rows.map((ev) => (
                <tr key={ev.id} className="hover:bg-surface-soft/50">
                  <td className="tnum whitespace-nowrap px-4 py-3 text-[13px] text-ink-soft">
                    {formatDateTime(ev.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3" dir="ltr"><code className="text-[13px]">{ev.entityType}</code></td>
                  <td className="px-4 py-3" dir="ltr"><code className="text-[13px]">{ev.action}</code></td>
                  <td className="tnum px-4 py-3 text-[13px] text-ink-soft" dir="ltr">
                    {ev.actorUserId ?? t("common.notAvailable")}
                  </td>
                  <td className="tnum px-4 py-3 text-[13px] text-ink-faint" dir="ltr">
                    {ev.entityId ?? "–"}
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
