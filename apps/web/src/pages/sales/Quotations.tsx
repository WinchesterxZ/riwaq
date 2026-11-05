import type { Customer, Quotation } from "@atlas-erp/api-client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Pagination,
  Select,
  Table,
  TextInput,
} from "../../components/ui";
import { PdfButton } from "../../components/PdfButton";
import {
  Amount,
  PERMS,
  QUOTATION_STATUS_LABEL_KEYS,
  Qty,
  formatDate,
  quotationStatusTone,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { WarehouseSelect } from "../inventory/shared";
import {
  blankPricedLine,
  CustomerSearch,
  draftLineToInput,
  isDraftLineValid,
  PricedLineEditor,
  randomKey,
  salesCustomerName,
  salesProductLabel,
  SalesGuard,
  type DraftPricedLine,
} from "./shared";

const PER_PAGE = 15;

function QuotationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [validUntil, setValidUntil] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    if (!customer) {
      toast.error(t("sales.customerRequired"));
      return;
    }
    if (!validUntil) {
      toast.error(t("sales.validUntilRequired"));
      return;
    }
    const valid = lines.filter(isDraftLineValid);
    if (valid.length === 0) {
      toast.error(t("sales.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      await api.createQuotation(
        {
          company_id: companyId,
          customer_id: customer.id,
          valid_until: validUntil,
          notes: notes.trim() || undefined,
          lines: valid.map(draftLineToInput),
        },
        randomKey(),
      );
      toast.success(t("sales.quotationCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.newQuotation")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("sales.customer")}>
          <CustomerSearch value={customer} onSelect={setCustomer} />
        </Field>
        <Field label={t("sales.validUntil")}>
          <TextInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <PricedLineEditor lines={lines} setLines={setLines} autoDescription />
      </div>
      <div className="mt-4">
        <Field label={t("sales.notes")}>
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" maxLength={2000} />
      </Field>
        </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

function QuotationEditDialog({
  quotation,
  onClose,
  onDone,
}: {
  quotation: Quotation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [validUntil, setValidUntil] = useState(quotation.valid_until);
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [lines, setLines] = useState<DraftPricedLine[]>(
    quotation.lines.map((l, i) => ({
      key: i + 1,
      product: null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_rate: l.discount_rate,
      tax_rate: l.tax_rate,
    })),
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const valid = lines.filter(isDraftLineValid);
    if (valid.length === 0) {
      toast.error(t("sales.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      await api.updateQuotation(quotation.id, {
        valid_until: validUntil,
        notes: notes.trim() || null,
        lines: valid.map(draftLineToInput),
      });
      toast.success(t("sales.quotationUpdated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.editQuotation")} onClose={onClose} wide>
      <Field label={t("sales.validUntil")}>
        <TextInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      </Field>
      <div className="mt-4">
        <PricedLineEditor lines={lines} setLines={setLines} autoDescription />
      </div>
      <div className="mt-4">
        <Field label={t("sales.notes")}>
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" maxLength={2000} />
      </Field>
        </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

function AcceptDialog({
  quotationId,
  onClose,
  onDone,
}: {
  quotationId: string;
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.acceptQuotation(quotationId, warehouseId);
      toast.success(t("sales.quotationAccepted"));
      onDone(res.sales_order.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.accept")} onClose={onClose}>
      <Field label={t("sales.warehouse")}>
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? t("common.loading") : t("sales.accept")}
        </Button>
      </div>
    </Dialog>
  );
}

export function QuotationsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [expireBusy, setExpireBusy] = useState(false);
  const canCreate = hasPermission(PERMS.quotationCreate);
  const canManage = hasPermission(PERMS.quotationManage);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-quotations", companyId, status, page],
    queryFn: () =>
      api.listQuotations({
        company_id: companyId!,
        status: (status || undefined) as Quotation["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  const expireDue = async () => {
    setExpireBusy(true);
    try {
      const res = await api.expireDueQuotations();
      toast.success(`${t("sales.expiredDone")} (${res.expired})`);
      await qc.invalidateQueries({ queryKey: ["sales-quotations"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setExpireBusy(false);
    }
  };

  return (
    <SalesGuard
      perm={PERMS.quotationView}
      title={t("sales.quotationsTitle")}
      subtitle={t("sales.quotationsSubtitle")}
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canManage || expireBusy}
            title={canManage ? undefined : t("common.noPermission")}
            onClick={() => void expireDue()}
          >
            {t("sales.expireDue")}
          </Button>
          <Button
            size="sm"
            disabled={!canCreate}
            title={canCreate ? undefined : t("common.noPermission")}
            onClick={() => setOpen(true)}
          >
            {t("sales.newQuotation")}
          </Button>
        </div>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "sent", "accepted", "rejected", "expired"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(QUOTATION_STATUS_LABEL_KEYS[s])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
        ) : (list.data?.data ?? []).length === 0 ? (
          <EmptyState title={t("sales.noQuotations")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.customer"),
                t("sales.validUntil"),
                t("sales.grandTotal"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((q) => (
                <tr key={q.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {q.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {salesCustomerName(q.customer, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(q.valid_until, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={q.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={quotationStatusTone(q.status)}>{t(QUOTATION_STATUS_LABEL_KEYS[q.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/quotations/${q.id}`}>
                      <Button variant="secondary" size="sm">
                        {t("sales.details")}
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
            {list.data?.meta && (
              <Pagination
                page={list.data.meta.page}
                totalPages={list.data.meta.total_pages}
                total={list.data.meta.total}
                onPage={setPage}
              />
            )}
          </>
        )}
      </Card>

      {open && (
        <QuotationDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-quotations"] });
          }}
        />
      )}
    </SalesGuard>
  );
}

function useQuotationActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const transition = async (id: string, action: "send" | "withdraw" | "reject") => {
    setBusy(true);
    try {
      if (action === "send") {
        await api.sendQuotation(id);
        toast.success(t("sales.quotationSent"));
      } else if (action === "withdraw") {
        await api.withdrawQuotation(id);
        toast.success(t("sales.quotationWithdrawn"));
      } else {
        await api.rejectQuotation(id);
        toast.success(t("sales.quotationRejected"));
      }
      await qc.invalidateQueries({ queryKey: ["sales-quotation", id] });
      await qc.invalidateQueries({ queryKey: ["sales-quotations"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { transition, busy };
}

export function QuotationDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { transition, busy } = useQuotationActions();
  const [editOpen, setEditOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["sales-quotation", id],
    queryFn: () => api.getQuotation(id!),
    enabled: !!id,
    retry: false,
  });

  const q = detail.data;
  const canSubmit = hasPermission(PERMS.quotationSubmit);
  const canEdit = hasPermission(PERMS.quotationEdit);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/quotations")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !q ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {q.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {salesCustomerName(q.customer, i18n.language)} · {t("sales.validUntil")}:{" "}
                  {formatDate(q.valid_until, i18n.language)}
                </p>
              </div>
              <Badge tone={quotationStatusTone(q.status)}>{t(QUOTATION_STATUS_LABEL_KEYS[q.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("sales.subtotal")}: <Amount value={q.subtotal} />
              </span>
              <span>
                {t("sales.taxTotal")}: <Amount value={q.tax_total} />
              </span>
              <span className="font-semibold">
                {t("sales.grandTotal")}: <Amount value={q.total} />
              </span>
            </div>
            {q.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {q.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <PdfButton fetch={() => api.quotationPdf(q.id)} filename={`quotation-${q.number}.pdf`} />
              {q.status === "draft" && (
                <>
                  <Button size="sm" disabled={!canEdit} title={canEdit ? undefined : t("common.noPermission")} onClick={() => setEditOpen(true)}>
                    {t("common.edit")}
                  </Button>
                  <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void transition(q.id, "send")}>
                    {t("sales.send")}
                  </Button>
                </>
              )}
              {q.status === "sent" && (
                <Button size="sm" variant="secondary" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void transition(q.id, "withdraw")}>
                  {t("sales.withdraw")}
                </Button>
              )}
              {(q.status === "draft" || q.status === "sent") && (
                <>
                  <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => setAcceptOpen(true)}>
                    {t("sales.accept")}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void transition(q.id, "reject")}>
                    <span className="text-danger">{t("sales.reject")}</span>
                  </Button>
                </>
              )}
            </div>
          </Card>
          <Card>
            <Table
              head={[
                t("sales.description"),
                t("inventory.product"),
                t("sales.quantity"),
                t("sales.unitPrice"),
                t("sales.discountRate"),
                t("sales.taxRate"),
                t("sales.lineTotal"),
              ]}
            >
              {q.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.description}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {l.product ? salesProductLabel(l.product, i18n.language) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={l.quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.unit_price} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <span dir="ltr" className="tnum">
                      {l.discount_rate}%
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    <span dir="ltr" className="tnum">
                      {l.tax_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.line_total} />
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {editOpen && q && (
        <QuotationEditDialog
          quotation={q}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false);
            void detail.refetch();
          }}
        />
      )}
      {acceptOpen && q && (
        <AcceptDialog
          quotationId={q.id}
          onClose={() => setAcceptOpen(false)}
          onDone={(orderId) => {
            setAcceptOpen(false);
            navigate(`/sales/orders/${orderId}`);
          }}
        />
      )}
    </>
  );
}
