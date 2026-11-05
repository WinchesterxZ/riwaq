import type { Customer, SalesOrder } from "@atlas-erp/api-client";
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
  Qty,
  SALES_ORDER_STATUS_LABEL_KEYS,
  salesOrderStatusTone,
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

function OrderDialog({ onClose, onDone }: { onClose: () => void; onDone: (orderId: string) => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    if (!customer) {
      toast.error(t("sales.customerRequired"));
      return;
    }
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    const valid = lines.filter((l) => l.product && isDraftLineValid(l));
    if (valid.length === 0) {
      toast.error(t("sales.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.createSalesOrder(
        {
          company_id: companyId,
          customer_id: customer.id,
          warehouse_id: warehouseId,
          notes: notes.trim() || undefined,
          lines: valid.map((l) => ({
            ...draftLineToInput(l),
            product_id: l.product!.id,
            description:
              draftLineToInput(l).description ||
              (l.product!.name_ar || l.product!.name_en),
          })),
        },
        randomKey(),
      );
      toast.success(t("sales.orderCreated"));
      onDone(res.sales_order.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("sales.newOrder")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("sales.customer")}>
          <CustomerSearch value={customer} onSelect={setCustomer} />
        </Field>
        <Field label={t("sales.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
      </div>
      <div className="mt-4">
        <PricedLineEditor lines={lines} setLines={setLines} requireProduct autoDescription />
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

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.salesOrderCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["sales-orders", companyId, status, page],
    queryFn: () =>
      api.listSalesOrders({
        company_id: companyId!,
        status: (status || undefined) as SalesOrder["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <SalesGuard
      perm={PERMS.salesOrderView}
      title={t("sales.ordersTitle")}
      subtitle={t("sales.ordersSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("sales.newOrder")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "confirmed", "partially_delivered", "delivered", "invoiced", "closed", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(SALES_ORDER_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("sales.noOrders")} />
        ) : (
          <>
            <Table
              head={[
                t("sales.number"),
                t("sales.customer"),
                t("sales.grandTotal"),
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
                    {salesCustomerName(o.customer, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={o.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={salesOrderStatusTone(o.status)}>{t(SALES_ORDER_STATUS_LABEL_KEYS[o.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/sales/orders/${o.id}`}>
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
        <OrderDialog
          onClose={() => setOpen(false)}
          onDone={(orderId) => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["sales-orders"] });
            navigate(`/sales/orders/${orderId}`);
          }}
        />
      )}
    </SalesGuard>
  );
}

function useOrderActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async (id: string, action: "confirm" | "cancel") => {
    setBusy(true);
    try {
      if (action === "confirm") {
        await api.confirmSalesOrder(id);
        toast.success(t("sales.orderConfirmed"));
      } else {
        await api.cancelSalesOrder(id);
        toast.success(t("sales.orderCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["sales-order", id] });
      await qc.invalidateQueries({ queryKey: ["sales-orders"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function OrderDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { run, busy } = useOrderActions();

  const detail = useQuery({
    queryKey: ["sales-order", id],
    queryFn: () => api.getSalesOrder(id!),
    enabled: !!id,
    retry: false,
  });

  const o = detail.data;
  const canSubmit = hasPermission(PERMS.salesOrderSubmit);
  const canEdit = hasPermission(PERMS.salesOrderEdit);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/sales/orders")}>
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
                <p className="mt-1 text-sm text-ink-soft" dir="auto">
                  {salesCustomerName(o.customer, i18n.language)}
                  {o.warehouse && (
                    <>
                      {" · "}
                      {t("sales.warehouse")}: {i18n.language === "ar" ? o.warehouse.nameAr || o.warehouse.name : o.warehouse.name}
                    </>
                  )}
                </p>
              </div>
              <Badge tone={salesOrderStatusTone(o.status)}>{t(SALES_ORDER_STATUS_LABEL_KEYS[o.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("sales.subtotal")}: <Amount value={o.subtotal} />
              </span>
              <span>
                {t("sales.taxTotal")}: <Amount value={o.tax_total} />
              </span>
              <span className="font-semibold">
                {t("sales.grandTotal")}: <Amount value={o.total} />
              </span>
            </div>
            {o.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {o.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {o.status === "draft" && (
                <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void run(o.id, "confirm")}>
                  {t("sales.confirm")}
                </Button>
              )}
              {(o.status === "draft" || o.status === "confirmed") && (
                <Button variant="ghost" size="sm" disabled={busy || !canEdit} title={canEdit ? undefined : t("common.noPermission")} onClick={() => void run(o.id, "cancel")}>
                  <span className="text-danger">{t("common.cancel")}</span>
                </Button>
              )}
            </div>
          </Card>
          <Card>
            <Table
              head={[
                t("sales.description"),
                t("inventory.product"),
                t("sales.quantity"),
                t("sales.deliveredQuantity"),
                t("sales.invoicedQuantity"),
                t("sales.unitPrice"),
                t("sales.lineTotal"),
              ]}
            >
              {o.lines.map((l) => (
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
                    <Qty value={l.delivered_quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Qty value={l.invoiced_quantity} />
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={l.unit_price} />
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
