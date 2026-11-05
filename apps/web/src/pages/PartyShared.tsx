/**
 * Shared building blocks for the Customers and Suppliers pages (Phase 4).
 * Both resources share the contract shape; the thin Customers.tsx / Suppliers.tsx
 * wrappers only pick the resource name.
 */
import type {
  Attachment,
  CreateCustomerInput,
  CreatePartyAddressInput,
  CreatePartyContactInput,
  CreateResult,
  CreateSupplierInput,
  Customer,
  ImportResult,
  ListPartiesParams,
  Page,
  PartyAddress,
  PartyContact,
  PartyKind,
  Supplier,
} from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
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
  Pagination,
  Select,
  Table,
  TextInput,
} from "../components/ui";
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

export type PartyResource = "customers" | "suppliers";
type Party = Customer | Supplier;

const PER_PAGE = 15;
const PARTY_KINDS: PartyKind[] = ["individual", "company"];

function partyName(p: Party, lang: string): string {
  return lang === "ar" ? p.name_ar : p.name_en;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- attachments section (shared) ---------- */

export function AttachmentsSection({
  ownerType,
  ownerId,
  canManage,
}: {
  ownerType: string;
  ownerId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["attachments", ownerType, ownerId],
    queryFn: () => api.listAttachments(ownerType, ownerId),
    retry: false,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["attachments", ownerType, ownerId] });

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadAttachment(file, ownerType, ownerId);
      toast.success(t("attachments.uploaded"));
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openInNewTab = async (a: Attachment) => {
    try {
      const blob = await api.downloadAttachment(a.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const download = async (a: Attachment) => {
    try {
      const blob = await api.downloadAttachment(a.id);
      downloadBlob(blob, a.file_name);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteAttachment(deleteTarget.id);
      toast.success(t("attachments.deleted"));
      setDeleteTarget(null);
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const rows = list.data ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-ink">{t("attachments.title")}</h2>
        {canManage && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => void onFilePicked(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {t("attachments.upload")}
            </Button>
          </>
        )}
      </div>
      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("attachments.noAttachments")} />
      ) : (
        <Table head={[t("common.name"), t("common.size"), t("common.actions")]}>
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-surface-soft/50">
              <td className="px-4 py-3 text-ink" dir="auto">
                {a.file_name}
              </td>
              <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                {a.size != null ? `${Math.round(a.size / 1024)} KB` : "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => void openInNewTab(a)}>
                    {t("attachments.open")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void download(a)}>
                    {t("attachments.download")}
                  </Button>
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)}>
                      <span className="text-danger">{t("common.delete")}</span>
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("attachments.deleteTitle")}
        text={t("attachments.deleteText", { name: deleteTarget?.file_name ?? "" })}
        confirmLabel={t("common.delete")}
        danger
        loading={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </Card>
  );
}

/* ---------- create / edit dialog ---------- */

function PartyFormDialog({
  resource,
  party,
  companyId,
  onClose,
  onSaved,
}: {
  resource: PartyResource;
  party: Party | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = party !== null;
  const isCustomer = resource === "customers";

  const [number, setNumber] = useState(party?.number ?? "");
  const [kind, setKind] = useState<PartyKind>(party?.kind ?? "company");
  const [nameAr, setNameAr] = useState(party?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(party?.name_en ?? "");
  const [taxId, setTaxId] = useState(party?.tax_id ?? "");
  const [creditLimit, setCreditLimit] = useState(
    party?.credit_limit != null ? String(party.credit_limit) : "",
  );
  const [defaultCurrency, setDefaultCurrency] = useState(
    !isCustomer && party && "default_currency" in party ? (party.default_currency ?? "") : "",
  );
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const base = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        kind,
        number: number.trim() || undefined,
        tax_id: taxId.trim() || null,
        credit_limit: creditLimit.trim() || null,
      };
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
      if (isEdit && party) {
        const input = isCustomer
          ? { ...base }
          : { ...base, default_currency: defaultCurrency.trim() || null };
        return resource === "customers"
          ? api.updateCustomer(party.id, input)
          : api.updateSupplier(party.id, input);
      }
      const input: CreateCustomerInput | CreateSupplierInput = {
        company_id: companyId,
        ...base,
        ...(isCustomer ? {} : { default_currency: defaultCurrency.trim() || undefined }),
      };
      const res: Promise<CreateResult<Party>> =
        resource === "customers"
          ? api.createCustomer(input, idempotencyKey)
          : api.createSupplier(input as CreateSupplierInput, idempotencyKey);
      return res.then((r) => {
        if (r.warnings.length > 0) toast.info(r.warnings.join(" — "));
        return r.data;
      });
    },
    onSuccess: () => {
      toast.success(t(isEdit ? "parties.saved" : "parties.created"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!nameAr.trim() || !nameEn.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (creditLimit.trim() !== "" && Number.isNaN(Number(creditLimit.trim()))) {
      setFormError(t("parties.creditLimit"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  const titleKey = isCustomer
    ? isEdit
      ? "parties.editCustomer"
      : "parties.newCustomer"
    : isEdit
      ? "parties.editSupplier"
      : "parties.newSupplier";

  return (
    <Dialog open onClose={onClose} title={t(titleKey)} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("parties.number")}>
          <TextInput value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("parties.kind")} required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as PartyKind)}>
            {PARTY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(k === "individual" ? "parties.kindIndividual" : "parties.kindCompany")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("parties.nameAr")} required>
          <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t("parties.nameEn")} required>
          <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("parties.taxId")}>
          <TextInput value={taxId} onChange={(e) => setTaxId(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("parties.creditLimit")}>
          <TextInput
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            dir="ltr"
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        {!isCustomer && (
          <Field label={t("parties.defaultCurrency")}>
            <TextInput
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              dir="ltr"
              placeholder="EGP"
            />
          </Field>
        )}
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

/* ---------- CSV import dialog ---------- */

/** Generic CSV import dialog reused by customers, suppliers and products. */
export function CsvImportDialog({
  title,
  hint,
  filename,
  onImport,
  onTemplate,
  onDone,
  onClose,
}: {
  title: string;
  hint: string;
  filename: string;
  onImport: (file: File) => Promise<ImportResult>;
  onTemplate: () => Promise<Blob>;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await onImport(file);
      setResult(res);
      toast.success(t("parties.importDone"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      downloadBlob(await onTemplate(), filename);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  return (
    <Dialog open onClose={onClose} title={title}>
      <p className="text-sm text-ink-soft">{hint}</p>
      <div className="mt-4 flex items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? "");
            setResult(null);
          }}
          className="text-sm text-ink-soft file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-surface-soft"
        />
      </div>
      {fileName && (
        <p className="mt-2 text-xs text-ink-faint" dir="ltr">
          {fileName}
        </p>
      )}
      {result && (
        <div className="mt-4 rounded-xl border border-line bg-surface-soft/60 p-4">
          <p className="text-sm font-bold text-ink">
            {t("parties.importedCount", { count: result.imported })}
          </p>
          {result.errors.length === 0 ? (
            <p className="mt-1 text-[13px] text-success">{t("parties.noImportErrors")}</p>
          ) : (
            <>
              <p className="mt-2 text-[13px] font-semibold text-danger">
                {t("parties.importErrorsTitle")} ({result.errors.length})
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[13px] text-ink-soft">
                {result.errors.map((e) => (
                  <li key={e.row} dir="auto">
                    <span className="font-semibold text-ink">
                      {t("parties.row")} {e.row}:
                    </span>{" "}
                    {e.errors.join("؛ ")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="mt-6 flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => void downloadTemplate()}>
          {t("parties.downloadTemplate")}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button loading={busy} disabled={!fileName} onClick={() => void doImport()}>
            {t("parties.importButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ImportDialog({
  resource,
  companyId,
  onClose,
  onDone,
}: {
  resource: PartyResource;
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CsvImportDialog
      title={t("parties.importTitle")}
      hint={t("parties.importHint")}
      filename={`${resource}-template.csv`}
      onImport={(f) =>
        resource === "customers" ? api.importCustomers(f) : api.importSuppliers(f)
      }
      onTemplate={() =>
        resource === "customers"
          ? api.exportCustomers(companyId)
          : api.exportSuppliers(companyId)
      }
      onDone={onDone}
      onClose={onClose}
    />
  );
}

/* ---------- list page ---------- */

export function PartyListPage({ resource }: { resource: PartyResource }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();
  const isCustomer = resource === "customers";

  const canView = hasPermission(isCustomer ? PERMS.customersView : PERMS.suppliersView);
  const canCreate = hasPermission(isCustomer ? PERMS.customersCreate : PERMS.suppliersCreate);
  const canManage = hasPermission(isCustomer ? PERMS.customersManage : PERMS.suppliersManage);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [formParty, setFormParty] = useState<Party | null | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<Party | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [search, status, companyId]);

  const queryKey = [resource, companyId, search, status, page];
  const list = useQuery({
    queryKey,
    queryFn: () =>
      isCustomer
        ? api.listCustomers({
            company_id: companyId!,
            search: search || undefined,
            status: status || undefined,
            page,
            per_page: PER_PAGE,
          })
        : api.listSuppliers({
            company_id: companyId!,
            search: search || undefined,
            status: status || undefined,
            page,
            per_page: PER_PAGE,
          }),
    enabled: !!companyId && canView,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: [resource] });

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    try {
      if (isCustomer) await api.deactivateCustomer(deactivateTarget.id);
      else await api.deactivateSupplier(deactivateTarget.id);
      toast.success(t("parties.deactivated"));
      setDeactivateTarget(null);
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!companyId) return;
    try {
      const blob = isCustomer
        ? await api.exportCustomers(companyId)
        : await api.exportSuppliers(companyId);
      downloadBlob(blob, `${resource}-export.csv`);
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  const titleKey = isCustomer ? "nav.customers" : "nav.suppliers";

  if (!canView) {
    return (
      <>
        <PageHeader title={t(titleKey)} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t(titleKey)} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const rows = (list.data?.data ?? []) as Party[];
  const meta = list.data?.meta as Page<Party>["meta"] | undefined;
  const lang = i18n.language;

  return (
    <>
      <PageHeader
        title={t(titleKey)}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void doExport()}>
              {t("parties.export")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canCreate}
              title={canCreate ? undefined : t("common.noPermission")}
              onClick={() => setImportOpen(true)}
            >
              {t("parties.import")}
            </Button>
            <Button
              size="sm"
              disabled={!canCreate}
              title={canCreate ? undefined : t("common.noPermission")}
              onClick={() => setFormParty(null)}
            >
              {t(isCustomer ? "parties.newCustomer" : "parties.newSupplier")}
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("common.search")}>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("parties.searchPlaceholder")}
            />
          </Field>
          <Field label={t("parties.statusFilter")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("parties.allStatuses")}</option>
              <option value="active">{t("common.active")}</option>
              <option value="inactive">{t("common.inactive")}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("parties.noRecords")} />
        ) : (
          <>
            <Table
              head={[
                t("parties.number"),
                t("common.name"),
                t("parties.kind"),
                t("parties.taxId"),
                t("parties.creditLimit"),
                t("common.status"),
                t("common.actions"),
              ]}
            >
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-soft/50">
                  <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                    {p.number || "—"}
                  </td>
                  <td className="max-w-56 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                    {partyName(p, lang)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {t(p.kind === "individual" ? "parties.kindIndividual" : "parties.kindCompany")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                    {p.tax_id || "—"}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                    {p.credit_limit != null && p.credit_limit !== "" ? String(p.credit_limit) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={p.status === "active" ? "success" : "danger"}>
                      {p.status === "active" ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2">
                      <Link to={`/${resource}/${p.id}`}>
                        <Button variant="secondary" size="sm">
                          {t("parties.details")}
                        </Button>
                      </Link>
                      {canManage && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setFormParty(p)}>
                            {t("common.edit")}
                          </Button>
                          {p.status === "active" && (
                            <Button variant="ghost" size="sm" onClick={() => setDeactivateTarget(p)}>
                              <span className="text-danger">{t("common.deactivate")}</span>
                            </Button>
                          )}
                        </>
                      )}
                    </div>
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

      {formParty !== undefined && (
        <PartyFormDialog
          resource={resource}
          party={formParty}
          companyId={companyId}
          onClose={() => setFormParty(undefined)}
          onSaved={() => {
            setFormParty(undefined);
            void invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("parties.deactivateTitle")}
        text={t("parties.deactivateText", {
          name: deactivateTarget ? partyName(deactivateTarget, lang) : "",
        })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={busy}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateTarget(null)}
      />

      {importOpen && (
        <ImportDialog
          resource={resource}
          companyId={companyId}
          onClose={() => setImportOpen(false)}
          onDone={() => void invalidate()}
        />
      )}
    </>
  );
}

/* ---------- contact / address dialogs ---------- */

function ContactDialog({
  onClose,
  onSubmit,
  saving,
}: {
  onClose: () => void;
  onSubmit: (input: CreatePartyContactInput) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");

  const save = () => {
    if (!name.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    onSubmit({
      name: name.trim(),
      role: position.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
  };

  return (
    <Dialog open onClose={onClose} title={t("parties.addContact")}>
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("parties.contactName")} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("parties.position")}>
          <TextInput value={position} onChange={(e) => setPosition(e.target.value)} />
        </Field>
        <Field label={t("parties.phone")}>
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("common.email")}>
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </Field>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={saving} onClick={save}>
          {t("common.add")}
        </Button>
      </div>
    </Dialog>
  );
}

function AddressDialog({
  onClose,
  onSubmit,
  saving,
}: {
  onClose: () => void;
  onSubmit: (input: CreatePartyAddressInput) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [formError, setFormError] = useState("");

  const save = () => {
    if (!addressLine.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    onSubmit({
      label: label.trim() || undefined,
      line1: addressLine.trim(),
      city: city.trim() || undefined,
      country: country.trim() || undefined,
    });
  };

  return (
    <Dialog open onClose={onClose} title={t("parties.addAddress")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("parties.addressLabel")}>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t("parties.city")}>
          <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label={t("parties.addressLine")} required>
            <TextInput value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
          </Field>
        </div>
        <Field label={t("parties.country")}>
          <TextInput value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={saving} onClick={save}>
          {t("common.add")}
        </Button>
      </div>
    </Dialog>
  );
}

/* ---------- detail page ---------- */

export function PartyDetailPage({ resource }: { resource: PartyResource }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const { id } = useParams<{ id: string }>();
  const isCustomer = resource === "customers";

  const canManage = hasPermission(isCustomer ? PERMS.customersManage : PERMS.suppliersManage);
  const canView = hasPermission(isCustomer ? PERMS.customersView : PERMS.suppliersView);

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<
    { kind: "contact" | "address"; id: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const party = useQuery({
    queryKey: [resource, id],
    queryFn: () => (isCustomer ? api.getCustomer(id!) : api.getSupplier(id!)),
    enabled: !!id && canView,
    retry: false,
  });

  const contacts = useQuery({
    queryKey: [resource, id, "contacts"],
    queryFn: () =>
      isCustomer ? api.listCustomerContacts(id!) : api.listSupplierContacts(id!),
    enabled: !!id && canView && party.isSuccess,
    retry: false,
  });

  const addresses = useQuery({
    queryKey: [resource, id, "addresses"],
    queryFn: () =>
      isCustomer ? api.listCustomerAddresses(id!) : api.listSupplierAddresses(id!),
    enabled: !!id && canView && party.isSuccess,
    retry: false,
  });

  const invalidateAll = () =>
    qc.invalidateQueries({ queryKey: [resource, id] });

  const addContact = async (input: CreatePartyContactInput) => {
    setBusy(true);
    try {
      if (isCustomer) await api.createCustomerContact(id!, input);
      else await api.createSupplierContact(id!, input);
      toast.success(t("parties.contactAdded"));
      setContactOpen(false);
      await qc.invalidateQueries({ queryKey: [resource, id, "contacts"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const addAddress = async (input: CreatePartyAddressInput) => {
    setBusy(true);
    try {
      if (isCustomer) await api.createCustomerAddress(id!, input);
      else await api.createSupplierAddress(id!, input);
      toast.success(t("parties.addressAdded"));
      setAddressOpen(false);
      await qc.invalidateQueries({ queryKey: [resource, id, "addresses"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      if (removeTarget.kind === "contact") {
        if (isCustomer) await api.deleteCustomerContact(id!, removeTarget.id);
        else await api.deleteSupplierContact(id!, removeTarget.id);
        await qc.invalidateQueries({ queryKey: [resource, id, "contacts"] });
      } else {
        if (isCustomer) await api.deleteCustomerAddress(id!, removeTarget.id);
        else await api.deleteSupplierAddress(id!, removeTarget.id);
        await qc.invalidateQueries({ queryKey: [resource, id, "addresses"] });
      }
      toast.success(t("parties.removed"));
      setRemoveTarget(null);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doDeactivate = async () => {
    setBusy(true);
    try {
      if (isCustomer) await api.deactivateCustomer(id!);
      else await api.deactivateSupplier(id!);
      toast.success(t("parties.deactivated"));
      setDeactivateOpen(false);
      await invalidateAll();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const titleKey = isCustomer ? "parties.customerDetails" : "parties.supplierDetails";
  const lang = i18n.language;
  const p = (party.data ?? null) as Party | null;

  if (!canView) {
    return (
      <>
        <PageHeader title={t(titleKey)} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={p ? partyName(p, lang) : t(titleKey)}
        subtitle={p ? `${t("parties.number")}: ${p.number || "—"}` : undefined}
        actions={
          <>
            <Link to={`/${resource}`}>
              <Button variant="secondary" size="sm">
                {t("parties.backToList")}
              </Button>
            </Link>
            {canManage && p?.status === "active" && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeactivateOpen(true)}
              >
                {t("common.deactivate")}
              </Button>
            )}
          </>
        }
      />

      {party.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : party.isError || !p ? (
        <Card>
          <ErrorState
            message={errorMessage(party.error, t)}
            onRetry={() => party.refetch()}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  [t("parties.number"), p.number || "—", true],
                  [
                    t("parties.kind"),
                    t(
                      p.kind === "individual"
                        ? "parties.kindIndividual"
                        : "parties.kindCompany",
                    ),
                    false,
                  ],
                  [t("parties.taxId"), p.tax_id || "—", true],
                  [
                    t("parties.creditLimit"),
                    p.credit_limit != null && p.credit_limit !== ""
                      ? String(p.credit_limit)
                      : "—",
                    true,
                  ],
                  ...(isCustomer
                    ? []
                    : [
                        [
                          t("parties.defaultCurrency"),
                          ("default_currency" in p && p.default_currency) || "—",
                          true,
                        ] as [string, string, boolean],
                      ]),
                ] as [string, string, boolean][]
              ).map(([label, value, ltr]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-ink" dir={ltr ? "ltr" : undefined}>
                    {value}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {t("common.status")}
                </dt>
                <dd className="mt-1">
                  <Badge tone={p.status === "active" ? "success" : "danger"}>
                    {p.status === "active" ? t("common.active") : t("common.inactive")}
                  </Badge>
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">{t("parties.contacts")}</h2>
              {canManage && (
                <Button variant="secondary" size="sm" onClick={() => setContactOpen(true)}>
                  {t("parties.addContact")}
                </Button>
              )}
            </div>
            {contacts.isLoading ? (
              <LoadingBlock />
            ) : contacts.isError ? (
              <ErrorState message={errorMessage(contacts.error, t)} onRetry={() => contacts.refetch()} />
            ) : (contacts.data ?? []).length === 0 ? (
              <EmptyState title={t("parties.noContacts")} />
            ) : (
              <Table
                head={[
                  t("parties.contactName"),
                  t("parties.position"),
                  t("parties.phone"),
                  t("common.email"),
                  ...(canManage ? [t("common.actions")] : []),
                ]}
              >
                {(contacts.data ?? []).map((c: PartyContact) => (
                  <tr key={c.id} className="hover:bg-surface-soft/50">
                    <td className="px-4 py-3 font-medium text-ink" dir="auto">
                      {c.name}
                    </td>
                    <td className="px-4 py-3 text-ink-soft" dir="auto">
                      {c.role || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                      {c.phone || "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft" dir="ltr">
                      {c.email || "—"}
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTarget({ kind: "contact", id: c.id })}
                        >
                          <span className="text-danger">{t("common.remove")}</span>
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
              <h2 className="text-base font-bold text-ink">{t("parties.addresses")}</h2>
              {canManage && (
                <Button variant="secondary" size="sm" onClick={() => setAddressOpen(true)}>
                  {t("parties.addAddress")}
                </Button>
              )}
            </div>
            {addresses.isLoading ? (
              <LoadingBlock />
            ) : addresses.isError ? (
              <ErrorState message={errorMessage(addresses.error, t)} onRetry={() => addresses.refetch()} />
            ) : (addresses.data ?? []).length === 0 ? (
              <EmptyState title={t("parties.noAddresses")} />
            ) : (
              <Table
                head={[
                  t("parties.addressLabel"),
                  t("parties.addressLine"),
                  t("parties.city"),
                  t("parties.country"),
                  ...(canManage ? [t("common.actions")] : []),
                ]}
              >
                {(addresses.data ?? []).map((a: PartyAddress) => (
                  <tr key={a.id} className="hover:bg-surface-soft/50">
                    <td className="px-4 py-3 text-ink" dir="auto">
                      {a.label || "—"}
                    </td>
                    <td className="max-w-64 cell-readable px-4 py-3 text-ink-soft" dir="auto">
                      {a.line1}
                    </td>
                    <td className="px-4 py-3 text-ink-soft" dir="auto">
                      {a.city || "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft" dir="auto">
                      {a.country || "—"}
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTarget({ kind: "address", id: a.id })}
                        >
                          <span className="text-danger">{t("common.remove")}</span>
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <AttachmentsSection ownerType={resource === "customers" ? "customer" : "supplier"} ownerId={p.id} canManage={canManage} />
        </div>
      )}

      {contactOpen && (
        <ContactDialog onClose={() => setContactOpen(false)} onSubmit={(i) => void addContact(i)} saving={busy} />
      )}
      {addressOpen && (
        <AddressDialog onClose={() => setAddressOpen(false)} onSubmit={(i) => void addAddress(i)} saving={busy} />
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title={t("parties.removeTitle")}
        text={t("parties.removeText")}
        confirmLabel={t("common.remove")}
        danger
        loading={busy}
        onConfirm={() => void doRemove()}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={deactivateOpen}
        title={t("parties.deactivateTitle")}
        text={t("parties.deactivateText", { name: p ? partyName(p, lang) : "" })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={busy}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateOpen(false)}
      />
    </>
  );
}
