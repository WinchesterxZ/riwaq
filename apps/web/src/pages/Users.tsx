import type { User } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  Pagination,
  Table,
  TextInput,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

const PER_PAGE = 15;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function formatDate(iso: string | null, t: (k: string) => string): string {
  if (!iso) return t("users.never");
  try {
    return new Date(iso).toLocaleString(t("common.date") === "التاريخ" ? "ar-EG" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function UsersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { orgId, hasPermission } = useAuth();

  const canView = hasPermission("user:view");
  const canManage = hasPermission("user:manage");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 400);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<User | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, orgId]);

  const users = useQuery({
    queryKey: ["users", orgId, page, debouncedSearch],
    queryFn: () => api.listUsers({ page, per_page: PER_PAGE, search: debouncedSearch || undefined }),
    enabled: !!orgId && canView,
    retry: false,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) =>
      api.setUserStatus(id, status),
    onSuccess: () => {
      toast.success(t("users.statusUpdated"));
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("users.title")} subtitle={t("users.subtitle")} />
        <Card>
          <EmptyState title={t("users.noPermissionView")} />
        </Card>
      </>
    );
  }

  const rows = users.data?.data ?? [];
  const meta = users.data?.meta;

  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("users.searchPlaceholder")}
            className="!w-64"
            aria-label={t("common.search")}
          />
        }
      />
      <Card>
        {users.isLoading ? (
          <LoadingBlock />
        ) : users.isError ? (
          <ErrorState message={errorMessage(users.error, t)} onRetry={() => users.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("common.noResults")} />
        ) : (
          <>
            <Table head={[t("common.name"), t("common.email"), t("common.status"), t("users.lastLogin"), t("common.actions")]}>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-semibold text-ink">{u.name}</td>
                  <td className="px-4 py-3 text-ink-soft" dir="ltr">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.status === "active" ? "success" : "neutral"}>
                      {u.status === "active" ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  <td className="tnum px-4 py-3 text-[13px] text-ink-soft">{formatDate(u.lastLoginAt, t)}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canManage}
                      title={canManage ? undefined : t("users.noPermissionManage")}
                      onClick={() => setTarget(u)}
                    >
                      {u.status === "active" ? t("users.deactivate") : t("users.activate")}
                    </Button>
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

      <ConfirmDialog
        open={!!target}
        title={t("users.confirmTitle")}
        text={
          target
            ? t(target.status === "active" ? "users.confirmDeactivate" : "users.confirmActivate", { name: target.name })
            : ""
        }
        confirmLabel={target?.status === "active" ? t("users.deactivate") : t("users.activate")}
        danger={target?.status === "active"}
        loading={statusMutation.isPending}
        onConfirm={() =>
          target &&
          statusMutation.mutate({ id: target.id, status: target.status === "active" ? "inactive" : "active" })
        }
        onClose={() => setTarget(null)}
      />
    </>
  );
}
