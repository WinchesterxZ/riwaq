import type { PurchaseOrderStatus, Supplier } from "@atlas-erp/api-client";
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
  formatDate,
  PERMS,
  PURCHASE_ORDER_STATUS_LABEL_KEYS,
  purchaseOrderStatusTone,
  purchaseSupplierName,
  Qty,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { WarehouseSelect } from "../inventory/shared";
import {
  blankPricedLine,
  draftLineToInput,
  PricedLineEditor,
  type DraftPricedLine,
} from "../sales/shared";
import { isPurchasingLineValid } from "./PurchaseRequests";
import { PermButton, ProgressBar, PurchaseGuard, randomKey, SupplierSearch } from "./shared";

const PER_PAGE = 15;

const ORDER_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "partially_received",
  "received",
  "billed",
  "closed",
];

function PurchaseOrderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    if (!supplier) {
      toast.error(t("purchasing.supplierRequired"));
      return;
    }
    if (!warehouseId) {
      toast.error(t("purchasing.warehouseRequired"));
      return;
    }
    const valid = lines.filter(isPurchasingLineValid);
    if (valid.length === 0) {
      toast.error(t("purchasing.needLinesError"));
      return;
    }
    if (valid.length < lines.length) {
      toast.error(t("purchasing.descriptionRequired"));
      return;
    }
    if (valid.some((l) => !l.product)) {
      toast.error(t("inventory.productRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.createPurchaseOrder(
        {
          company_id: companyId,
          supplier_id: supplier.id,
          warehouse_id: warehouseId,
          notes: notes.trim() || undefined,
          lines: valid.map((l) => ({
            ...draftLineToInput(l),
            product_id: l.product!.id,
          })),
        },
        randomKey(),
      );
      toast.success(t("purchasing.orderCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.newOrder")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("purchasing.supplier")}>
          <SupplierSearch value={supplier} onSelect={setSupplier} />
        </Field>
        <Field label={t("purchasing.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
      </div>
      <div className="mt-4">
        <PricedLineEditor
          lines={lines}
          setLines={setLines}
          autoDescription
          requireProduct
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

export function PurchaseOrdersPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.purchaseOrderCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["purchasing-orders", companyId, status, page],
    queryFn: () =>
      api.listPurchaseOrders({
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
      perm={PERMS.purchaseOrderView}
      title={t("purchasing.ordersTitle")}
      subtitle={t("purchasing.ordersSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("purchasing.newOrder")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(PURCHASE_ORDER_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("purchasing.noOrders")} />
        ) : (
          <>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.supplier"),
                t("purchasing.grandTotal"),
                t("purchasing.createdOn"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((o) => (
                <tr key={o.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {o.number}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="auto">
                    {purchaseSupplierName(o.supplier, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={o.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(o.created_at, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={purchaseOrderStatusTone(o.status)}>
                      {t(PURCHASE_ORDER_STATUS_LABEL_KEYS[o.status])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/purchasing/orders/${o.id}`}>
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
        <PurchaseOrderDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["purchasing-orders"] });
          }}
        />
      )}
    </PurchaseGuard>
  );
}

function useOrderActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const transition = async (id: string, action: "submit" | "approve" | "reject" | "cancel") => {
    setBusy(true);
    try {
      if (action === "submit") {
        const res = await api.submitPurchaseOrder(id);
        toast.success(
          res.purchase_order.status === "approved"
            ? t("purchasing.orderAutoApproved")
            : t("purchasing.orderSubmitted"),
        );
      } else if (action === "approve") {
        await api.approvePurchaseOrder(id);
        toast.success(t("purchasing.orderApproved"));
      } else if (action === "reject") {
        await api.rejectPurchaseOrder(id);
        toast.success(t("purchasing.orderRejected"));
      } else {
        await api.cancelPurchaseOrder(id);
        toast.success(t("purchasing.orderCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["purchasing-order", id] });
      await qc.invalidateQueries({ queryKey: ["purchasing-orders"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { transition, busy };
}

function ratio(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (!y || y <= 0) return 0;
  return x / y;
}

export function PurchaseOrderDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { transition, busy } = useOrderActions();

  const detail = useQuery({
    queryKey: ["purchasing-order", id],
    queryFn: () => api.getPurchaseOrder(id!),
    enabled: !!id,
    retry: false,
  });

  const o = detail.data;
  const totalOrdered = (o?.lines ?? []).reduce((s, l) => s + Number(l.quantity), 0);
  const totalReceived = (o?.lines ?? []).reduce((s, l) => s + Number(l.received_quantity), 0);
  const totalBilled = (o?.lines ?? []).reduce((s, l) => s + Number(l.billed_quantity), 0);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/purchasing/orders")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !o ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {o.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.createdOn")}: {formatDate(o.created_at, i18n.language)}
                </p>
              </div>
              <Badge tone={purchaseOrderStatusTone(o.status)}>
                {t(PURCHASE_ORDER_STATUS_LABEL_KEYS[o.status])}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-soft">
              <span>
                {t("purchasing.subtotal")}: <Amount value={o.subtotal} />
              </span>
              <span>
                {t("purchasing.taxTotal")}: <Amount value={o.tax_total} />
              </span>
              <span className="font-semibold">
                {t("purchasing.grandTotal")}: <Amount value={o.total} />
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-ink-soft">
              <span className="flex items-center gap-2">
                {t("purchasing.receivedQuantity")}:
                <ProgressBar ratio={totalOrdered ? totalReceived / totalOrdered : 0} />
                <span dir="ltr" className="tnum">
                  {totalReceived.toFixed(2)} / {totalOrdered.toFixed(2)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {t("purchasing.billedQuantity")}:
                <ProgressBar ratio={totalOrdered ? totalBilled / totalOrdered : 0} />
                <span dir="ltr" className="tnum">
                  {totalBilled.toFixed(2)} / {totalOrdered.toFixed(2)}
                </span>
              </span>
            </div>
            {o.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {o.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <PdfButton fetch={() => api.purchaseOrderPdf(o.id)} filename={`po-${o.number}.pdf`} />
              {o.status === "draft" && (
                <PermButton perm={PERMS.purchaseOrderSubmit} size="sm" disabled={busy} onClick={() => void transition(o.id, "submit")}>
                  {t("purchasing.submit")}
                </PermButton>
              )}
              {o.status === "submitted" && (
                <>
                  <PermButton perm={PERMS.purchaseOrderApprove} size="sm" disabled={busy} onClick={() => void transition(o.id, "approve")}>
                    {t("purchasing.approve")}
                  </PermButton>
                  <PermButton perm={PERMS.purchaseOrderSubmit} size="sm" variant="ghost" disabled={busy} onClick={() => void transition(o.id, "reject")}>
                    <span className="text-danger">{t("purchasing.reject")}</span>
                  </PermButton>
                </>
              )}
              {(o.status === "draft" || o.status === "approved") && (
                <PermButton perm={PERMS.purchaseOrderEdit} size="sm" variant="secondary" disabled={busy} onClick={() => void transition(o.id, "cancel")}>
                  {t("purchasing.cancel")}
                </PermButton>
              )}
            </div>
          </Card>
          <Card>
            <Table
              head={[
                t("purchasing.description"),
                t("purchasing.quantity"),
                t("purchasing.unitPrice"),
                t("purchasing.lineTotal"),
                t("purchasing.receivedQuantity"),
                t("purchasing.billedQuantity"),
              ]}
            >
              {o.lines.map((l) => (
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
                    <div className="flex items-center gap-2">
                      <ProgressBar ratio={ratio(l.received_quantity, l.quantity)} />
                      <span dir="ltr" className="tnum text-sm text-ink-soft">
                        {l.received_quantity} / {l.quantity}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar ratio={ratio(l.billed_quantity, l.quantity)} />
                      <span dir="ltr" className="tnum text-sm text-ink-soft">
                        {l.billed_quantity} / {l.quantity}
                      </span>
                    </div>
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
