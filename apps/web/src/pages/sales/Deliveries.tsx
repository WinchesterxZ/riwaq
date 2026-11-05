import type { Delivery, SalesOrder } from "@atlas-erp/api-client";
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
  DELIVERY_STATUS_LABEL_KEYS,
  PERMS,
  Qty,
  deliveryStatusTone,
  formatDate,
  isPositiveDecimal,
  todayISO,
  toNumber,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { WarehouseSelect, warehouseLabel, useWarehouses } from "../inventory/shared";
import { randomKey, salesProductLabel, SalesGuard } from "./shared";

const PER_PAGE = 15;
const DELIVERABLE_STATUSES: SalesOrder["status"][] = ["confirmed", "partially_delivered"];

function orderLabel(o: { number: string; total: string }): string {
  return `${o.number} — ${o.total}`;
}

function DeliveryDialog({
  presetOrderId,
  onClose,
  onDone,
}: {
  presetOrderId?: string;
  onClose: () => void;
  onDone: (deliveryId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [orderId, setOrderId] = useState(presetOrderId ?? "");
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const openOrders = useQuery({
    queryKey: ["sales-open-orders", companyId],
    queryFn: () => api.listSalesOrders({ company_id: companyId!, per_page: 100 }),
    enabled: !!companyId,
    retry: false,
  });
  const deliverable = (openOrders.data?.data ?? []).filter((o) =>
    DELIVERABLE_STATUSES.includes(o.status as SalesOrder["status"]),
  );

  const order = useQuery({
    queryKey: ["sales-order", orderId],
    queryFn: () => api.getSalesOrder(orderId),
    enabled: !!orderId,
    retry: false,
  });

  const orderLines = order.data?.lines ?? [];
  const linesWithRemaining = orderLines
    .map((l) => ({ line: l, remaining: toNumber(l.quantity) - toNumber(l.delivered_quantity) }))
    .filter((x) => x.remaining > 0 && x.line.product_id);

  useEffect(() => {
    // Default each deliverable line to its full remaining quantity.
    const next: Record<string, string> = {};
    for (const { line, remaining } of linesWithRemaining) {
      next[line.id] = String(remaining);
    }
    setQtys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.data?.id]);

  const submit = async () => {
    if (!companyId || !order.data) return;
    const picked = linesWithRemaining
      .map(({ line, remaining }) => ({ line, qty: (qtys[line.id] ?? "").trim(), remaining }))
      .filter((x) => x.qty !== "");
    if (picked.length === 0) {
      toast.error(t("sales.needLinesError"));
      return;
    }
    for (const x of picked) {
      if (!isPositiveDecimal(x.qty) || toNumber(x.qty) > x.remaining) {
        toast.error(t("inventory.invalidPositive"));
        return;
      }
    }
    setBusy(true);
    try {
      const res = await api.createDelivery(
        {
          company_id: companyId,
          sales_order_id: order.data.id,
          warehouse_id: warehouseId || undefined,
          delivery_date: deliveryDate,
          notes: notes.trim() || undefined,
          lines: picked.map((x) => ({ sales_order_line_id: x.line.id, quantity: x.qty })),
        },
        randomKey(),
      );
      toast.success(t("sales.deliveryCreated"));
      onDone(res.delivery.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.newDelivery")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t("sales.salesOrder")}>
          <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{t("sales.selectSalesOrder")}</option>
            {deliverable.map((o) => (
              <option key={o.id} value={o.id} dir="ltr">
                {orderLabel(o)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("sales.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll />
        </Field>
        <Field label={t("sales.deliveryDate")}>
          <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </Field>
      </div>

      {orderId && (
        <div className="mt-4">
          {order.isLoading ? (
            <LoadingBlock />
          ) : order.isError || !order.data ? (
            <ErrorState message={t("common.error")} onRetry={() => order.refetch()} />
          ) : linesWithRemaining.length === 0 ? (
            <EmptyState title={t("sales.noOrders")} />
          ) : (
            <Table head={[t("inventory.product"), t("sales.quantity"), t("sales.remainingQuantity"), t("sales.quantity")]}>
              {linesWithRemaining.map(({ line, remaining }) => (
                <tr key={line.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {line.product ? salesProductLabel(line.product, i18n.language) : line.description}
                    <span className="block text-xs font-normal text-ink-soft" dir="auto">
                      {line.description}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={line.quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={String(remaining)} />
                  </td>
                  <td className="px-4 py-3">
                    <TextInput
                      dir="ltr"
                      inputMode="decimal"
                      className="tnum !w-32"
                      value={qtys[line.id] ?? ""}
                      onChange={(e) => setQtys((q) => ({ ...q, [line.id]: e.target.value }))}
                      placeholder="0.0000"
                    />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      <div className="mt-4">
        <Field label={t("sales.notes")}>
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" maxLength={2000} />
      </Field>
        </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !orderId}>
          {busy ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

export function DeliveriesPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.deliveryCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-deliveries", companyId, status, page],
    queryFn: () =>
      api.listDeliveries({
        company_id: companyId!,
        status: (status || undefined) as Delivery["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <SalesGuard
      perm={PERMS.deliveryView}
      title={t("sales.deliveriesTitle")}
      subtitle={t("sales.deliveriesSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("sales.newDelivery")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "posted", "partially_invoiced", "invoiced"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(DELIVERY_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("sales.noDeliveries")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.salesOrder"),
                t("sales.deliveryDate"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((d) => (
                <tr key={d.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {d.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {d.sales_order?.number ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(d.delivery_date, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={deliveryStatusTone(d.status)}>{t(DELIVERY_STATUS_LABEL_KEYS[d.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/deliveries/${d.id}`}>
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
        <DeliveryDialog
          onClose={() => setOpen(false)}
          onDone={(deliveryId) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-deliveries"] });
            navigate(`/sales/deliveries/${deliveryId}`);
          }}
        />
      )}
    </SalesGuard>
  );
}

export function DeliveryDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const warehouses = useWarehouses();

  const detail = useQuery({
    queryKey: ["sales-delivery", id],
    queryFn: () => api.getDelivery(id!),
    enabled: !!id,
    retry: false,
  });

  const d = detail.data;
  const canPost = hasPermission(PERMS.deliveryPost);
  const warehouseName = (wid: string) => {
    const w = (warehouses.data ?? []).find((x) => x.id === wid);
    return w ? warehouseLabel(w, i18n.language) : wid.slice(0, 8);
  };

  const post = async () => {
    if (!d) return;
    setBusy(true);
    try {
      await api.postDelivery(d.id);
      toast.success(t("sales.deliveryPosted"));
      await qc.invalidateQueries({ queryKey: ["sales-delivery", d.id] });
      await qc.invalidateQueries({ queryKey: ["sales-deliveries"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/deliveries")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !d ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {d.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("sales.salesOrder")}:{" "}
                  <Link to={`/sales/orders/${d.sales_order_id}`} className="font-mono text-accent-deep hover:underline" dir="ltr">
                    {d.sales_order?.number ?? d.sales_order_id.slice(0, 8)}
                  </Link>
                  {" · "}
                  {t("sales.warehouse")}: <span dir="auto">{warehouseName(d.warehouse_id)}</span>
                  {" · "}
                  {t("sales.deliveryDate")}: {formatDate(d.delivery_date, i18n.language)}
                </p>
              </div>
              <Badge tone={deliveryStatusTone(d.status)}>{t(DELIVERY_STATUS_LABEL_KEYS[d.status])}</Badge>
            </div>
            {d.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {d.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {d.status === "draft" && (
                <Button size="sm" disabled={busy || !canPost} title={canPost ? undefined : t("common.noPermission")} onClick={() => void post()}>
                  {t("sales.post")}
                </Button>
              )}
            </div>
          </Card>
          <Card>
            <Table head={[t("inventory.product"), t("sales.description"), t("sales.quantity")]}>
              {d.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.product ? salesProductLabel(l.product, i18n.language) : l.product_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {l.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={l.quantity} />
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
