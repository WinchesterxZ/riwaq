import type {
  PurchaseOrder,
  Supplier,
  SupplierBillLine,
  SupplierBillStatus,
} from "@atlas-erp/api-client";
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
import { PdfButton } from "../../components/PdfButton";
import {
  Amount,
  formatDate,
  PERMS,
  purchaseSupplierName,
  Qty,
  SUPPLIER_BILL_STATUS_LABEL_KEYS,
  supplierBillStatusTone,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import {
  blankPricedLine,
  draftLineToInput,
  PricedLineEditor,
  type DraftPricedLine,
} from "../sales/shared";
import { isPurchasingLineValid } from "./PurchaseRequests";
import { PermButton, PurchaseGuard, randomKey, SupplierSearch } from "./shared";

const PER_PAGE = 15;
const BILLABLE_PO_STATUSES = ["approved", "partially_received", "received", "billed"];
const BILL_STATUSES: SupplierBillStatus[] = [
  "draft",
  "submitted",
  "approved",
  "posted",
  "partially_paid",
  "paid",
];

/* matching tolerances mirror the backend (5% qty, 2% price) */
const QTY_TOL_PCT = 5;
const PRICE_TOL_PCT = 2;

interface BillDraftLine extends DraftPricedLine {
  po_line_id?: string;
  grn_line_id?: string;
}

function blankBillLine(key: number): BillDraftLine {
  return { ...blankPricedLine(key) };
}

function billLineFromPo(poLine: PurchaseOrder["lines"][number], key: number): BillDraftLine {
  const remaining = Math.max(0, Number(poLine.quantity) - Number(poLine.billed_quantity));
  return {
    key,
    product: null,
    description: poLine.description,
    quantity: remaining > 0 ? String(remaining) : poLine.quantity,
    unit_price: poLine.unit_price,
    discount_rate: poLine.discount_rate,
    tax_rate: poLine.tax_rate,
    po_line_id: poLine.id,
  };
}

function SupplierBillDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [poId, setPoId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BillDraftLine[]>([blankBillLine(1)]);
  const [busy, setBusy] = useState(false);

  const pos = useQuery({
    queryKey: ["purchasing-billable-pos", companyId, supplier?.id],
    queryFn: () =>
      api.listPurchaseOrders({ company_id: companyId!, supplier_id: supplier?.id, per_page: 50 }),
    enabled: !!companyId,
    retry: false,
  });

  const grns = useQuery({
    queryKey: ["purchasing-posted-grns", companyId],
    queryFn: () =>
      api.listGoodsReceipts({ company_id: companyId!, status: "posted", per_page: 50 }),
    enabled: !!companyId,
    retry: false,
  });

  const billablePos = useMemo(
    () => (pos.data?.data ?? []).filter((o) => BILLABLE_PO_STATUSES.includes(o.status)),
    [pos.data],
  );

  const poDetail = useQuery({
    queryKey: ["purchasing-order-for-bill", poId],
    queryFn: () => api.getPurchaseOrder(poId),
    enabled: !!poId,
    retry: false,
  });

  const grnDetail = useQuery({
    queryKey: ["purchasing-receipt-for-bill", grnId],
    queryFn: () => api.getGoodsReceipt(grnId),
    enabled: !!grnId,
    retry: false,
  });

  const selectPo = (id: string) => {
    setPoId(id);
    setGrnId("");
    setLines([blankBillLine(Date.now())]);
  };

  const selectGrn = (id: string) => {
    setGrnId(id);
    setPoId("");
    setLines([blankBillLine(Date.now())]);
  };

  useEffect(() => {
    const po = poDetail.data;
    if (po && !grnId) {
      setLines(po.lines.map((l, i) => billLineFromPo(l, i + 1)));
      if (!supplier) {
        api.getSupplier(po.supplier_id).then(setSupplier).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poDetail.data]);

  useEffect(() => {
    const grn = grnDetail.data;
    if (!grn || poId) return;
    const build = async () => {
      try {
        const po = await api.getPurchaseOrder(grn.purchase_order_id);
        const poById = new Map(po.lines.map((l) => [l.id, l]));
        setLines(
          grn.lines.map((gl, i) => {
            const pl = poById.get(gl.purchase_order_line_id);
            return {
              key: i + 1,
              product: null,
              description: pl?.description ?? "",
              quantity: gl.quantity,
              unit_price: gl.unit_cost,
              discount_rate: pl?.discount_rate ?? "",
              tax_rate: pl?.tax_rate ?? "",
              po_line_id: gl.purchase_order_line_id,
              grn_line_id: gl.id,
            } as BillDraftLine;
          }),
        );
        setPoId(grn.purchase_order_id);
      } catch (err) {
        toast.error(errorMessage(err, t));
      }
    };
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grnDetail.data]);

  /** Merge editor updates back while preserving the PO/GRN link ids. */
  const handleSetLines = (ls: DraftPricedLine[]) => {
    setLines((prev) => {
      const prevByKey = new Map(prev.map((p) => [p.key, p]));
      return ls.map((l) => ({ ...(prevByKey.get(l.key) ?? {}), ...l }) as BillDraftLine);
    });
  };

  const valid = lines.filter(isPurchasingLineValid);

  const submit = async () => {
    if (!companyId) return;
    if (!supplier) {
      toast.error(t("purchasing.supplierRequired"));
      return;
    }
    if (valid.length === 0) {
      toast.error(t("purchasing.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      await api.createSupplierBill(
        {
          company_id: companyId,
          supplier_id: supplier.id,
          purchase_order_id: poId || undefined,
          goods_receipt_id: grnId || undefined,
          supplier_ref: supplierRef.trim() || undefined,
          bill_date: billDate || undefined,
          due_date: dueDate || undefined,
          notes: notes.trim() || undefined,
          lines: valid.map((l) => ({
            ...draftLineToInput(l),
            purchase_order_line_id: l.po_line_id,
            goods_receipt_line_id: l.grn_line_id,
          })),
        },
        randomKey(),
      );
      toast.success(t("purchasing.billCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.newBill")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.supplier")}>
          <SupplierSearch value={supplier} onSelect={setSupplier} />
        </Field>
        <Field label={t("purchasing.supplierRef")}>
          <TextInput value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} dir="ltr" maxLength={60} />
        </Field>
        <Field label={t("purchasing.fromPurchaseOrder")}>
          <Select value={poId} onChange={(e) => selectPo(e.target.value)}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {billablePos.map((o) => (
              <option key={o.id} value={o.id} dir="ltr">
                {o.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("purchasing.fromGoodsReceipt")}>
          <Select value={grnId} onChange={(e) => selectGrn(e.target.value)}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {(grns.data?.data ?? []).map((g) => (
              <option key={g.id} value={g.id} dir="ltr">
                {g.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("purchasing.billDate")}>
          <TextInput type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        <Field label={t("purchasing.dueDate")}>
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <PricedLineEditor
          lines={lines}
          setLines={handleSetLines}
          autoDescription
          excludeProductTypes={["service"]}
        />
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

export function SupplierBillsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.supplierBillCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["purchasing-bills", companyId, status, page],
    queryFn: () =>
      api.listSupplierBills({
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
      perm={PERMS.supplierBillView}
      title={t("purchasing.billsTitle")}
      subtitle={t("purchasing.billsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("purchasing.newBill")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {BILL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(SUPPLIER_BILL_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("purchasing.noBills")} />
        ) : (
          <>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.supplier"),
                t("purchasing.grandTotal"),
                t("purchasing.outstanding"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((b) => (
                <tr key={b.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {b.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {purchaseSupplierName(b.supplier, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={b.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={b.outstanding} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={supplierBillStatusTone(b.status)}>
                      {t(SUPPLIER_BILL_STATUS_LABEL_KEYS[b.status])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/purchasing/bills/${b.id}`}>
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
        <SupplierBillDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["purchasing-bills"] });
          }}
        />
      )}
    </PurchaseGuard>
  );
}

function useBillActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const transition = async (id: string, action: "submit" | "approve" | "post") => {
    setBusy(true);
    try {
      if (action === "submit") {
        await api.submitSupplierBill(id);
        toast.success(t("purchasing.billSubmitted"));
      } else if (action === "approve") {
        await api.approveSupplierBill(id);
        toast.success(t("purchasing.billApproved"));
      } else {
        const res = await api.postSupplierBill(id, randomKey());
        toast.success(`${t("purchasing.billPosted")} · ${t("purchasing.journal")}: ${res.journal_id.slice(0, 8)}…`);
      }
      await qc.invalidateQueries({ queryKey: ["purchasing-bill", id] });
      await qc.invalidateQueries({ queryKey: ["purchasing-bills"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { transition, busy };
}

/* ---------- matching ---------- */

interface MatchInfo {
  qtyVar: number;
  priceVar: number;
  ok: boolean;
}

function matchAgainst(refQty: string, refPrice: string, qty: string, price: string): MatchInfo {
  const rQ = Number(refQty);
  const rP = Number(refPrice);
  const bQ = Number(qty);
  const bP = Number(price);
  const qtyVar = rQ === 0 ? (bQ === 0 ? 0 : 100) : (Math.abs(bQ - rQ) / rQ) * 100;
  const priceVar = rP === 0 ? (bP === 0 ? 0 : 100) : (Math.abs(bP - rP) / rP) * 100;
  return { qtyVar, priceVar, ok: qtyVar <= QTY_TOL_PCT && priceVar <= PRICE_TOL_PCT };
}

function MatchBadge({ line, po }: { line: SupplierBillLine; po?: PurchaseOrder }) {
  const { t } = useTranslation();
  const ref = line.purchase_order_line_id ? po?.lines.find((l) => l.id === line.purchase_order_line_id) : undefined;
  if (ref) {
    const m = matchAgainst(ref.quantity, ref.unit_price, line.quantity, line.unit_price);
    return (
      <span className="flex flex-col gap-1">
        <Badge tone={m.ok ? "success" : "warning"}>
          {m.ok ? t("purchasing.matched") : t("purchasing.matchVariance")}
        </Badge>
        <span className="text-xs text-ink-soft" dir="ltr">
          {t("purchasing.qtyVariance")}: {m.qtyVar.toFixed(2)}% · {t("purchasing.priceVariance")}:{" "}
          {m.priceVar.toFixed(2)}%
        </span>
      </span>
    );
  }
  if (line.goods_receipt_line_id) {
    return <Badge tone="accent">{t("purchasing.fromGoodsReceipt")}</Badge>;
  }
  return <Badge tone="neutral">{t("purchasing.noLink")}</Badge>;
}

export function SupplierBillDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { transition, busy } = useBillActions();

  const detail = useQuery({
    queryKey: ["purchasing-bill", id],
    queryFn: () => api.getSupplierBill(id!),
    enabled: !!id,
    retry: false,
  });

  const b = detail.data;

  const po = useQuery({
    queryKey: ["purchasing-order-for-bill", b?.purchase_order_id],
    queryFn: () => api.getPurchaseOrder(b!.purchase_order_id!),
    enabled: !!b?.purchase_order_id,
    retry: false,
  });

  const supplier = useQuery({
    queryKey: ["purchasing-bill-supplier", b?.supplier_id],
    queryFn: () => api.getSupplier(b!.supplier_id),
    enabled: !!b?.supplier_id,
    retry: false,
  });

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/purchasing/bills")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !b ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {b.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {supplier.data ? `${supplier.data.number} — ${i18n.language === "ar" ? supplier.data.name_ar : supplier.data.name_en}` : ""}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.billDate")}: {formatDate(b.bill_date, i18n.language)}
                  {b.due_date && ` · ${t("purchasing.dueDate")}: ${formatDate(b.due_date, i18n.language)}`}
                </p>
                {b.supplier_ref && (
                  <p className="mt-1 text-sm text-ink-soft">
                    {t("purchasing.supplierRef")}: <span dir="ltr">{b.supplier_ref}</span>
                  </p>
                )}
                {b.purchase_order_id && (
                  <p className="mt-1 text-sm text-ink-soft">
                    {t("purchasing.purchaseOrder")}:{" "}
                    <Link
                      to={`/purchasing/orders/${b.purchase_order_id}`}
                      className="font-mono text-[13px] text-accent underline"
                      dir="ltr"
                    >
                      {po.data?.number ?? b.purchase_order_id.slice(0, 8) + "…"}
                    </Link>
                  </p>
                )}
              </div>
              <Badge tone={supplierBillStatusTone(b.status)}>
                {t(SUPPLIER_BILL_STATUS_LABEL_KEYS[b.status])}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("purchasing.subtotal")}: <Amount value={b.subtotal} />
              </span>
              <span>
                {t("purchasing.taxTotal")}: <Amount value={b.tax_total} />
              </span>
              <span className="font-semibold">
                {t("purchasing.grandTotal")}: <Amount value={b.total} />
              </span>
              <span>
                {t("purchasing.paidTotal")}: <Amount value={b.paid_total} />
              </span>
              <span className="font-semibold">
                {t("purchasing.outstanding")}: <Amount value={b.outstanding} />
              </span>
            </div>
            {b.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {b.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <PdfButton fetch={() => api.supplierBillPdf(b.id)} filename={`bill-${b.number}.pdf`} />
              {b.status === "draft" && (
                <PermButton perm={PERMS.supplierBillSubmit} size="sm" disabled={busy} onClick={() => void transition(b.id, "submit")}>
                  {t("purchasing.submit")}
                </PermButton>
              )}
              {b.status === "submitted" && (
                <PermButton perm={PERMS.supplierBillApprove} size="sm" disabled={busy} onClick={() => void transition(b.id, "approve")}>
                  {t("purchasing.approve")}
                </PermButton>
              )}
              {b.status === "approved" && (
                <PermButton perm={PERMS.supplierBillPost} size="sm" disabled={busy} onClick={() => void transition(b.id, "post")}>
                  {t("purchasing.post")}
                </PermButton>
              )}
            </div>
          </Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
              <h2 className="text-sm font-bold text-ink">{t("purchasing.matchingStatus")}</h2>
              <p className="text-xs text-ink-soft">{t("purchasing.matchToleranceNote")}</p>
            </div>
            <Table
              head={[
                t("purchasing.description"),
                t("purchasing.quantity"),
                t("purchasing.unitPrice"),
                t("purchasing.lineTotal"),
                t("purchasing.matchingStatus"),
              ]}
            >
              {b.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.description}
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={l.quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.unit_price} />
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.line_total} />
                  </td>
                  <td className="px-4 py-3">
                    <MatchBadge line={l} po={po.data} />
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
