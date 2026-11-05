import type { GoodsReceiptStatus, PurchaseOrder } from "@atlas-erp/api-client";
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
  GOODS_RECEIPT_STATUS_LABEL_KEYS,
  goodsReceiptStatusTone,
  isPositiveDecimal,
  isValidDecimal,
  PERMS,
  Qty,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { WarehouseSelect } from "../inventory/shared";
import { PermButton, PurchaseGuard, randomKey } from "./shared";

const PER_PAGE = 15;
const RECEIVABLE_PO_STATUSES = ["approved", "partially_received"];

const RECEIPT_STATUSES: GoodsReceiptStatus[] = ["draft", "posted", "cancelled"];

interface DraftReceiptLine {
  key: number;
  po_line_id: string;
  description: string;
  ordered: string;
  received_so_far: string;
  quantity: string;
  unit_cost: string;
}

function blankReceiptLine(key: number, poLine: PurchaseOrder["lines"][number]): DraftReceiptLine {
  const remaining = Math.max(0, Number(poLine.quantity) - Number(poLine.received_quantity));
  return {
    key,
    po_line_id: poLine.id,
    description: poLine.description,
    ordered: poLine.quantity,
    received_so_far: poLine.received_quantity,
    quantity: remaining > 0 ? String(remaining) : "",
    unit_cost: poLine.unit_price,
  };
}

function GoodsReceiptDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [poId, setPoId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);

  const pos = useQuery({
    queryKey: ["purchasing-receivable-pos", companyId],
    queryFn: () => api.listPurchaseOrders({ company_id: companyId!, per_page: 50 }),
    enabled: !!companyId,
    retry: false,
  });

  const receivablePos = useMemo(
    () => (pos.data?.data ?? []).filter((o) => RECEIVABLE_PO_STATUSES.includes(o.status)),
    [pos.data],
  );

  const poDetail = useQuery({
    queryKey: ["purchasing-order-for-receipt", poId],
    queryFn: () => api.getPurchaseOrder(poId),
    enabled: !!poId,
    retry: false,
  });

  const selectPo = (id: string) => {
    setPoId(id);
    setLines([]);
    setWarehouseId("");
  };

  useEffect(() => {
    const po = poDetail.data;
    if (po && lines.length === 0) {
      setWarehouseId(po.warehouse_id);
      setLines(po.lines.map((l, i) => blankReceiptLine(i + 1, l)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poDetail.data]);

  const setLine = (key: number, patch: Partial<DraftReceiptLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const validLines = lines.filter(
    (l) => isPositiveDecimal(l.quantity) && (l.unit_cost.trim() === "" || isValidDecimal(l.unit_cost)),
  );

  const submit = async () => {
    if (!companyId) return;
    if (!poId) {
      toast.error(t("purchasing.poRequired"));
      return;
    }
    if (validLines.length === 0) {
      toast.error(t("purchasing.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      await api.createGoodsReceipt(
        {
          company_id: companyId,
          purchase_order_id: poId,
          warehouse_id: warehouseId || undefined,
          receipt_date: receiptDate || undefined,
          notes: notes.trim() || undefined,
          lines: validLines.map((l) => ({
            purchase_order_line_id: l.po_line_id,
            quantity: l.quantity.trim(),
            unit_cost: l.unit_cost.trim() === "" ? undefined : l.unit_cost.trim(),
          })),
        },
        randomKey(),
      );
      toast.success(t("purchasing.receiptCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.newReceipt")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.purchaseOrder")}>
          <Select value={poId} onChange={(e) => selectPo(e.target.value)}>
            <option value="">{t("purchasing.selectPurchaseOrder")}</option>
            {receivablePos.map((o) => (
              <option key={o.id} value={o.id} dir="ltr">
                {o.number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("purchasing.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
        <Field label={t("purchasing.receiptDate")}>
          <TextInput type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
        </Field>
      </div>

      {poDetail.isLoading ? (
        <div className="mt-4">
          <LoadingBlock />
        </div>
      ) : poDetail.isError ? (
        <p className="mt-4 text-sm text-danger">{errorMessage(poDetail.error, t)}</p>
      ) : lines.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-ink">{t("purchasing.lines")}</p>
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="rounded-xl border border-line-soft p-3">
                <p className="text-sm font-medium text-ink" dir="auto">
                  {l.description}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  <span dir="ltr" className="tnum">
                    {l.ordered}
                  </span>{" "}
                  · {t("purchasing.receivedQuantity")}:{" "}
                  <span dir="ltr" className="tnum">
                    {l.received_so_far}
                  </span>{" "}
                  · {t("purchasing.remainingToReceive")}:{" "}
                  <span dir="ltr" className="tnum">
                    {Math.max(0, Number(l.ordered) - Number(l.received_so_far)).toFixed(4)}
                  </span>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label={t("purchasing.quantity")}>
                    <TextInput
                      dir="ltr"
                      inputMode="decimal"
                      className="tnum"
                      value={l.quantity}
                      onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      placeholder="0.0000"
                    />
                  </Field>
                  <Field label={t("purchasing.unitCost")}>
                    <TextInput
                      dir="ltr"
                      inputMode="decimal"
                      className="tnum"
                      value={l.unit_cost}
                      onChange={(e) => setLine(l.key, { unit_cost: e.target.value })}
                      placeholder="0.0000"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : poId ? (
        <p className="mt-4 text-sm text-ink-soft">{t("common.empty")}</p>
      ) : null}

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

export function GoodsReceiptsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.goodsReceiptCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["purchasing-receipts", companyId, status, page],
    queryFn: () =>
      api.listGoodsReceipts({
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
      perm={PERMS.goodsReceiptView}
      title={t("purchasing.receiptsTitle")}
      subtitle={t("purchasing.receiptsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("purchasing.newReceipt")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {RECEIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(GOODS_RECEIPT_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("purchasing.noReceipts")} />
        ) : (
          <>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.receiptDate"),
                t("purchasing.createdOn"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((g) => (
                <tr key={g.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {g.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(g.receipt_date, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(g.created_at, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={goodsReceiptStatusTone(g.status)}>
                      {t(GOODS_RECEIPT_STATUS_LABEL_KEYS[g.status])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/purchasing/receipts/${g.id}`}>
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
        <GoodsReceiptDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["purchasing-receipts"] });
          }}
        />
      )}
    </PurchaseGuard>
  );
}

function useReceiptActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const transition = async (id: string, action: "post" | "cancel") => {
    setBusy(true);
    try {
      if (action === "post") {
        await api.postGoodsReceipt(id, randomKey());
        toast.success(t("purchasing.receiptPosted"));
      } else {
        await api.cancelGoodsReceipt(id);
        toast.success(t("purchasing.receiptCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["purchasing-receipt", id] });
      await qc.invalidateQueries({ queryKey: ["purchasing-receipts"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { transition, busy };
}

export function GoodsReceiptDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { transition, busy } = useReceiptActions();

  const detail = useQuery({
    queryKey: ["purchasing-receipt", id],
    queryFn: () => api.getGoodsReceipt(id!),
    enabled: !!id,
    retry: false,
  });

  const g = detail.data;

  const po = useQuery({
    queryKey: ["purchasing-order-for-receipt", g?.purchase_order_id],
    queryFn: () => api.getPurchaseOrder(g!.purchase_order_id),
    enabled: !!g,
    retry: false,
  });

  const poLineDesc = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of po.data?.lines ?? []) m.set(l.id, l.description);
    return m;
  }, [po.data]);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/purchasing/receipts")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !g ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {g.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.receiptDate")}: {formatDate(g.receipt_date, i18n.language)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.purchaseOrder")}:{" "}
                  <Link
                    to={`/purchasing/orders/${g.purchase_order_id}`}
                    className="font-mono text-[13px] text-accent underline"
                    dir="ltr"
                  >
                    {g.purchase_order_id.slice(0, 8)}…
                  </Link>
                </p>
              </div>
              <Badge tone={goodsReceiptStatusTone(g.status)}>
                {t(GOODS_RECEIPT_STATUS_LABEL_KEYS[g.status])}
              </Badge>
            </div>
            {g.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {g.notes}
              </p>
            )}
            {g.status === "draft" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <PermButton perm={PERMS.goodsReceiptPost} size="sm" disabled={busy} onClick={() => void transition(g.id, "post")}>
                  {t("purchasing.post")}
                </PermButton>
                <PermButton perm={PERMS.goodsReceiptEdit} size="sm" variant="secondary" disabled={busy} onClick={() => void transition(g.id, "cancel")}>
                  {t("purchasing.cancel")}
                </PermButton>
              </div>
            )}
          </Card>
          <Card>
            <Table
              head={[
                t("purchasing.description"),
                t("purchasing.quantity"),
                t("purchasing.unitCost"),
              ]}
            >
              {g.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {poLineDesc.get(l.purchase_order_line_id) ?? (
                      <span className="font-mono text-xs text-ink-faint" dir="ltr">
                        {l.purchase_order_line_id.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={l.quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.unit_cost} />
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
