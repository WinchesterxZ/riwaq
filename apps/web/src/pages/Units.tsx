import type { UnitOfMeasure } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

function UomDialog({
  unit,
  companyId,
  onClose,
  onSaved,
}: {
  unit: UnitOfMeasure | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = unit !== null;

  const [code, setCode] = useState(unit?.code ?? "");
  const [nameAr, setNameAr] = useState(unit?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(unit?.name_en ?? "");
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const input = { code: code.trim(), name_ar: nameAr.trim(), name_en: nameEn.trim() };
      return isEdit && unit
        ? api.updateUnitOfMeasure(unit.id, input)
        : api.createUnitOfMeasure({ company_id: companyId, ...input });
    },
    onSuccess: () => {
      toast.success(t("units.saved"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!code.trim() || !nameAr.trim() || !nameEn.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "units.editUom" : "units.newUom")}>
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("units.code")} required>
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("parties.nameAr")} required>
          <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t("parties.nameEn")} required>
          <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
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

function ConversionDialog({
  units,
  companyId,
  onClose,
  onSaved,
}: {
  units: UnitOfMeasure[];
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const lang = i18n.language;

  const [fromUnitId, setFromUnitId] = useState("");
  const [toUnitId, setToUnitId] = useState("");
  const [factor, setFactor] = useState("");
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createUnitConversion({
        from_uom_id: fromUnitId,
        to_uom_id: toUnitId,
        factor: factor.trim(),
      }),
    onSuccess: () => {
      toast.success(t("units.conversionSaved"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!fromUnitId || !toUnitId || !factor.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (fromUnitId === toUnitId) {
      setFormError(t("units.fromUnit"));
      return;
    }
    if (Number.isNaN(Number(factor.trim())) || Number(factor.trim()) <= 0) {
      setFormError(t("units.factor"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  const unitLabel = (u: UnitOfMeasure) =>
    `${u.code} — ${lang === "ar" ? u.name_ar : u.name_en}`;

  return (
    <Dialog open onClose={onClose} title={t("units.newConversion")}>
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("units.fromUnit")} required>
          <Select value={fromUnitId} onChange={(e) => setFromUnitId(e.target.value)}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("units.toUnit")} required>
          <Select value={toUnitId} onChange={(e) => setToUnitId(e.target.value)}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("units.factor")} required>
          <TextInput
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            dir="ltr"
            inputMode="decimal"
            placeholder="1.0"
          />
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

export function UnitsPage() {
  const { t, i18n } = useTranslation();
  const [uomSearch, setUomSearch] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.masterDataView);
  const canManage = hasPermission(PERMS.masterDataManage);

  const [uomForm, setUomForm] = useState<UnitOfMeasure | null | undefined>(undefined);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uoms = useQuery({
    queryKey: ["units-of-measure", companyId],
    queryFn: () => api.listUnitsOfMeasure(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const conversions = useQuery({
    queryKey: ["unit-conversions", companyId],
    queryFn: () => api.listUnitConversions(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const lang = i18n.language;
  const unitById = new Map((uoms.data ?? []).map((u) => [u.id, u]));
  const unitLabel = (id: string) => {
    const u = unitById.get(id);
    return u ? `${u.code} — ${lang === "ar" ? u.name_ar : u.name_en}` : id;
  };

  const doDeleteConversion = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteUnitConversion(deleteTarget);
      toast.success(t("units.conversionDeleted"));
      setDeleteTarget(null);
      await qc.invalidateQueries({ queryKey: ["unit-conversions"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!canView) {
    return (
      <>
        <PageHeader title={t("units.title")} subtitle={t("units.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("units.title")} subtitle={t("units.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const q = uomSearch.trim().toLowerCase();
  const filteredUoms = (uoms.data ?? []).filter((u) =>
    `${u.code} ${u.name_ar ?? ""} ${u.name_en ?? ""}`.toLowerCase().includes(q),
  );

  return (
    <>
      <PageHeader
        title={t("units.title")}
        subtitle={t("units.subtitle")}
        actions={
          <Button
            size="sm"
            disabled={!canManage}
            title={canManage ? undefined : t("common.noPermission")}
            onClick={() => setUomForm(null)}
          >
            {t("units.newUom")}
          </Button>
        }
      />

      <div className="space-y-4">
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-base font-bold text-ink">{t("units.uomList")}</h2>
            <Field label={t("common.search")}>
              <TextInput
                value={uomSearch}
                onChange={(e) => setUomSearch(e.target.value)}
                placeholder={t("units.searchPlaceholder")}
                className="!w-56"
                aria-label={t("common.search")}
              />
            </Field>
          </div>
          {uoms.isLoading ? (
            <LoadingBlock />
          ) : uoms.isError ? (
            <ErrorState message={errorMessage(uoms.error, t)} onRetry={() => uoms.refetch()} />
          ) : filteredUoms.length === 0 ? (
            <EmptyState title={t("units.noUnits")} />
          ) : (
            <Table head={[t("units.code"), t("common.name"), t("common.status"), ...(canManage ? [t("common.actions")] : [])]}>
              {filteredUoms.map((u) => (
                <tr key={u.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {u.code}
                  </td>
                  <td className="px-4 py-3 text-ink" dir="auto">
                    {lang === "ar" ? u.name_ar : u.name_en}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={u.is_active ? "success" : "danger"}>
                      {u.is_active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <Button variant="ghost" size="sm" onClick={() => setUomForm(u)}>
                        {t("common.edit")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">{t("units.conversions")}</h2>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canManage}
              title={canManage ? undefined : t("common.noPermission")}
              onClick={() => setConversionOpen(true)}
            >
              {t("units.newConversion")}
            </Button>
          </div>
          {conversions.isLoading ? (
            <LoadingBlock />
          ) : conversions.isError ? (
            <ErrorState
              message={errorMessage(conversions.error, t)}
              onRetry={() => conversions.refetch()}
            />
          ) : (conversions.data ?? []).length === 0 ? (
            <EmptyState title={t("units.noConversions")} />
          ) : (
            <Table
              head={[
                t("units.fromUnit"),
                t("units.toUnit"),
                t("units.factor"),
                ...(canManage ? [t("common.actions")] : []),
              ]}
            >
              {(conversions.data ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 text-ink" dir="auto">
                    {unitLabel(c.from_uom.id)}
                  </td>
                  <td className="px-4 py-3 text-ink" dir="auto">
                    {unitLabel(c.to_uom.id)}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                    {String(c.factor)}
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(c.id)}>
                        <span className="text-danger">{t("common.delete")}</span>
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {uomForm !== undefined && (
        <UomDialog
          unit={uomForm}
          companyId={companyId}
          onClose={() => setUomForm(undefined)}
          onSaved={() => {
            setUomForm(undefined);
            void qc.invalidateQueries({ queryKey: ["units-of-measure"] });
          }}
        />
      )}
      {conversionOpen && (
        <ConversionDialog
          units={(uoms.data ?? []).filter((u) => u.is_active)}
          companyId={companyId}
          onClose={() => setConversionOpen(false)}
          onSaved={() => {
            setConversionOpen(false);
            void qc.invalidateQueries({ queryKey: ["unit-conversions"] });
          }}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("units.deleteConversionTitle")}
        text={t("units.deleteConversionText")}
        confirmLabel={t("common.delete")}
        danger
        loading={busy}
        onConfirm={() => void doDeleteConversion()}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
