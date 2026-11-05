import type { Product, StockCount } from "@atlas-erp/api-client";
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
  COUNT_STATUS_LABEL_KEYS,
  PERMS,
  Qty,
  countStatusTone,
  formatDate,
  isValidDecimal,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { InventoryGuard, ProductSearch, WarehouseSelect, productLabel } from "./shared";

const PER_PAGE = 15;

function randomKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface DraftLine {
  key: number;
  product: Product | null;
}

function CountDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, product: null }]);
  const [busy, setBusy] = useState(false);

  const setLine = (key: number, p: Product | null) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, product: p } : l)));

  const submit = async () => {
    if (!companyId) return;
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    const products = lines.map((l) => l.product).filter((p): p is Product => !!p);
    if (products.length === 0) {
      toast.error(t("inventory.productRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.createCount(
        {
          company_id: companyId,
          warehouse_id: warehouseId,
          lines: products.map((p) => ({ product_id: p.id })),
        },
        randomKey(),
      );
      toast.success(t("inventory.countCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("inventory.newCount")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("inventory.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold text-ink">{t("inventory.lines")}</p>
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-1 gap-3 rounded-xl border border-line-soft p-3 sm:grid-cols-[1fr_auto]">
              <ProductSearch
                value={l.product}
                onSelect={(p) => setLine(l.key, p)}
                excludeIds={lines.filter((x) => x.key !== l.key && x.product).map((x) => x.product!.id)}
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
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), product: null }])}
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

export function CountsPage() {
  const { t } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const canCreate = hasPermission(PERMS.inventoryCountCreate);

  useEffect(() => {
    setPage(1);
  }, [status, companyId]);

  const list = useQuery({
    queryKey: ["inventory-counts", companyId, status, page],
    queryFn: () =>
      api.listCounts({
        company_id: companyId!,
        status: (status || undefined) as StockCount["status"] | undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId,
    retry: false,
  });

  return (
    <InventoryGuard
      perm={PERMS.inventoryCountView}
      title={t("inventory.countsTitle")}
      subtitle={t("inventory.countsSubtitle")}
      actions={
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("common.noPermission")}
          onClick={() => setOpen(true)}
        >
          {t("inventory.newCount")}
        </Button>
      }
    >
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["draft", "in_progress", "posted", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(COUNT_STATUS_LABEL_KEYS[s])}
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
          <EmptyState title={t("inventory.noCounts")} />
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
              {(list.data?.data ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {c.number}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                    {c.warehouse_id.slice(0, 8)}…
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{c.lines.length}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={countStatusTone(c.status)}>{t(COUNT_STATUS_LABEL_KEYS[c.status])}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link to={`/inventory/counts/${c.id}`}>
                      <Button variant="secondary" size="sm">
                        {t("inventory.countDetail")}
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
        <CountDialog
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["inventory-counts"] });
          }}
        />
      )}
    </InventoryGuard>
  );
}

export function CountDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["inventory-count", id],
    queryFn: () => api.getCount(id!),
    enabled: !!id,
    retry: false,
  });

  const count = detail.data?.count;
  const canSubmit = hasPermission(PERMS.inventoryCountSubmit);
  const canPost = hasPermission(PERMS.inventoryCountPost);

  const runAction = async (action: "start" | "save" | "post" | "cancel") => {
    if (!count) return;
    if (action === "save") {
      const lines = count.lines.map((l) => ({
        product_id: l.product_id,
        counted_qty: (edited[l.id] ?? l.counted_qty ?? l.system_qty).trim(),
      }));
      for (const l of lines) {
        if (!isValidDecimal(l.counted_qty)) {
          toast.error(t("inventory.invalidDecimal"));
          return;
        }
      }
      setBusy(true);
      try {
        await api.updateCountLines(count.id, lines);
        toast.success(t("inventory.countsSaved"));
        setEdited({});
        await qc.invalidateQueries({ queryKey: ["inventory-count"] });
      } catch (err) {
        toast.error(errorMessage(err, t));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      if (action === "start") {
        await api.startCount(count.id);
        toast.success(t("inventory.countStarted"));
      } else if (action === "post") {
        await api.postCount(count.id);
        toast.success(t("inventory.countPosted"));
      } else {
        await api.cancelCount(count.id);
        toast.success(t("inventory.countCancelled"));
      }
      await qc.invalidateQueries({ queryKey: ["inventory-count"] });
      await qc.invalidateQueries({ queryKey: ["inventory-counts"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={() => navigate("/inventory/counts")}>
          {t("common.back")}
        </Button>
      </div>
      {detail.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : detail.isError || !count ? (
        <Card>
          <ErrorState message={detail.isError ? errorMessage(detail.error, t) : t("common.error")} onRetry={() => detail.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-ink" dir="ltr">
                  {count.number}
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {formatDate(count.created_at, i18n.language)} —{" "}
                  <span className="font-mono" dir="ltr">
                    {count.warehouse_id.slice(0, 8)}…
                  </span>
                </p>
              </div>
              <Badge tone={countStatusTone(count.status)}>{t(COUNT_STATUS_LABEL_KEYS[count.status])}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {count.status === "draft" && (
                <Button size="sm" disabled={busy || !canSubmit} title={canSubmit ? undefined : t("common.noPermission")} onClick={() => void runAction("start")}>
                  {t("inventory.startCount")}
                </Button>
              )}
              {count.status === "in_progress" && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => void runAction("save")}>
                    {t("inventory.saveCounts")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || !canPost}
                    title={canPost ? undefined : t("common.noPermission")}
                    onClick={() => void runAction("post")}
                  >
                    {t("inventory.postCount")}
                  </Button>
                </>
              )}
              {(count.status === "draft" || count.status === "in_progress") && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void runAction("cancel")}>
                  <span className="text-danger">{t("common.cancel")}</span>
                </Button>
              )}
            </div>
          </Card>
          <Card>
            {count.status === "draft" && (
              <div className="border-b border-line-soft p-4">
                <EmptyState title={t("inventory.countNotStarted")} />
              </div>
            )}
            <Table
              head={[
                t("inventory.product"),
                t("inventory.systemQty"),
                t("inventory.countedQty"),
                t("inventory.variance"),
              ]}
            >
              {count.lines.map((l) => (
                <tr key={l.id} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-3 font-medium text-ink" dir="auto">
                    {l.product ? productLabel(l.product, i18n.language) : l.product_id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Qty value={l.system_qty} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {count.status === "in_progress" ? (
                      <TextInput
                        dir="ltr"
                        inputMode="decimal"
                        className="tnum !w-32"
                        value={edited[l.id] ?? l.counted_qty ?? ""}
                        placeholder={l.system_qty}
                        onChange={(e) => setEdited((m) => ({ ...m, [l.id]: e.target.value }))}
                      />
                    ) : (
                      <Qty value={l.counted_qty} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    <Qty value={l.variance} />
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
