import type { AppNotification } from "@atlas-erp/api-client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { isTauri, notifyNative } from "../lib/tauri";
import { Button, ErrorState, Spinner } from "./ui";

/** Short relative time in the current locale, e.g. "منذ 5 دقائق". */
export function useTimeAgo() {
  const { t } = useTranslation();
  return (iso: string): string => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60_000));
    if (mins < 1) return t("notifications.justNow");
    if (mins < 60) return t("notifications.minutesAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("notifications.hoursAgo", { n: hours });
    return t("notifications.daysAgo", { n: Math.floor(hours / 24) });
  };
}

function notificationTitle(n: AppNotification, lang: string): string {
  return lang === "ar" ? n.title_ar : n.title_en;
}

function notificationBody(n: AppNotification, lang: string): string | null {
  return lang === "ar" ? n.body_ar : n.body_en;
}

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timeAgo = useTimeAgo();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canView = hasPermission("notification:view");

  const countQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.unreadNotificationCount(),
    enabled: canView,
    retry: false,
    refetchInterval: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => api.listNotifications({ page: 1, per_page: 10 }),
    enabled: canView && open,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  const unread = countQuery.data?.count ?? 0;

  // Bridge new notifications to native OS notifications (desktop only).
  // The in-app feed stays the source of truth; this never fabricates data.
  const prevUnread = useRef(0);
  useEffect(() => {
    if (!canView || !isTauri() || unread <= prevUnread.current) {
      prevUnread.current = unread;
      return;
    }
    prevUnread.current = unread;
    const latest = listQuery.data?.data?.[0];
    notifyNative({
      title: latest?.title_en ?? t("notifications.title", "Notifications"),
      body: latest?.body_en ?? t("notifications.newNotification", "You have new notifications"),
    });
  }, [canView, unread, listQuery.data, t]);
  if (!canView) return null;
  const items = listQuery.data?.data ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      try {
        await api.markNotificationRead(n.id);
        refresh();
      } catch {
        // Navigation still happens; the inbox shows the unread state.
      }
    }
    if (n.link) navigate(n.link);
    else navigate("/notifications");
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api.markAllNotificationsRead();
      toast.success(t("notifications.allMarkedRead"));
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("header.notifications")}
        aria-label={t("header.notifications")}
        aria-expanded={open}
        className="relative rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6zM10 20a2.2 2.2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="tnum absolute -end-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold on-solid">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-panel absolute end-0 top-full z-[80] mt-2 w-[22rem] max-w-[90vw] rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
            <p className="text-sm font-bold text-ink">{t("header.notifications")}</p>
            <button
              onClick={() => void markAll()}
              disabled={markingAll || unread === 0}
              className="text-xs font-semibold text-accent-deep hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {markingAll ? t("common.loading") : t("header.markAllRead")}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {listQuery.isError && <ErrorState message={errorMessage(listQuery.error, t)} onRetry={() => void listQuery.refetch()} />}
            {listQuery.isLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-ink-soft">
                <Spinner size={18} />
                <span className="text-sm">{t("common.loading")}</span>
              </div>
            )}
            {listQuery.data && items.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">{t("header.noNotifications")}</p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => void openItem(n)}
                className={`flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-start transition-colors hover:bg-surface-soft last:border-0 ${
                  !n.read_at ? "bg-accent-soft/40" : ""
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.read_at ? "bg-accent" : "bg-line"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block break-words text-sm ${!n.read_at ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>
                    {notificationTitle(n, i18n.language)}
                  </span>
                  {notificationBody(n, i18n.language) && (
                    <span className="mt-1 block break-words text-[13px] text-ink-soft">
                      {notificationBody(n, i18n.language)}
                    </span>
                  )}
                  <span className="tnum mt-0.5 block text-[11px] text-ink-faint">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-line-soft px-4 py-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block py-1 text-center text-xs font-semibold text-accent-deep hover:underline"
            >
              {t("header.viewAllNotifications")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Mark all read" helper button used by the notifications inbox page. */
export function MarkAllReadButton({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.markAllNotificationsRead();
          toast.success(t("notifications.allMarkedRead"));
          onDone?.();
        } catch (err) {
          toast.error(errorMessage(err, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("header.markAllRead")}
    </Button>
  );
}
