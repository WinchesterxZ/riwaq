import type { SessionInfo } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Table,
} from "../components/ui";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState<SessionInfo | null>(null);
  const locale = i18n.language === "ar" ? "ar-EG" : "en-US";

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.sessions(),
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => {
      toast.success(t("sessions.revoked"));
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const rows = sessions.data ?? [];

  return (
    <>
      <PageHeader title={t("sessions.title")} subtitle={t("sessions.subtitle")} />
      <Card>
        {sessions.isLoading ? (
          <LoadingBlock />
        ) : sessions.isError ? (
          <ErrorState message={errorMessage(sessions.error, t)} onRetry={() => sessions.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("sessions.noSessions")} />
        ) : (
          <Table
            head={[
              t("sessions.ip"),
              t("sessions.userAgent"),
              t("sessions.created"),
              t("sessions.lastSeen"),
              t("common.status"),
              t("common.actions"),
            ]}
          >
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-surface-soft/50">
                <td className="tnum px-4 py-3 text-[13px]" dir="ltr">{s.ip ?? "–"}</td>
                <td className="max-w-56 cell-readable px-4 py-3 text-[13px] text-ink-soft" dir="ltr" title={s.userAgent ?? ""}>
                  {s.userAgent ?? "–"}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-[13px] text-ink-soft">
                  {formatDateTime(s.createdAt, locale)}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-[13px] text-ink-soft">
                  {formatDateTime(s.lastSeenAt, locale)}
                </td>
                <td className="px-4 py-3">
                  {s.current && <Badge tone="accent">{t("sessions.current")}</Badge>}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={s.current}
                    title={s.current ? t("sessions.cannotRevokeCurrent") : undefined}
                    onClick={() => setTarget(s)}
                  >
                    {t("sessions.revoke")}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={!!target}
        title={t("sessions.revokeTitle")}
        text={t("sessions.revokeConfirm")}
        confirmLabel={t("sessions.revoke")}
        danger
        loading={revoke.isPending}
        onConfirm={() => target && revoke.mutate(target.id)}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
