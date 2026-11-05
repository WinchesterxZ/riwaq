import type { Product, StockAdjustment } from "@atlas-erp/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  ADJUSTMENT_STATUS_LABEL_KEYS,
  PERMS,
  Qty,
  adjustmentStatusTone,
  formatDate,
  isValidDecimal,
  isValidSignedDecimal,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { DecimalField, InventoryGuard, ProductSearch, WarehouseSelect, productLabel } from "./shared";

const PER_PAGE = 15;

function randomKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface DraftLine {
  key: number;
  product: Product | null;
  quantityDelta: string;
  unitCost: string;
}

function AdjustmentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, product: null, quantityDelta: "", unitCost: "" }]);
  const [busy, setBusy] = useState(false);

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!companyId) return;
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    const valid = lines.filter((l) => l.product && isValidSignedDecimal(l.quantityDelta));
    if (valid.length === 0) {
      toast.error(t("inventory.deltaSignError"));
      return;
    }
    for (const l of valid) {
      const trimmed = l.quantityDelta.trim();
      if (/^[+-]?0+(\.0{1,4})?$/.test(trimmed)) {
        toast.error(t("inventory.deltaSignError"));
        return;
      }
      if (l.unitCost.trim() !== "" && !isValidDecimal(l.unitCost)) {
        toast.error(t("inventory.invalidDecimal"));
        return;
      }
    }
    setBusy(true);
    try {
      await api.createAdjustment(
        {
          company_id: companyId,
          warehouse_id: warehouseId,
          reason: reason.trim() || undefined,
          lines: valid.map((l) => ({
            product_id: l.product!.id,
            quantity_delta: l.quantityDelta.trim(),
            unit_cost: l.unitCost.trim() || undefined,
          })),
        },
        randomKey(),
      );
      toast.success(t("inventory.adjustmentCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("inventory.newAdjustment")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("inventory.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
        <Field label={t("inventory.reason")}>
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("inventory.reasonPlaceholder")}
          />
        </Field>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t("inventory.lines")}</p>
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-1 gap-3 rounded-xl border border-line-soft p-3 sm:grid-cols-[1fr_150px_130px_auto]">
              <ProductSearch
                value={l.product}
                onSelect={(p) => setLine(l.key, { product: p })}
                excludeIds={lines.filter((x) => x.key !== l.key && x.product).map((x) => x.product!.id)}
              />
              <DecimalField
                signed
                label={t("inventory.quantityDelta")}
                value={l.quantityDelta}
                onChange={(v) => setLine(l.key, { quantityDelta: v })}
              />
              <DecimalField
                label={t("inventory.unitCostOptional")}
                value={l.unitCost}
                onChange={(v) => setLine(l.key, { unitCost: v })}
              />
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <span className="text-danger">{t("common.remove")}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null, quantityDelta: "", unitCost: "" }])}
        >
          {t("inventory.addLine")}
        </Button>
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

function useAdjustmentActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, action: "submit" | "approve" | "post" | "cancel") => {
    setBusyId(id);
    try {
      if (action === "submit") {
        await api.submitAdjustment(id);
        toast.success(t("inventory.adjustmentSubmitted"));
      } else if (action === "approve") {
        await api.approveAdjustment(id);
        toast.success(t("inventory.adjustmentApproved"));
      } else if (action === "post") {
        await api.postAdjustment(id);
        toast.success(t("inventory.adjustmentPosted"));
      } else {
        await api.cancelAdjustment(id);
        toast.success(t("inventory.adjustmentCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["inventory-adjustments"] });
      await qc.invalidateQueries({ queryKey: ["inventory-adjustment"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  };
  return { run, busyId };
}

export function AdjustmentsPage() {
  const { t } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.stockAdjustmentCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["inventory-adjustments", companyId, status, page],
    queryFn: () =>
      api.listAdjustments({
        company_id: companyId!,
        status: (status || undefined) as StockAdjustment["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <InventoryGuard
      perm={PERMS.stockAdjustmentView}
      title={t("inventory.adjustmentsTitle")}
      subtitle={t("inventory.adjustmentsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("inventory.newAdjustment")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "submitted", "approved", "posted", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(ADJUSTMENT_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("inventory.noAdjustments")} />
        ) : (
          <>
            <Table
              head={[
                t("inventory.number"),
                t("inventory.warehouse"),
                t("inventory.lines"),
                t("common.status"),
                t("common.actions"),
              ]}
            >
              {(list.data?.data ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {a.number}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {a.warehouse_id.slice(0, 8)}…
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{a.lines.length}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={adjustmentStatusTone(a.status)}>{t(ADJUSTMENT_STATUS_LABEL_KEYS[a.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/inventory/adjustments/${a.id}`}>
                      <Button variant="secondary" size="sm">
                        {t("inventory.adjustmentDetail")}
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
        <AdjustmentDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["inventory-adjustments"] });
          }}
        />
      )}
    </InventoryGuard>
  );
}

export function AdjustmentDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { run, busyId } = useAdjustmentActions();

  const detail = useQuery({
    queryKey: ["inventory-adjustment", id],
    queryFn: () => api.getAdjustment(id!),
    enabled: !!id,
    retry: false,
  });

  const adj = detail.data?.adjustment;
  const busy = busyId === id;
  const canSubmit = hasPermission(PERMS.stockAdjustmentSubmit);
  const canApprove = hasPermission(PERMS.stockAdjustmentApprove);
  const canPost = hasPermission(PERMS.stockAdjustmentPost);

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/inventory/adjustments")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !adj ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {adj.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatDate(adj.created_at, i18n.language)}
                  {adj.reason ? ` — ${adj.reason}` : ""}
                </p>
              </div>
              <Badge tone={adjustmentStatusTone(adj.status)}>{t(ADJUSTMENT_STATUS_LABEL_KEYS[adj.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {adj.status === "draft" && (
                <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void run(adj.id, "submit")}>
                  {t("inventory.submit")}
                </Button>
              )}
              {adj.status === "submitted" && (
                <Button size="sm" disabled={busy || !canApprove} title={canApprove ? undefined : t("common.noPermission")} onClick={() => void run(adj.id, "approve")}>
                  {t("inventory.approve")}
                </Button>
              )}
              {adj.status === "approved" && (
                <Button size="sm" disabled={busy || !canPost} title={canPost ? undefined : t("common.noPermission")} onClick={() => void run(adj.id, "post")}>
                  {t("inventory.post")}
                </Button>
              )}
              {(adj.status === "draft" || adj.status === "submitted") && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(adj.id, "cancel")}>
                  <span className="text-danger">{t("common.cancel")}</span>
                </Button>
              )}
            </div>
          </Card>
          <Card>
            <Table head={[t("inventory.product"), t("inventory.quantityDelta"), t("inventory.unitCost")]}>
              {adj.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.product ? productLabel(l.product, i18n.language) : l.product_id}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    <Qty value={l.quantity_delta} />
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    <Qty value={l.unit_cost} />
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
