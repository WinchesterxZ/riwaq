import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
} from "../components/ui";
import { MarkAllReadButton, useTimeAgo } from "../components/Notifications";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

const PER_PAGE = 15;

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timeAgo = useTimeAgo();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const query = useQuery({
    queryKey: ["notifications", "inbox", page],
    queryFn: () => api.listNotifications({ page, per_page: PER_PAGE }),
    enabled: hasPermission("notification:view"),
    retry: false,
  });

  if (!hasPermission("notification:view")) {
    return (
      <Card className="p-8 text-center text-sm text-ink-soft">{t("common.noPermission")}</Card>
    );
  }

  const all = query.data?.data ?? [];
  const items = unreadOnly ? all.filter((n) => !n.read_at) : all;
  const meta = query.data?.meta;

  const openItem = async (id: string, link: string | null, readAt: string | null) => {
    if (!readAt) {
      try {
        await api.markNotificationRead(id);
        toast.success(t("notifications.markedRead"));
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      } catch (err) {
        toast.error(errorMessage(err, t));
      }
    }
    if (link) navigate(link);
  };

  return (
    <div>
      <PageHeader
        title={t("notifications.inbox")}
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label={t("notifications.unreadOnly")}
                value={unreadOnly ? "unread" : "all"}
                onChange={(e) => {
                  setUnreadOnly(e.target.value === "unread");
                  setPage(1);
                }}
                className="!w-auto text-[13px]"
              >
                <option value="all">{t("common.all")}</option>
                <option value="unread">{t("notifications.unreadOnly")}</option>
              </Select>
            <MarkAllReadButton
              onDone={() => void queryClient.invalidateQueries({ queryKey: ["notifications"] })}
            />
          </div>
        }
      />
      <Card>
        {query.isLoading && <LoadingBlock />}
        {query.isError && <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />}
        {query.data && items.length === 0 && (
          <EmptyState title={t("notifications.empty")} text={t("notifications.emptyHint")} />
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line-soft">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => void openItem(n.id, n.link, n.read_at)}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-start transition-colors hover:bg-surface-soft ${
                    !n.read_at ? "bg-accent-soft/40" : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.read_at ? "bg-accent" : "bg-line"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${!n.read_at ? "font-bold text-ink" : "font-medium text-ink"}`}>
                        {i18n.language === "ar" ? n.title_ar : n.title_en}
                      </span>
                      {!n.read_at && <Badge tone="accent">{t("notifications.unreadOnly")}</Badge>}
                    </span>
                    {(i18n.language === "ar" ? n.body_ar : n.body_en) && (
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                        {i18n.language === "ar" ? n.body_ar : n.body_en}
                      </span>
                    )}
                    <span className="tnum mt-1 block text-xs text-ink-faint">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {meta && (
          <Pagination page={page} totalPages={meta.total_pages} total={meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
