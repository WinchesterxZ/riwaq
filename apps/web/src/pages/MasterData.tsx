import type { DocumentSequence, PaymentTerm } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
  Table,
  TextInput,
} from "../components/ui";
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

/* ---------- payment terms ---------- */

function PaymentTermDialog({
  term,
  companyId,
  onClose,
  onSaved,
}: {
  term: PaymentTerm | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = term !== null;

  const [nameAr, setNameAr] = useState(term?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(term?.name_en ?? "");
  const [daysDue, setDaysDue] = useState(term ? String(term.days) : "0");
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        days: Math.trunc(Number(daysDue)),
      };
      return isEdit && term
        ? api.updatePaymentTerm(term.id, input)
        : api.createPaymentTerm({ company_id: companyId, ...input });
    },
    onSuccess: () => {
      toast.success(t("paymentTerms.saved"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!nameAr.trim() || !nameEn.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (!Number.isFinite(Number(daysDue)) || Number(daysDue) < 0) {
      setFormError(t("paymentTerms.daysDue"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "paymentTerms.edit" : "paymentTerms.new")} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("paymentTerms.daysDue")} required>
          <TextInput
            value={daysDue}
            onChange={(e) => setDaysDue(e.target.value)}
            dir="ltr"
            inputMode="numeric"
          />
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

function PaymentTermsCard({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const lang = i18n.language;

  const [formTerm, setFormTerm] = useState<PaymentTerm | null | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<PaymentTerm | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["payment-terms", companyId],
    queryFn: () => api.listPaymentTerms(companyId),
    retry: false,
  });

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    try {
      await api.deactivatePaymentTerm(deactivateTarget.id);
      toast.success(t("paymentTerms.deactivated"));
      setDeactivateTarget(null);
      await qc.invalidateQueries({ queryKey: ["payment-terms"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-ink">{t("paymentTerms.title")}</h2>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage}
          title={canManage ? undefined : t("common.noPermission")}
          onClick={() => setFormTerm(null)}
        >
          {t("paymentTerms.new")}
        </Button>
      </div>
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("paymentTerms.noTerms")} />
      ) : (
        <Table
          head={[
            t("common.name"),
            t("paymentTerms.daysDue"),
            t("common.status"),
            ...(canManage ? [t("common.actions")] : []),
          ]}
        >
          {(list.data ?? []).map((pt) => (
            <tr key={pt.id} className="hover:bg-surface-soft/50">
              <td className="px-4 py-3 text-ink" dir="auto">
                {lang === "ar" ? pt.name_ar : pt.name_en}
              </td>
              <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                {pt.days}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge tone={pt.is_active ? "success" : "danger"}>
                  {pt.is_active ? t("common.active") : t("common.inactive")}
                </Badge>
              </td>
              {canManage && (
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setFormTerm(pt)}>
                      {t("common.edit")}
                    </Button>
                    {pt.is_active && (
                      <Button variant="ghost" size="sm" onClick={() => setDeactivateTarget(pt)}>
                        <span className="text-danger">{t("common.deactivate")}</span>
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      {formTerm !== undefined && (
        <PaymentTermDialog
          term={formTerm}
          companyId={companyId}
          onClose={() => setFormTerm(undefined)}
          onSaved={() => {
            setFormTerm(undefined);
            void qc.invalidateQueries({ queryKey: ["payment-terms"] });
          }}
        />
      )}
      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("paymentTerms.deactivateTitle")}
        text={t("paymentTerms.deactivateText", {
          name: deactivateTarget ? (lang === "ar" ? deactivateTarget.name_ar : deactivateTarget.name_en) : "",
        })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={busy}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateTarget(null)}
      />
    </Card>
  );
}

/* ---------- document sequences ---------- */

function SequenceDialog({
  sequence,
  companyId,
  onClose,
  onSaved,
}: {
  sequence: DocumentSequence | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = sequence !== null;

  const [documentType, setDocumentType] = useState(sequence?.document_type ?? "");
  const [prefix, setPrefix] = useState(sequence?.prefix ?? "");
  const [nextNumber, setNextNumber] = useState(sequence ? String(sequence.next_number) : "1");
  const [padding, setPadding] = useState(
    sequence?.padding != null ? String(sequence.padding) : "",
  );
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        prefix: prefix || undefined,
        next_number: Math.trunc(Number(nextNumber)),
        padding: padding.trim() === "" ? undefined : Math.trunc(Number(padding)),
      };
      return isEdit && sequence
        ? api.updateDocumentSequence(sequence.id, input)
        : api.createDocumentSequence({
            company_id: companyId,
            document_type: documentType.trim(),
            ...input,
          });
    },
    onSuccess: () => {
      toast.success(t("sequences.saved"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!documentType.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (!Number.isFinite(Number(nextNumber)) || Number(nextNumber) < 1) {
      setFormError(t("sequences.nextNumber"));
      return;
    }
    if (padding.trim() !== "" && (!Number.isFinite(Number(padding)) || Number(padding) < 0)) {
      setFormError(t("sequences.padding"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "sequences.edit" : "sequences.new")}>
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("sequences.documentType")} required>
          <TextInput
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            dir="ltr"
            disabled={isEdit}
          />
        </Field>
        <Field label={t("sequences.prefix")}>
          <TextInput value={prefix} onChange={(e) => setPrefix(e.target.value)} dir="ltr" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("sequences.nextNumber")} required>
            <TextInput
              value={nextNumber}
              onChange={(e) => setNextNumber(e.target.value)}
              dir="ltr"
              inputMode="numeric"
            />
          </Field>
          <Field label={t("sequences.padding")}>
            <TextInput
              value={padding}
              onChange={(e) => setPadding(e.target.value)}
              dir="ltr"
              inputMode="numeric"
            />
          </Field>
        </div>
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

function SequencesCard({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const [formSeq, setFormSeq] = useState<DocumentSequence | null | undefined>(undefined);
  const [previewType, setPreviewType] = useState("");
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const list = useQuery({
    queryKey: ["document-sequences", companyId],
    queryFn: () => api.listDocumentSequences(companyId),
    retry: false,
  });

  const doPreview = async () => {
    if (!previewType.trim()) return;
    setPreviewBusy(true);
    setPreviewResult(null);
    try {
      const res = await api.previewDocumentSequence(companyId, previewType.trim());
      setPreviewResult(res.next);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="mb-2 text-base font-bold text-ink">{t("sequences.previewCard")}</h2>
        <p className="mb-4 text-[13px] text-ink-soft">{t("sequences.previewHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <Field label={t("sequences.documentType")}>
              <TextInput
                value={previewType}
                onChange={(e) => {
                  setPreviewType(e.target.value);
                  setPreviewResult(null);
                }}
                dir="ltr"
                placeholder="sales_invoice"
              />
            </Field>
          </div>
          <Button
            variant="secondary"
            loading={previewBusy}
            disabled={!previewType.trim()}
            onClick={() => void doPreview()}
          >
            {t("sequences.previewButton")}
          </Button>
        </div>
        {previewResult !== null && (
          <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-deep" dir="ltr">
            {t("sequences.nextValue")} {previewResult}
          </p>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{t("sequences.title")}</h2>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canManage}
            title={canManage ? undefined : t("common.noPermission")}
            onClick={() => setFormSeq(null)}
          >
            {t("sequences.new")}
          </Button>
        </div>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState title={t("sequences.noSequences")} />
        ) : (
          <Table
            head={[
              t("sequences.documentType"),
              t("sequences.prefix"),
              t("sequences.nextNumber"),
              t("sequences.padding"),
              t("common.status"),
              ...(canManage ? [t("common.actions")] : []),
            ]}
          >
            {(list.data ?? []).map((s) => (
              <tr key={s.id} className="hover:bg-surface-soft/50">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                  {s.document_type}
                </td>
                <td className="px-4 py-3 text-ink-soft" dir="ltr">
                  {s.prefix || "—"}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                  {s.next_number}
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                  {s.padding ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge tone={s.is_active ? "success" : "danger"}>
                    {s.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setFormSeq(s)}>
                      {t("common.edit")}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}

        {formSeq !== undefined && (
          <SequenceDialog
            sequence={formSeq}
            companyId={companyId}
            onClose={() => setFormSeq(undefined)}
            onSaved={() => {
              setFormSeq(undefined);
              void qc.invalidateQueries({ queryKey: ["document-sequences"] });
            }}
          />
        )}
      </Card>
    </div>
  );
}

/* ---------- page ---------- */

export function MasterDataPage() {
  const { t } = useTranslation();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.masterDataView);
  const canManage = hasPermission(PERMS.masterDataManage);

  const [tab, setTab] = useState<"terms" | "sequences">("terms");

  if (!canView) {
    return (
      <>
        <PageHeader title={t("masterData.title")} subtitle={t("masterData.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("masterData.title")} subtitle={t("masterData.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("masterData.title")}
        subtitle={t("masterData.subtitle")}
        actions={
          <>
            <Link to="/master-data/categories">
              <Button variant="secondary" size="sm">
                {t("categories.title")}
              </Button>
            </Link>
            <Link to="/master-data/units">
              <Button variant="secondary" size="sm">
                {t("units.title")}
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex gap-2">
        {(
          [
            ["terms", "masterData.tabPaymentTerms"],
            ["sequences", "masterData.tabSequences"],
          ] as const
        ).map(([key, labelKey]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "bg-accent-soft text-accent-deep"
                : "text-ink-soft hover:bg-surface-soft hover:text-ink"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === "terms" ? (
        <PaymentTermsCard companyId={companyId} canManage={canManage} />
      ) : (
        <SequencesCard companyId={companyId} canManage={canManage} />
      )}
    </>
  );
}
