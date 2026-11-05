import type { CreditNote, Customer, SalesInvoiceRow } from "@atlas-erp/api-client";
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
import {
  Amount,
  CREDIT_NOTE_STATUS_LABEL_KEYS,
  PERMS,
  Qty,
  creditNoteStatusTone,
  formatDate,
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

function CreditNoteDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (creditNoteId: string) => void;
}) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [creditDate, setCreditDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [isReturn, setIsReturn] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const invoices = useQuery({
    queryKey: ["sales-cn-invoices", companyId, customer?.id],
    queryFn: () => api.listSalesInvoices({ company_id: companyId!, customer_id: customer!.id, per_page: 100 }),
    enabled: !!companyId && !!customer,
    retry: false,
  });

  const submit = async () => {
    if (!companyId) return;
    if (!customer) {
      toast.error(t("sales.customerRequired"));
      return;
    }
    if (!reason.trim()) {
      toast.error(t("sales.reasonRequired"));
      return;
    }
    const valid = lines.filter(isDraftLineValid);
    if (valid.length === 0) {
      toast.error(t("sales.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.createCreditNote(
        {
          company_id: companyId,
          customer_id: customer.id,
          sales_invoice_id: invoiceId || undefined,
          credit_date: creditDate,
          reason: reason.trim(),
          is_return: isReturn,
          notes: notes.trim() || undefined,
          lines: valid.map((l) => ({
            ...draftLineToInput(l),
            description:
              draftLineToInput(l).description ||
              (l.product ? l.product.name_ar || l.product.name_en : "—"),
          })),
        },
        randomKey(),
      );
      toast.success(t("sales.creditNoteCreated"));
      onDone(res.credit_note.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.newCreditNote")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("sales.customer")}>
          <CustomerSearch
            value={customer}
            onSelect={(c) => {
              setCustomer(c);
              setInvoiceId("");
            }}
          />
        </Field>
        <Field label={t("sales.creditDate")}>
          <TextInput type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} />
        </Field>
        <Field label={t("sales.reason")}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" maxLength={255} />
        </Field>
        <Field label={t("sales.invoice")}>
          <Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customer}>
            <option value="">{t("sales.selectInvoice")}</option>
            {(invoices.data?.data ?? []).map((inv: SalesInvoiceRow) => (
              <option key={inv.id} value={inv.id} dir="ltr">
                {inv.number} — {inv.total}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={isReturn}
          onChange={(e) => setIsReturn(e.target.checked)}
          className="h-4 w-4"
        />
        {t("sales.isReturn")}
      </label>
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

export function CreditNotesPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.creditNoteCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-credit-notes", companyId, status, page],
    queryFn: () =>
      api.listCreditNotes({
        company_id: companyId!,
        status: (status || undefined) as CreditNote["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <SalesGuard
      perm={PERMS.creditNoteView}
      title={t("sales.creditNotesTitle")}
      subtitle={t("sales.creditNotesSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("sales.newCreditNote")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "posted"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(CREDIT_NOTE_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("sales.noCreditNotes")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.customer"),
                t("sales.creditDate"),
                t("sales.grandTotal"),
                t("sales.isReturn"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((cn) => (
                <tr key={cn.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {cn.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {salesCustomerName(cn.customer, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(cn.credit_date, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={cn.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {cn.is_return ? <Badge tone="accent">✓</Badge> : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={creditNoteStatusTone(cn.status)}>{t(CREDIT_NOTE_STATUS_LABEL_KEYS[cn.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/credit-notes/${cn.id}`}>
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
        <CreditNoteDialog
          onClose={() => setOpen(false)}
          onDone={(creditNoteId) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-credit-notes"] });
            navigate(`/sales/credit-notes/${creditNoteId}`);
          }}
        />
      )}
    </SalesGuard>
  );
}

function PostDialog({
  creditNote,
  onClose,
  onDone,
}: {
  creditNote: CreditNote;
  onClose: () => void;
  onDone: (journalId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (creditNote.is_return && !warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.postCreditNote(
        creditNote.id,
        creditNote.is_return ? { warehouse_id: warehouseId } : undefined,
      );
      toast.success(t("sales.creditNotePosted"));
      onDone(res.journal_id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.post")} onClose={onClose}>
      {creditNote.is_return && (
        <Field label={t("sales.returnWarehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
      )}
      <p className="mt-3 text-sm text-ink-soft" dir="auto">
        {creditNote.reason}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? t("common.loading") : t("sales.post")}
        </Button>
      </div>
    </Dialog>
  );
}

export function CreditNoteDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const [postOpen, setPostOpen] = useState(false);
  const [journalId, setJournalId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["sales-credit-note", id],
    queryFn: () => api.getCreditNote(id!),
    enabled: !!id,
    retry: false,
  });

  const cn = detail.data;
  const canPost = hasPermission(PERMS.creditNotePost);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/credit-notes")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !cn ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {cn.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {salesCustomerName(cn.customer, i18n.language)}
                  {cn.sales_invoice && (
                    <>
                      {" · "}
                      {t("sales.invoice")}:{" "}
                      <Link to={`/sales/invoices/${cn.sales_invoice_id}`} className="font-mono text-accent-deep hover:underline" dir="ltr">
                        {cn.sales_invoice.number}
                      </Link>
                    </>
                  )}
                  {" · "}
                  {t("sales.creditDate")}: {formatDate(cn.credit_date, i18n.language)}
                </p>
              </div>
              <div className="flex gap-2">
                {cn.is_return && <Badge tone="accent">{t("sales.isReturn")}</Badge>}
                <Badge tone={creditNoteStatusTone(cn.status)}>{t(CREDIT_NOTE_STATUS_LABEL_KEYS[cn.status])}</Badge>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-ink" dir="auto">
              {t("sales.reason")}: {cn.reason}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("sales.subtotal")}: <Amount value={cn.subtotal} />
              </span>
              <span>
                {t("sales.taxTotal")}: <Amount value={cn.tax_total} />
              </span>
              <span className="font-semibold">
                {t("sales.grandTotal")}: <Amount value={cn.total} />
              </span>
            </div>
            {cn.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {cn.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {cn.status === "draft" && (
                <Button size="sm" disabled={!canPost} title={canPost ? undefined : t("common.noPermission")} onClick={() => setPostOpen(true)}>
                  {t("sales.post")}
                </Button>
              )}
              {journalId && (
                <Link to={`/journals/${journalId}`} className="text-sm font-semibold text-accent-deep hover:underline" dir="ltr">
                  {t("sales.journal")}
                </Link>
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
              {cn.lines.map((l) => (
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

      {postOpen && cn && (
        <PostDialog
          creditNote={cn}
          onClose={() => setPostOpen(false)}
          onDone={(jid) => {
            setPostOpen(false);
            setJournalId(jid);
            void qc.invalidateQueries({ queryKey: ["sales-credit-note", cn.id] });
            void qc.invalidateQueries({ queryKey: ["sales-credit-notes"] });
            void detail.refetch();
          }}
        />
      )}
    </>
  );
}
