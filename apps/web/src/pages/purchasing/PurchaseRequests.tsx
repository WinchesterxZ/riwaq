import type { PurchaseRequest, PurchaseRequestStatus, Supplier } from "@atlas-erp/api-client";
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
  formatDate,
  PERMS,
  PURCHASE_REQUEST_STATUS_LABEL_KEYS,
  purchaseRequestStatusTone,
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
  isDraftLineValid,
  PricedLineEditor,
  type DraftPricedLine,
} from "../sales/shared";
import { PermButton, PurchaseGuard, randomKey, SupplierSearch } from "./shared";

const PER_PAGE = 15;

const REQUEST_STATUSES: PurchaseRequestStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "ordered",
];

/** Lines also need a non-empty description for the purchasing backend. */
export function isPurchasingLineValid(l: DraftPricedLine): boolean {
  return isDraftLineValid(l) && l.description.trim().length > 0;
}

function PurchaseRequestDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftPricedLine[]>([blankPricedLine(1)]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    const valid = lines.filter(isPurchasingLineValid);
    if (valid.length === 0) {
      toast.error(t("purchasing.needLinesError"));
      return;
    }
    if (valid.length < lines.length) {
      toast.error(t("purchasing.descriptionRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.createPurchaseRequest(
        {
          company_id: companyId,
          notes: notes.trim() || undefined,
          lines: valid.map(draftLineToInput),
        },
        randomKey(),
      );
      toast.success(t("purchasing.requestCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.newRequest")} onClose={onClose} wide>
      <div className="mt-4">
        <PricedLineEditor
          lines={lines}
          setLines={setLines}
          autoDescription
          excludeProductTypes={["service"]}
        />
      </div>
      <p className="mt-2 text-xs text-ink-soft">{t("purchasing.linesRequireProductHint")}</p>
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

function ConvertDialog({
  request,
  onClose,
  onDone,
}: {
  request: PurchaseRequest;
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const missingProduct = request.lines.some((l) => !l.product_id);

  const submit = async () => {
    if (missingProduct) {
      toast.error(t("purchasing.cannotConvertNoProducts"));
      return;
    }
    if (!supplier) {
      toast.error(t("purchasing.supplierRequired"));
      return;
    }
    if (!warehouseId) {
      toast.error(t("purchasing.warehouseRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await api.convertPurchaseRequest(request.id, {
        supplier_id: supplier.id,
        warehouse_id: warehouseId,
      });
      toast.success(t("purchasing.requestConverted"));
      onDone(res.purchase_order.id);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("purchasing.convertToOrder")} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <Field label={t("purchasing.supplier")}>
          <SupplierSearch value={supplier} onSelect={setSupplier} />
        </Field>
        <Field label={t("purchasing.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
      </div>
      {missingProduct && (
        <p className="mt-3 text-sm text-warning">{t("purchasing.cannotConvertNoProducts")}</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy || missingProduct}>
          {busy ? t("common.loading") : t("purchasing.convertToOrder")}
        </Button>
      </div>
    </Dialog>
  );
}

export function PurchaseRequestsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.purchaseRequestCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["purchasing-requests", companyId, status, page],
    queryFn: () =>
      api.listPurchaseRequests({
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
      perm={PERMS.purchaseRequestView}
      title={t("purchasing.requestsTitle")}
      subtitle={t("purchasing.requestsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("purchasing.newRequest")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(PURCHASE_REQUEST_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("purchasing.noRequests")} />
        ) : (
          <>
            <Table
              head={[
                t("purchasing.number"),
                t("purchasing.grandTotal"),
                t("purchasing.createdOn"),
                t("common.status"),
                "",
              ]}
            >
              {(list.data?.data ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {r.number}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Amount value={r.total} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {formatDate(r.created_at, i18n.language)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={purchaseRequestStatusTone(r.status)}>
                      {t(PURCHASE_REQUEST_STATUS_LABEL_KEYS[r.status])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/purchasing/requests/${r.id}`}>
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
        <PurchaseRequestDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["purchasing-requests"] });
          }}
        />
      )}
    </PurchaseGuard>
  );
}

function useRequestActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const transition = async (id: string, action: "submit" | "approve" | "reject" | "cancel") => {
    setBusy(true);
    try {
      if (action === "submit") {
        await api.submitPurchaseRequest(id);
        toast.success(t("purchasing.requestSubmitted"));
      } else if (action === "approve") {
        await api.approvePurchaseRequest(id);
        toast.success(t("purchasing.requestApproved"));
      } else if (action === "reject") {
        await api.rejectPurchaseRequest(id);
        toast.success(t("purchasing.requestRejected"));
      } else {
        await api.cancelPurchaseRequest(id);
        toast.success(t("purchasing.requestCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["purchasing-request", id] });
      await qc.invalidateQueries({ queryKey: ["purchasing-requests"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return { transition, busy };
}

export function PurchaseRequestDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { transition, busy } = useRequestActions();
  const [convertOpen, setConvertOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["purchasing-request", id],
    queryFn: () => api.getPurchaseRequest(id!),
    enabled: !!id,
    retry: false,
  });

  const r = detail.data;

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/purchasing/requests")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !r ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {r.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {t("purchasing.createdOn")}: {formatDate(r.created_at, i18n.language)}
                </p>
              </div>
              <Badge tone={purchaseRequestStatusTone(r.status)}>
                {t(PURCHASE_REQUEST_STATUS_LABEL_KEYS[r.status])}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("purchasing.subtotal")}: <Amount value={r.subtotal} />
              </span>
              <span className="font-semibold">
                {t("purchasing.grandTotal")}: <Amount value={r.total} />
              </span>
            </div>
            {r.notes && (
              <p className="mt-3 text-sm text-ink-soft" dir="auto">
                {r.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {r.status === "draft" && (
                <PermButton perm={PERMS.purchaseRequestSubmit} size="sm" disabled={busy} onClick={() => void transition(r.id, "submit")}>
                  {t("purchasing.submit")}
                </PermButton>
              )}
              {r.status === "submitted" && (
                <>
                  <PermButton perm={PERMS.purchaseRequestApprove} size="sm" disabled={busy} onClick={() => void transition(r.id, "approve")}>
                    {t("purchasing.approve")}
                  </PermButton>
                  <PermButton perm={PERMS.purchaseRequestSubmit} size="sm" variant="ghost" disabled={busy} onClick={() => void transition(r.id, "reject")}>
                    <span className="text-danger">{t("purchasing.reject")}</span>
                  </PermButton>
                </>
              )}
              {(r.status === "draft" || r.status === "approved") && (
                <PermButton perm={PERMS.purchaseRequestEdit} size="sm" variant="secondary" disabled={busy} onClick={() => void transition(r.id, "cancel")}>
                  {t("purchasing.cancel")}
                </PermButton>
              )}
              {r.status === "approved" && (
                <PermButton perm={PERMS.purchaseOrderCreate} size="sm" disabled={busy} onClick={() => setConvertOpen(true)}>
                  {t("purchasing.convertToOrder")}
                </PermButton>
              )}
            </div>
          </Card>
          <Card>
            <Table
              head={[
                t("purchasing.description"),
                t("inventory.product"),
                t("purchasing.quantity"),
                t("purchasing.unitPrice"),
                t("purchasing.lineTotal"),
              ]}
            >
              {r.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.description}
                  </td>
                  <td className="px-4 py-3 text-ink-soft" dir="ltr">
                    {l.product_id ? (
                      <span className="font-mono text-xs" title={l.product_id}>
                        {l.product_id.slice(0, 8)}…
                      </span>
                    ) : (
                      "—"
                    )}
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
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      {convertOpen && r && (
        <ConvertDialog
          request={r}
          onClose={() => setConvertOpen(false)}
          onDone={(orderId) => {
            setConvertOpen(false);
            navigate(`/purchasing/orders/${orderId}`);
          }}
        />
      )}
    </>
  );
}
