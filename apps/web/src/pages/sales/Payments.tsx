import type { Customer, SalesInvoiceRow, SalesPayment } from "@atlas-erp/api-client";
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
  PERMS,
  SALES_PAYMENT_STATUS_LABEL_KEYS,
  formatDate,
  isPositiveDecimal,
  salesPaymentStatusTone,
  todayISO,
  toNumber,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import {
  CustomerSearch,
  randomKey,
  salesCustomerName,
  SalesGuard,
} from "./shared";

const PER_PAGE = 15;

interface DraftAllocation {
  key: number;
  sales_invoice_id: string;
  amount: string;
}

function PaymentDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (paymentId: string) => void;
}) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [allocs, setAllocs] = useState<DraftAllocation[]>([{ key: 1, sales_invoice_id: "", amount: "" }]);
  const [busy, setBusy] = useState(false);

  const invoices = useQuery({
    queryKey: ["sales-payment-invoices", companyId, customer?.id],
    queryFn: () => api.listSalesInvoices({ company_id: companyId!, customer_id: customer!.id, per_page: 100 }),
    enabled: !!companyId && !!customer,
    retry: false,
  });
  const openInvoices = (invoices.data?.data ?? []).filter((inv: SalesInvoiceRow) =>
    ["posted", "partially_paid"].includes(inv.status) && toNumber(inv.outstanding) > 0,
  );

  const setAlloc = (key: number, patch: Partial<DraftAllocation>) =>
    setAllocs((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const allocatedTotal = allocs.reduce(
    (sum, a) => sum + (a.sales_invoice_id && isPositiveDecimal(a.amount) ? toNumber(a.amount) : 0),
    0,
  );

  const submit = async () => {
    if (!companyId) return;
    if (!customer) {
      toast.error(t("sales.customerRequired"));
      return;
    }
    if (!isPositiveDecimal(amount)) {
      toast.error(t("sales.amountRequired"));
      return;
    }
    const valid = allocs.filter((a) => a.sales_invoice_id && isPositiveDecimal(a.amount));
    const allocTotal = valid.reduce((s, a) => s + toNumber(a.amount), 0);
    if (allocTotal > toNumber(amount)) {
      toast.error(t("sales.allocationTotalMismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.createSalesPayment(
        {
          company_id: companyId,
          customer_id: customer.id,
          payment_date: paymentDate,
          amount: amount.trim(),
          notes: notes.trim() || undefined,
          allocations: valid.map((a) => ({ sales_invoice_id: a.sales_invoice_id, amount: a.amount.trim() })),
        },
        randomKey(),
      );
      toast.success(t("sales.paymentCreated"));
      onDone(res.payment.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.newPayment")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t("sales.customer")}>
          <CustomerSearch
            value={customer}
            onSelect={(c) => {
              setCustomer(c);
              setAllocs([{ key: Date.now(), sales_invoice_id: "", amount: "" }]);
            }}
          />
        </Field>
        <Field label={t("sales.paymentDate")}>
          <TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
        <Field label={t("sales.amount")}>
          <TextInput
            dir="ltr"
            inputMode="decimal"
            className="tnum"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0000"
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t("sales.allocations")}</p>
        {!customer ? (
          <p className="text-sm text-ink-soft">{t("sales.customerRequired")}</p>
        ) : (
          <div className="space-y-3">
            {allocs.map((a) => {
              const inv = openInvoices.find((x) => x.id === a.sales_invoice_id);
              return (
                <div key={a.key} className="grid grid-cols-1 gap-3 rounded-xl border border-line-soft p-3 sm:grid-cols-[1fr_160px_auto]">
                  <Field label={t("sales.selectInvoice")}>
                    <Select value={a.sales_invoice_id} onChange={(e) => setAlloc(a.key, { sales_invoice_id: e.target.value })}>
                      <option value="">{t("sales.selectInvoice")}</option>
                      {openInvoices
                        .filter((x) => x.id === a.sales_invoice_id || !allocs.some((y) => y.key !== a.key && y.sales_invoice_id === x.id))
                        .map((x) => (
                          <option key={x.id} value={x.id} dir="ltr">
                            {x.number} — {t("sales.outstanding")}: {x.outstanding}
                          </option>
                        ))}
                    </Select>
                    {inv && (
                      <p className="mt-1 text-xs text-ink-soft">
                        {t("sales.outstanding")}:{" "}
                        <span dir="ltr" className="tnum">
                          {inv.outstanding}
                        </span>
                      </p>
                    )}
                  </Field>
                  <Field label={t("sales.amount")}>
                    <TextInput
                      dir="ltr"
                      inputMode="decimal"
                      className="tnum"
                      value={a.amount}
                      onChange={(e) => setAlloc(a.key, { amount: e.target.value })}
                      placeholder="0.0000"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={allocs.length === 1}
                      onClick={() => setAllocs((ls) => ls.filter((x) => x.key !== a.key))}
                    >
                      <span className="text-danger">{t("common.remove")}</span>
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAllocs((ls) => [...ls, { key: Date.now(), sales_invoice_id: "", amount: "" }])}
            >
              {t("sales.addAllocation")}
            </Button>
            {allocatedTotal > 0 && (
              <p className="text-sm text-ink-soft">
                {t("sales.allocations")}:{" "}
                <b dir="ltr" className="tnum text-ink">
                  {allocatedTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </b>
              </p>
            )}
          </div>
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

export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.paymentCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-payments", companyId, status, page],
    queryFn: () =>
      api.listSalesPayments({
        company_id: companyId!,
        status: (status || undefined) as SalesPayment["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <SalesGuard
      perm={PERMS.paymentView}
      title={t("sales.paymentsTitle")}
      subtitle={t("sales.paymentsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("sales.newPayment")}
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
                  {t(SALES_PAYMENT_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("sales.noPayments")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.customer"),
                t("sales.paymentDate"),
                t("sales.amount"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {p.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {salesCustomerName(p.customer, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(p.payment_date, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={p.amount} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={salesPaymentStatusTone(p.status)}>{t(SALES_PAYMENT_STATUS_LABEL_KEYS[p.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/payments/${p.id}`}>
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
        <PaymentDialog
          onClose={() => setOpen(false)}
          onDone={(paymentId) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-payments"] });
            navigate(`/sales/payments/${paymentId}`);
          }}
        />
      )}
    </SalesGuard>
  );
}

export function PaymentDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [journalId, setJournalId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["sales-payment", id],
    queryFn: () => api.getSalesPayment(id!),
    enabled: !!id,
    retry: false,
  });

  const p = detail.data;
  const canPost = hasPermission(PERMS.paymentPost);

  const post = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const res = await api.postSalesPayment(p.id, randomKey());
      toast.success(t("sales.paymentPosted"));
      setJournalId(res.journal_id);
      await qc.invalidateQueries({ queryKey: ["sales-payment", p.id] });
      await qc.invalidateQueries({ queryKey: ["sales-payments"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/payments")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !p ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {p.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {salesCustomerName(p.customer, i18n.language)}
                  {" · "}
                  {t("sales.paymentDate")}: {formatDate(p.payment_date, i18n.language)}
                </p>
              </div>
              <Badge tone={salesPaymentStatusTone(p.status)}>{t(SALES_PAYMENT_STATUS_LABEL_KEYS[p.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span className="font-semibold">
                {t("sales.amount")}: <Amount value={p.amount} />
              </span>
            </div>
            {p.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {p.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {p.status === "draft" && (
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
            <h2 className="p-4 pb-0 text-base font-bold text-ink">{t("sales.allocations")}</h2>
            {p.allocations.length === 0 ? (
              <EmptyState title={t("sales.noInvoices")} />
            ) : (
              <Table head={[t("sales.invoice"), t("sales.amount")]}>
                {p.allocations.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-soft/50">
                    <td className="px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                      {a.invoice_number}
                    </td>
                    <td className="px-4 py-3">
                      <Amount value={a.amount} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
