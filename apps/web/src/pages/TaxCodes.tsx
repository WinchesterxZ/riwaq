import type { TaxCode } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PERMS, toNumber } from "../lib/accounting";
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

function TaxCodeForm({
  taxCode,
  companyId,
  onSaved,
  onClose,
}: {
  taxCode: TaxCode | null;
  companyId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const isEdit = !!taxCode;

  const [nameAr, setNameAr] = useState(taxCode?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(taxCode?.name_en ?? "");
  const [rate, setRate] = useState(taxCode ? String(taxCode.rate) : "14");
  const [type, setType] = useState(taxCode?.type ?? "");
  const [taxAccountId, setTaxAccountId] = useState(taxCode?.tax_account_id ?? "");
  const [formError, setFormError] = useState("");

  const accounts = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => api.listAccounts(companyId),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && taxCode
        ? api.updateTaxCode(taxCode.id, {
            name_ar: nameAr.trim(),
            name_en: nameEn.trim(),
            rate: toNumber(rate),
            type: type.trim(),
            tax_account_id: taxAccountId || null,
          })
        : api.createTaxCode({
            company_id: companyId,
            name_ar: nameAr.trim(),
            name_en: nameEn.trim(),
            rate: toNumber(rate),
            type: type.trim(),
            tax_account_id: taxAccountId || null,
          }),
    onSuccess: () => {
      toast.success(t(isEdit ? "tax.updated" : "tax.created"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!nameAr.trim() || !nameEn.trim() || !type.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (!Number.isFinite(toNumber(rate)) || toNumber(rate) < 0) {
      setFormError(t("tax.rate"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  const lang = i18n.language;

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "tax.edit" : "tax.new")} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("tax.nameAr")} required>
          <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t("tax.nameEn")} required>
          <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("tax.rate")} required>
          <TextInput
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
        <Field label={t("tax.taxType")} required>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t("common.selectPlaceholder")}</option>
            <option value="input">{lang === "ar" ? "مدخلات" : "Input"}</option>
            <option value="output">{lang === "ar" ? "مخرجات" : "Output"}</option>
            <option value="exempt">{lang === "ar" ? "معفاة" : "Exempt"}</option>
            <option value="zero">{lang === "ar" ? "صفرية" : "Zero rated"}</option>
          </Select>
        </Field>
        <Field label={t("tax.taxAccount")} required={false}>
          <Select value={taxAccountId} onChange={(e) => setTaxAccountId(e.target.value)}>
            <option value="">{t("tax.noAccount")}</option>
            {(accounts.data ?? [])
              .filter((a) => a.is_active && a.is_postable)
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {lang === "ar" ? a.name_ar : a.name_en}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={mutation.isPending} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

export function TaxCodesPage() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.taxView);
  const canManage = hasPermission(PERMS.taxManage);

  const [formCode, setFormCode] = useState<TaxCode | null | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<TaxCode | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);

  const codes = useQuery({
    queryKey: ["tax-codes", companyId],
    queryFn: () => api.listTaxCodes(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const accounts = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => api.listAccounts(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const accountName = (id: string | null | undefined) => {
    if (!id) return t("tax.noAccount");
    const a = (accounts.data ?? []).find((x) => x.id === id);
    if (!a) return t("tax.noAccount");
    return `${a.code} — ${i18n.language === "ar" ? a.name_ar : a.name_en}`;
  };

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.deactivateTaxCode(id),
    onSuccess: () => {
      toast.success(t("tax.deactivated"));
      setDeactivateTarget(null);
      void qc.invalidateQueries({ queryKey: ["tax-codes", companyId] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const seedMutation = useMutation({
    mutationFn: () => api.seedStandardTaxCodes(companyId!),
    onSuccess: (res) => {
      toast.success(t("tax.seedSuccess", { count: res.created }));
      setSeedOpen(false);
      void qc.invalidateQueries({ queryKey: ["tax-codes", companyId] });
    },
    onError: (err) => {
      setSeedOpen(false);
      toast.error(errorMessage(err, t));
    },
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("tax.title")} subtitle={t("tax.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("tax.title")} subtitle={t("tax.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = (codes.data ?? []).filter((c) =>
    `${c.name_ar ?? ""} ${c.name_en ?? ""} ${c.type ?? ""}`.toLowerCase().includes(q),
  );
  const lang = i18n.language;

  return (
    <>
      <PageHeader
        title={t("tax.title")}
        subtitle={t("tax.subtitle")}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => setSeedOpen(true)}>
              {t("tax.seed")}
            </Button>
            <Button size="sm" disabled={!hasPermission(PERMS.taxCreate)} onClick={() => setFormCode(null)}>
              {t("tax.new")}
            </Button>
          </>
        }
      />
      <Card>
        <div className="border-b border-line-soft px-4 py-3">
          <Field label={t("common.search")}>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tax.searchPlaceholder")}
              className="!w-64"
              aria-label={t("common.search")}
            />
          </Field>
        </div>
        {codes.isLoading ? (
          <LoadingBlock />
        ) : codes.isError ? (
          <ErrorState message={errorMessage(codes.error, t)} onRetry={() => codes.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("tax.noTaxCodes")} />
        ) : (
          <Table
            head={[
              t("common.name"),
              t("tax.rate"),
              t("tax.taxType"),
              t("tax.taxAccount"),
              t("common.status"),
              t("common.actions"),
            ]}
          >
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-soft/50">
                <td className="px-4 py-3 font-semibold text-ink">
                  {lang === "ar" ? c.name_ar : c.name_en}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                  {toNumber(c.rate)}%
                </td>
                <td className="px-4 py-3 text-ink-soft">{c.type}</td>
                <td className="px-4 py-3 text-[13px] text-ink-soft">{accountName(c.tax_account_id)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone={c.is_active ? "success" : "neutral"}>
                    {c.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex gap-1.5">
                    <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => setFormCode(c)}>
                      {t("common.edit")}
                    </Button>
                    {c.is_active && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => setDeactivateTarget(c)}
                      >
                        {t("common.deactivate")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {formCode !== undefined && (
        <TaxCodeForm
          taxCode={formCode}
          companyId={companyId}
          onClose={() => setFormCode(undefined)}
          onSaved={() => {
            setFormCode(undefined);
            void qc.invalidateQueries({ queryKey: ["tax-codes", companyId] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title={t("tax.deactivateTitle")}
        text={deactivateTarget ? t("tax.deactivateText", { name: deactivateTarget.name_ar }) : ""}
        confirmLabel={t("common.deactivate")}
        danger
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onClose={() => setDeactivateTarget(null)}
      />

      <ConfirmDialog
        open={seedOpen}
        title={t("tax.seedTitle")}
        text={t("tax.seedText")}
        confirmLabel={t("common.confirm")}
        loading={seedMutation.isPending}
        onConfirm={() => seedMutation.mutate()}
        onClose={() => setSeedOpen(false)}
      />
    </>
  );
}
