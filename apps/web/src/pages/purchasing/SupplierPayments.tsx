import type { Supplier, SupplierBillRow, SupplierPaymentStatus } from "@atlas-erp/api-client";
import { useEffect, useMemo, useState } from "react";
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
  formatDate,
  isPositiveDecimal,
  PERMS,
  SUPPLIER_PAYMENT_STATUS_LABEL_KEYS,
  supplierPaymentStatusTone,
  todayISO,
  toNumber,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { PermButton, PurchaseGuard, randomKey, SupplierSearch } from "./shared";

const PER_PAGE = 15;
const PAYMENT_STATUSES: SupplierPaymentStatus[] = ["draft", "posted"];

interface DraftAllocation {
  bill: SupplierBillRow;
  checked: boolean;
  amount: string;
}

function SupplierPaymentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [allocs, setAllocs] = useState<DraftAllocation[]>([]);
  const [busy, setBusy] = useState(false);

  const bills = useQuery({
    queryKey: ["purchasing-open-bills", companyId, supplier?.id],
    queryFn: () =>
      api.listSupplierBills({
        company_id: companyId!,
        supplier_id: supplier!.id,
        per_page: 100,
      }),
    enabled: !!companyId && !!supplier,
    retry: false,
  });

  const openBills = useMemo(
    () => (bills.data?.data ?? []).filter((b) => Number(b.outstanding) > 0),
    [bills.data],
  );

  useEffect(() => {
    setAllocs(
      openBills.map((b) => ({
        bill: b,
        checked: true,
        amount: b.outstanding,
      })),
    );
  }, [openBills]);

  const setAlloc = (billId: string, patch: Partial<DraftAllocation>) =>
    setAllocs(allocs.map((a) => (a.bill.id === billId ? { ...a, ...patch } : a)));

  const chosen = allocs.filter((a) => a.checked);
  const total = chosen.reduce((s, a) => s + (isPositiveDecimal(a.amount) ? toNumber(a.amount) : 0), 0);

  const submit = async () => {
    if (!companyId) return;
    if (!supplier) {
      toast.error(t("purchasing.supplierRequired"));
      return;
    }
    if (chosen.length === 0) {
      toast.error(t("purchasing.noOpenBills"));
      return;
    }
    if (chosen.some((a) => !isPositiveDecimal(a.amount))) {
      toast.error(t("purchasing.amountRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.createSupplierPayment(
        {
          company_id: companyId,
          supplier_id: supplier.id,
          payment_date: paymentDate || undefined,
          amount: total.toFixed(4),
          notes: notes.trim() || undefined,
          allocations: chosen.map((a) => ({
            supplier_bill_id: a.bill.id,
            amount: a.amount.trim(),
          })),
        },
        randomKey(),
      );
      toast.success(t("purchasing.paymentCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.newPayment")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.supplier")}>
          <SupplierSearch
            value={supplier}
            onSelect={(s) => {
              setSupplier(s);
              setAllocs([]);
            }}
          />
        </Field>
        <Field label={t("purchasing.paymentDate")}>
          <TextInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t("purchasing.allocations")}</p>
        {!supplier ? (
          <p className="text-sm text-ink-soft">{t("purchasing.supplierRequired")}</p>
        ) : bills.isLoading ? (
          <LoadingBlock />
        ) : bills.isError ? (
          <ErrorState message={errorMessage(bills.error, t)} onRetry={() => bills.refetch()} />
        ) : allocs.length === 0 ? (
          <EmptyState title={t("purchasing.noOpenBills")} />
        ) : (
          <div className="space-y-2">
            {allocs.map((a) => (
              <div key={a.bill.id} className="flex items-center gap-3 rounded-xl border border-line-soft p-3">
                <input
                  type="checkbox"
                  checked={a.checked}
                  onChange={(e) => setAlloc(a.bill.id, { checked: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[13px] text-ink" dir="ltr">
                    {a.bill.number}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {t("purchasing.outstanding")}:{" "}
                    <span dir="ltr" className="tnum">
                      {a.bill.outstanding}
                    </span>
                  </p>
                </div>
                <div className="w-36">
                  <TextInput
                    dir="ltr"
                    inputMode="decimal"
                    className="tnum"
                    value={a.amount}
                    disabled={!a.checked}
                    onChange={(e) => setAlloc(a.bill.id, { amount: e.target.value })}
                    placeholder="0.0000"
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-surface-soft p-3 text-sm">
              <span className="font-semibold text-ink">{t("purchasing.amount")}</span>
              <span dir="ltr" className="tnum font-bold text-ink">
                {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Field label={t("purchasing.notes")}>
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

export function SupplierPaymentsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.supplierPaymentCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["purchasing-payments", companyId, status, page],
    queryFn: () =>
      api.listSupplierPayments({
        company_id: companyId!,
        status: status || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <PurchaseGuard
      perm={PERMS.supplierPaymentView}
      title={t("purchasing.paymentsTitle")}
      subtitle={t("purchasing.paymentsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("purchasing.newPayment")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(SUPPLIER_PAYMENT_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("purchasing.noPayments")} />
        ) : (
          <>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.amount"),
                t("purchasing.createdOn"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {p.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={p.amount} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(p.created_at, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={supplierPaymentStatusTone(p.status)}>
                      {t(SUPPLIER_PAYMENT_STATUS_LABEL_KEYS[p.status])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/purchasing/payments/${p.id}`}>
                      <Button variant="secondary" size="sm">
                        {t("purchasing.details")}
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
        <SupplierPaymentDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["purchasing-payments"] });
          }}
        />
      )}
    </PurchaseGuard>
  );
}

function usePaymentActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const post = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.postSupplierPayment(id, randomKey());
      toast.success(`${t("purchasing.paymentPosted")} · ${t("purchasing.journal")}: ${res.journal_id.slice(0, 8)}…`);
      await qc.invalidateQueries({ queryKey: ["purchasing-payment", id] });
      await qc.invalidateQueries({ queryKey: ["purchasing-payments"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { post, busy };
}

export function SupplierPaymentDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { post, busy } = usePaymentActions();

  const detail = useQuery({
    queryKey: ["purchasing-payment", id],
    queryFn: () => api.getSupplierPayment(id!),
    enabled: !!id,
    retry: false,
  });

  const p = detail.data;

  const supplier = useQuery({
    queryKey: ["purchasing-payment-supplier", p?.supplier_id],
    queryFn: () => api.getSupplier(p!.supplier_id),
    enabled: !!p?.supplier_id,
    retry: false,
  });

  const { companyId } = useAuth();
  const billsForSupplier = useQuery({
    queryKey: ["purchasing-payment-bills", companyId, p?.supplier_id],
    queryFn: () =>
      api.listSupplierBills({ company_id: companyId!, supplier_id: p!.supplier_id, per_page: 200 }),
    enabled: !!companyId && !!p?.supplier_id,
    retry: false,
  });

  const billNumberById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of billsForSupplier.data?.data ?? []) m.set(b.id, b.number);
    return m;
  }, [billsForSupplier.data]);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/purchasing/payments")}>
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
                  {supplier.data ? `${supplier.data.number} — ${i18n.language === "ar" ? supplier.data.name_ar : supplier.data.name_en}` : ""}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.paymentDate")}: {formatDate(p.payment_date, i18n.language)}
                </p>
              </div>
              <Badge tone={supplierPaymentStatusTone(p.status)}>
                {t(SUPPLIER_PAYMENT_STATUS_LABEL_KEYS[p.status])}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span className="font-semibold">
                {t("purchasing.amount")}: <Amount value={p.amount} />
              </span>
            </div>
            {p.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {p.notes}
              </p>
            )}
            {p.status === "draft" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <PermButton perm={PERMS.supplierPaymentPost} size="sm" disabled={busy} onClick={() => void post(p.id)}>
                  {t("purchasing.post")}
                </PermButton>
              </div>
            )}
          </Card>
          <Card>
            <div className="border-b border-line-soft px-4 py-3">
              <h2 className="text-sm font-bold text-ink">{t("purchasing.allocations")}</h2>
            </div>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.amount"),
              ]}
            >
              {p.allocations.map((a) => (
                <tr key={a.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {billNumberById.get(a.supplier_bill_id) ?? `${a.supplier_bill_id.slice(0, 8)}…`}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={a.amount} />
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
