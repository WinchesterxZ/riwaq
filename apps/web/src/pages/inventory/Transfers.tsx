import type { Product, StockTransfer } from "@atlas-erp/api-client";
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
} from "../../components/ui";
import {
  PERMS,
  Qty,
  TRANSFER_STATUS_LABEL_KEYS,
  formatDate,
  isPositiveDecimal,
  transferStatusTone,
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
  quantity: string;
}

function TransferDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, product: null, quantity: "" }]);
  const [busy, setBusy] = useState(false);

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!companyId) return;
    if (!fromId || !toId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    if (fromId === toId) {
      toast.error(t("inventory.sameWarehouseError"));
      return;
    }
    const valid = lines.filter((l) => l.product && isPositiveDecimal(l.quantity));
    if (valid.length === 0) {
      toast.error(t("inventory.needLinesError"));
      return;
    }
    setBusy(true);
    try {
      await api.createTransfer(
        {
          company_id: companyId,
          from_warehouse_id: fromId,
          to_warehouse_id: toId,
          lines: valid.map((l) => ({
            product_id: l.product!.id,
            quantity: l.quantity.trim(),
          })),
        },
        randomKey(),
      );
      toast.success(t("inventory.transferCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("inventory.newTransfer")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("inventory.fromWarehouse")}>
          <WarehouseSelect value={fromId} onChange={setFromId} />
        </Field>
        <Field label={t("inventory.toWarehouse")}>
          <WarehouseSelect value={toId} onChange={setToId} />
        </Field>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t("inventory.lines")}</p>
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-1 gap-3 rounded-xl border border-line-soft p-3 sm:grid-cols-[1fr_140px_auto]">
              <ProductSearch
                value={l.product}
                onSelect={(p) => setLine(l.key, { product: p })}
                excludeIds={lines.filter((x) => x.key !== l.key && x.product).map((x) => x.product!.id)}
              />
              <DecimalField label={t("inventory.quantity")} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} />
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
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null, quantity: "" }])}
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

function useTransferActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, action: "dispatch" | "receive" | "cancel") => {
    setBusyId(id);
    try {
      if (action === "dispatch") {
        await api.dispatchTransfer(id);
        toast.success(t("inventory.transferDispatched"));
      } else if (action === "receive") {
        await api.receiveTransfer(id);
        toast.success(t("inventory.transferReceived"));
      } else {
        await api.cancelTransfer(id);
        toast.success(t("inventory.transferCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["inventory-transfers"] });
      await qc.invalidateQueries({ queryKey: ["inventory-transfer"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  };
  return { run, busyId };
}

export function TransferRowActions({ transfer }: { transfer: StockTransfer }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { run, busyId } = useTransferActions();
  const busy = busyId === transfer.id;
  const canSubmit = hasPermission(PERMS.stockTransferSubmit);
  const canPost = hasPermission(PERMS.stockTransferPost);

  return (
    <div className="flex gap-2">
      <Link to={`/inventory/transfers/${transfer.id}`}>
        <Button variant="secondary" size="sm">
          {t("inventory.transferDetail")}
        </Button>
      </Link>
      {transfer.status === "draft" && (
        <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void run(transfer.id, "dispatch")}>
          {t("inventory.dispatch")}
        </Button>
      )}
      {transfer.status === "dispatched" && (
        <Button size="sm" disabled={busy || !canPost} title={canPost ? undefined : t("common.noPermission")} onClick={() => void run(transfer.id, "receive")}>
          {t("inventory.receiveAction")}
        </Button>
      )}
      {(transfer.status === "draft" || transfer.status === "dispatched") && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(transfer.id, "cancel")}>
          <span className="text-danger">{t("common.cancel")}</span>
        </Button>
      )}
    </div>
  );
}

export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.stockTransferCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["inventory-transfers", companyId, status, page],
    queryFn: () =>
      api.listTransfers({
        company_id: companyId!,
        status: (status || undefined) as StockTransfer["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <InventoryGuard
      perm={PERMS.stockTransferView}
      title={t("inventory.transfersTitle")}
      subtitle={t("inventory.transfersSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("inventory.newTransfer")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "dispatched", "received", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(TRANSFER_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("inventory.noTransfers")} />
        ) : (
          <>
            <Table
              head={[
                t("inventory.number"),
                t("inventory.fromWarehouse"),
                t("inventory.toWarehouse"),
                t("inventory.lines"),
                t("common.status"),
                t("common.actions"),
              ]}
            >
              {(list.data?.data ?? []).map((tr) => (
                <tr key={tr.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {tr.number}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {tr.from_warehouse_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {tr.to_warehouse_id.slice(0, 8)}…
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{tr.lines.length}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={transferStatusTone(tr.status)}>{t(TRANSFER_STATUS_LABEL_KEYS[tr.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <TransferRowActions transfer={tr} />
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
        <TransferDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["inventory-transfers"] });
          }}
        />
      )}
    </InventoryGuard>
  );
}

export function TransferDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { run, busyId } = useTransferActions();

  const detail = useQuery({
    queryKey: ["inventory-transfer", id],
    queryFn: () => api.getTransfer(id!),
    enabled: !!id,
    retry: false,
  });

  const tr = detail.data?.transfer;
  const busy = busyId === id;

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/inventory/transfers")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !tr ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {tr.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatDate(tr.created_at, i18n.language)}
                </p>
              </div>
              <Badge tone={transferStatusTone(tr.status)}>{t(TRANSFER_STATUS_LABEL_KEYS[tr.status])}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-ink-soft">{t("inventory.fromWarehouse")}</p>
                <p className="font-mono text-sm text-ink" dir="ltr">
                  {tr.from_warehouse_id}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-soft">{t("inventory.toWarehouse")}</p>
                <p className="font-mono text-sm text-ink" dir="ltr">
                  {tr.to_warehouse_id}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {tr.status === "draft" && (
                <Button
                  size="sm"
                  disabled={busy || !hasPermission(PERMS.stockTransferSubmit)}
                  onClick={() => void run(tr.id, "dispatch")}
                >
                  {t("inventory.dispatch")}
                </Button>
              )}
              {tr.status === "dispatched" && (
                <Button
                  size="sm"
                  disabled={busy || !hasPermission(PERMS.stockTransferPost)}
                  onClick={() => void run(tr.id, "receive")}
                >
                  {t("inventory.receiveAction")}
                </Button>
              )}
              {(tr.status === "draft" || tr.status === "dispatched") && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(tr.id, "cancel")}>
                  <span className="text-danger">{t("common.cancel")}</span>
                </Button>
              )}
            </div>
          </Card>
          <Card>
            <Table head={[t("inventory.product"), t("inventory.quantity")]}>
              {tr.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.product ? productLabel(l.product, i18n.language) : l.product_id}
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
