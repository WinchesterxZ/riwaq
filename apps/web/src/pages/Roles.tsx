import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Table,
  TextInput,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent" aria-hidden="true">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CreateRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState("");

  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.listPermissions(),
    enabled: open,
    retry: false,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const p of permissions.data ?? []) {
      const list = map.get(p.resource) ?? [];
      list.push(p);
      map.set(p.resource, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permissions.data]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.createRole({ name: name.trim(), nameAr: nameAr.trim(), permissionIds: [...selected] }),
    onSuccess: () => {
      toast.success(t("roles.roleCreated"));
      setName("");
      setNameAr("");
      setSelected(new Set());
      setFormError("");
      void qc.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !nameAr.trim()) {
      setFormError(t("auth.requiredField"));
      return;
    }
    if (selected.size === 0) {
      setFormError(t("roles.dialogHint"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open={open} title={t("roles.createRole")} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("roles.roleName")} required>
            <TextInput dir="ltr" value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch Manager" />
          </Field>
          <Field label={t("roles.roleNameAr")} required>
            <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مدير فرع" />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink">
            {t("roles.permissions")} · <span className="tnum">{t("roles.selectedCount", { count: selected.size })}</span>
          </p>
          <p className="mb-3 text-xs text-ink-faint">{t("roles.dialogHint")}</p>
          {permissions.isLoading ? (
            <LoadingBlock />
          ) : permissions.isError ? (
            <ErrorState message={errorMessage(permissions.error, t)} onRetry={() => permissions.refetch()} />
          ) : (
            <div className="max-h-72 space-y-4 overflow-y-auto rounded-xl border border-line-soft p-4">
              {grouped.map(([resource, perms]) => (
                <div key={resource}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft" dir="ltr">
                    {resource}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {perms.map((p) => (
                      <label
                        key={p.id}
                        className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          selected.has(p.id)
                            ? "border-accent bg-accent-soft text-accent-deep"
                            : "border-line text-ink-soft hover:border-ink-faint"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                        <span dir="ltr">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {formError && <p className="text-sm font-medium text-danger">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t("roles.createRole")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const { t, i18n } = useTranslation();
  const { orgId, hasPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const canCreate = hasPermission("role:manage");

  const roles = useQuery({
    queryKey: ["roles", orgId],
    queryFn: () => api.listRoles(),
    enabled: !!orgId,
    retry: false,
  });
  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api.listPermissions(),
    enabled: !!orgId,
    retry: false,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const p of permissions.data ?? []) {
      const list = map.get(p.resource) ?? [];
      list.push(p);
      map.set(p.resource, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permissions.data]);

  const roleList = roles.data ?? [];
  const loading = roles.isLoading || permissions.isLoading;
  const err = roles.error ?? permissions.error;

  return (
    <>
      <PageHeader
        title={t("roles.title")}
        subtitle={t("roles.subtitle")}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              {t("roles.createRole")}
            </Button>
          ) : undefined
        }
      />
      <Card>
        {loading ? (
          <LoadingBlock />
        ) : err ? (
          <ErrorState
            message={errorMessage(err, t)}
            onRetry={() => { roles.refetch(); permissions.refetch(); }}
          />
        ) : roleList.length === 0 ? (
          <EmptyState title={t("roles.noRoles")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-soft/60">
                  <th className="sticky start-0 bg-surface-soft/95 px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    {t("roles.permissionsColumn")}
                  </th>
                  {roleList.map((r) => (
                    <th key={r.id} className="min-w-32 px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-semibold text-ink">
                          {i18n.language === "ar" ? r.nameAr || r.name : r.name}
                        </span>
                        <Badge tone={r.isSystem ? "neutral" : "accent"}>
                          {r.isSystem ? t("roles.systemRole") : t("roles.customRole")}
                        </Badge>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {grouped.map(([resource, perms]) => (
                  <Fragment key={`g-${resource}`}>
                    <tr className="bg-paper">
                      <td colSpan={roleList.length + 1} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink-soft" dir="ltr">
                        {resource}
                      </td>
                    </tr>
                    {perms.map((p) => (
                      <tr key={p.id} className="hover:bg-surface-soft/50">
                        <td className="sticky start-0 bg-surface px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                          {p.name}
                        </td>
                        {roleList.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 text-center">
                            {r.permissions.includes(p.name) ? <span className="inline-flex"><Check /></span> : <span className="text-ink-faint/40">–</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {!canCreate && (
        <p className="mt-3 text-xs text-ink-faint">{t("roles.noCreatePermission")}</p>
      )}
      <p className="mt-1 text-xs text-ink-faint">{t("roles.matrixHint")}</p>
      {canCreate && <CreateRoleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />}
    </>
  );
}
