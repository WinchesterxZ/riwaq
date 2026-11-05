import type { Customer, DeliveryRow, SalesInvoice, SalesOrderRow } from "@atlas-erp/api-client";
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
  Qty,
  SALES_INVOICE_STATUS_LABEL_KEYS,
  formatDate,
  salesInvoiceStatusTone,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";

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
type Source = "order" | "deliveries" | "direct";

function InvoiceDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (invoiceId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>("order");
  const [orderId, setOrderId] = useState("");
  const [deliveryIds, setDeliveryIds] = useState<string[]>([]);
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["sales-invoice-orders", companyId],
    queryFn: () => api.listSalesOrders({ company_id: companyId!, per_page: 100 }),
    enabled: !!companyId && source === "order",
    retry: false,
  });

  const deliveries = useQuery({
    queryKey: ["sales-invoice-deliveries", companyId],
    queryFn: () => api.listDeliveries({ company_id: companyId!, per_page: 100 }),
    enabled: !!companyId && source === "deliveries",
    retry: false,
  });
  const postedDeliveries = (deliveries.data?.data ?? []).filter((d: DeliveryRow) =>
    ["posted", "partially_invoiced"].includes(d.status),
  );

  const toggleDelivery = (id: string) =>
    setDeliveryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const create = async (input: {
    company_id: string;
    customer_id: string;
    invoice_date: string;
    notes?: string;
    sales_order_id?: string;
    delivery_ids?: string[];
    lines?: { product_id: string; description: string; quantity: string; unit_price: string; discount_rate?: string; tax_rate?: string }[];
  }) => {
    setBusy(true);
    try {
      const res = await api.createSalesInvoice(input, randomKey());
      toast.success(t("sales.invoiceCreated"));
      onDone(res.invoice.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!companyId) return;
    if (!customer) {
      toast.error(t("sales.customerRequired"));
      return;
    }
    const base = {
      company_id: companyId,
      customer_id: customer.id,
      invoice_date: invoiceDate,
      notes: notes.trim() || undefined,
    };
    if (source === "order") {
      if (!orderId) {
        toast.error(t("sales.selectSalesOrder"));
        return;
      }
      await create({ ...base, sales_order_id: orderId });
    } else if (source === "deliveries") {
      if (deliveryIds.length === 0) {
        toast.error(t("sales.needLinesError"));
        return;
      }
      await create({ ...base, delivery_ids: deliveryIds });
    } else {
      const valid = lines.filter((l) => l.product && isDraftLineValid(l));
      if (valid.length === 0) {
        toast.error(t("sales.needLinesError"));
        return;
      }
      await create({
        ...base,
        lines: valid.map((l) => {
          const input = draftLineToInput(l);
          return {
            ...input,
            product_id: l.product!.id,
            description: input.description || l.product!.name_ar || l.product!.name_en,
          };
        }),
      });
    }
  };

  return (
    <Dialog open title={t("sales.newInvoice")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("sales.customer")}>
          <CustomerSearch value={customer} onSelect={setCustomer} />
        </Field>
        <Field label={t("sales.invoiceDate")}>
          <TextInput type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        {(
          [
            ["order", t("sales.fromOrder")],
            ["deliveries", t("sales.fromDeliveries")],
            ["direct", t("sales.lines")],
          ] as [Source, string][]
        ).map(([s, label]) => (
          <Button
            key={s}
            size="sm"
            variant={source === s ? "primary" : "secondary"}
            onClick={() => setSource(s)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="mt-4">
        {source === "order" && (
          <Field label={t("sales.salesOrder")}>
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">{t("sales.selectSalesOrder")}</option>
              {(orders.data?.data ?? []).map((o: SalesOrderRow) => (
                <option key={o.id} value={o.id} dir="ltr">
                  {o.number} — {o.total}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {source === "deliveries" && (
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">{t("sales.selectDeliveries")}</p>
            {deliveries.isLoading ? (
              <LoadingBlock />
            ) : postedDeliveries.length === 0 ? (
              <EmptyState title={t("sales.noDeliveries")} />
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line-soft p-2">
                {postedDeliveries.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-soft">
                    <input
                      type="checkbox"
                      checked={deliveryIds.includes(d.id)}
                      onChange={() => toggleDelivery(d.id)}
                      className="h-4 w-4"
                    />
                    <span dir="ltr" className="font-mono text-[13px] text-ink">
                      {d.number}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {formatDate(d.delivery_date, i18n.language)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {source === "direct" && (
          <PricedLineEditor lines={lines} setLines={setLines} requireProduct autoDescription />
        )}
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

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.salesInvoiceCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-invoices", companyId, status, page],
    queryFn: () =>
      api.listSalesInvoices({
        company_id: companyId!,
        status: (status || undefined) as SalesInvoice["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <SalesGuard
      perm={PERMS.salesInvoiceView}
      title={t("sales.invoicesTitle")}
      subtitle={t("sales.invoicesSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("sales.newInvoice")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "posted", "partially_paid", "paid"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(SALES_INVOICE_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("sales.noInvoices")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.customer"),
                t("sales.invoiceDate"),
                t("sales.grandTotal"),
                t("sales.outstanding"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((inv) => (
                <tr key={inv.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {inv.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {salesCustomerName(inv.customer, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(inv.invoice_date, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={inv.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={inv.outstanding} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={salesInvoiceStatusTone(inv.status)}>{t(SALES_INVOICE_STATUS_LABEL_KEYS[inv.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/invoices/${inv.id}`}>
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
        <InvoiceDialog
          onClose={() => setOpen(false)}
          onDone={(invoiceId) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-invoices"] });
            navigate(`/sales/invoices/${invoiceId}`);
          }}
        />
      )}
    </SalesGuard>
  );
}

export function InvoiceDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["sales-invoice", id],
    queryFn: () => api.getSalesInvoice(id!),
    enabled: !!id,
    retry: false,
  });

  const inv = detail.data;
  const canPost = hasPermission(PERMS.salesInvoicePost);
  const [journalId, setJournalId] = useState<string | null>(null);

  const post = async () => {
    if (!inv) return;
    setBusy(true);
    try {
      const res = await api.postSalesInvoice(inv.id, randomKey());
      toast.success(t("sales.invoicePosted"));
      setJournalId(res.journal_id);
      await qc.invalidateQueries({ queryKey: ["sales-invoice", inv.id] });
      await qc.invalidateQueries({ queryKey: ["sales-invoices"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/invoices")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !inv ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {inv.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {salesCustomerName(inv.customer, i18n.language)}
                  {inv.sales_order && (
                    <>
                      {" · "}
                      {t("sales.salesOrder")}:{" "}
                      <Link to={`/sales/orders/${inv.sales_order_id}`} className="font-mono text-accent-deep hover:underline" dir="ltr">
                        {inv.sales_order.number}
                      </Link>
                    </>
                  )}
                  {" · "}
                  {t("sales.invoiceDate")}: {formatDate(inv.invoice_date, i18n.language)}
                </p>
              </div>
              <Badge tone={salesInvoiceStatusTone(inv.status)}>{t(SALES_INVOICE_STATUS_LABEL_KEYS[inv.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("sales.subtotal")}: <Amount value={inv.subtotal} />
              </span>
              <span>
                {t("sales.taxTotal")}: <Amount value={inv.tax_total} />
              </span>
              <span className="font-semibold">
                {t("sales.grandTotal")}: <Amount value={inv.total} />
              </span>
              <span>
                {t("sales.paidTotal")}: <Amount value={inv.paid_total} />
              </span>
              <span className="font-semibold">
                {t("sales.outstanding")}: <Amount value={inv.outstanding} />
              </span>
            </div>
            {inv.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {inv.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PdfButton fetch={() => api.salesInvoicePdf(inv.id)} filename={`invoice-${inv.number}.pdf`} />
              {inv.status === "draft" && (
                <Button size="sm" disabled={busy || !canPost} title={canPost ? undefined : t("common.noPermission")} onClick={() => void post()}>
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
              {inv.lines.map((l) => (
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
    </>
  );
}
