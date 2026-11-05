import type { AccountingPeriod, FiscalYear } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PERIOD_STATUS_LABEL_KEYS,
  PERMS,
  formatDate,
  periodStatusTone,
} from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  TextInput,
} from "../components/ui";

function FiscalYearForm({
  companyId,
  onSaved,
  onClose,
}: {
  companyId: string;
  onSaved: (year: FiscalYear) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [start, setStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [end, setEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createFiscalYear({
        company_id: companyId,
        name: name.trim(),
        start_date: start,
        end_date: end,
      }),
    onSuccess: (year) => onSaved(year),
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!name.trim() || !start || !end) {
      setFormError(t("validation.required"));
      return;
    }
    if (start > end) {
      setFormError(t("periods.startDate"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t("periods.newFiscalYear")}>
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("periods.yearName")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="2026" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("periods.startDate")} required>
            <TextInput type="date" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("periods.endDate")} required>
            <TextInput type="date" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={mutation.isPending} onClick={save}>
          {t("common.create")}
        </Button>
      </div>
    </Dialog>
  );
}

export function PeriodsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.periodsView);
  const canManage = hasPermission(PERMS.periodsManage);
  const canReopen = hasPermission(PERMS.periodsReopen);

  const [yearId, setYearId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "close" | "lock" | "reopen"; period: AccountingPeriod } | null>(null);

  const locale = i18n.language === "ar" ? "ar-EG" : "en-US";

  const years = useQuery({
    queryKey: ["fiscal-years", companyId],
    queryFn: () => api.listFiscalYears(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  // Default to the first fiscal year once loaded.
  useEffect(() => {
    if (years.data && years.data.length > 0 && !yearId) {
      setYearId(years.data[0].id);
    }
  }, [years.data, yearId]);

  useEffect(() => {
    setYearId("");
  }, [companyId]);

  const periods = useQuery({
    queryKey: ["accounting-periods", yearId],
    queryFn: () => api.listAccountingPeriods(yearId),
    enabled: !!yearId && canView,
    retry: false,
  });

  const periodMutation = useMutation({
    mutationFn: ({ action, id }: { action: "close" | "lock" | "reopen"; id: string }) =>
      action === "close" ? api.closePeriod(id) : action === "lock" ? api.lockPeriod(id) : api.reopenPeriod(id),
    onSuccess: (_data, vars) => {
      toast.success(t(`periods.${vars.action === "close" ? "closed" : vars.action === "lock" ? "locked" : "reopened"}`));
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["accounting-periods", yearId] });
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(errorMessage(err, t));
    },
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("periods.title")} subtitle={t("periods.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("periods.title")} subtitle={t("periods.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const yearList = years.data ?? [];
  const periodList = periods.data ?? [];

  return (
    <>
      <PageHeader
        title={t("periods.title")}
        subtitle={t("periods.subtitle")}
        actions={
          <Button size="sm" disabled={!canManage} onClick={() => setFormOpen(true)}>
            {t("periods.newFiscalYear")}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        {years.isLoading ? (
          <LoadingBlock />
        ) : years.isError ? (
          <ErrorState message={errorMessage(years.error, t)} onRetry={() => years.refetch()} />
        ) : yearList.length === 0 ? (
          <EmptyState title={t("periods.noYears")} />
        ) : (
          <Field label={t("periods.selectYear")}>
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)} className="max-w-xs">
              {yearList.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} · {formatDate(y.start_date, locale)} – {formatDate(y.end_date, locale)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      {yearId && (
        <Card>
          <div className="border-b border-line-soft px-5 py-3">
            <h2 className="text-sm font-bold text-ink">{t("periods.periods")}</h2>
          </div>
          {periods.isLoading ? (
            <LoadingBlock />
          ) : periods.isError ? (
            <ErrorState message={errorMessage(periods.error, t)} onRetry={() => periods.refetch()} />
          ) : periodList.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <Table
              head={[
                t("common.name"),
                t("periods.startDate"),
                t("periods.endDate"),
                t("common.status"),
                t("common.actions"),
              ]}
            >
              {periodList.map((p) => (
                <tr key={p.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-semibold text-ink">{p.name}</td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-[13px] text-ink-soft" dir="ltr">
                    {formatDate(p.start_date, locale)}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-[13px] text-ink-soft" dir="ltr">
                    {formatDate(p.end_date, locale)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={periodStatusTone(p.status)}>{t(PERIOD_STATUS_LABEL_KEYS[p.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-1.5">
                      {p.status === "open" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canManage}
                          onClick={() => setConfirm({ action: "close", period: p })}
                        >
                          {t("periods.close")}
                        </Button>
                      )}
                      {p.status === "closed" && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!canManage}
                            onClick={() => setConfirm({ action: "lock", period: p })}
                          >
                            {t("periods.lock")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!canReopen}
                            onClick={() => setConfirm({ action: "reopen", period: p })}
                          >
                            {t("periods.reopen")}
                          </Button>
                        </>
                      )}
                      {p.status === "locked" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canReopen}
                          onClick={() => setConfirm({ action: "reopen", period: p })}
                        >
                          {t("periods.reopen")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {formOpen && (
        <FiscalYearForm
          companyId={companyId}
          onClose={() => setFormOpen(false)}
          onSaved={(year) => {
            toast.success(t("periods.created"));
            setFormOpen(false);
            void qc.invalidateQueries({ queryKey: ["fiscal-years", companyId] }).then(() => setYearId(year.id));
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={t(confirm ? `periods.${confirm.action}Title` : "periods.closeTitle")}
        text={confirm ? t(`periods.${confirm.action}Text`, { name: confirm.period.name }) : ""}
        confirmLabel={t(confirm ? `periods.${confirm.action}` : "periods.close")}
        danger={confirm?.action !== "reopen"}
        loading={periodMutation.isPending}
        onConfirm={() => confirm && periodMutation.mutate({ action: confirm.action, id: confirm.period.id })}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
