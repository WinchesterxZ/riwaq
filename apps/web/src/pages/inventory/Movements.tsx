import type { Product } from "@atlas-erp/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
  MOVEMENT_TYPE_LABEL_KEYS,
  PERMS,
  Qty,
  formatDate,
  isPositiveDecimal,
  isValidDecimal,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import {
  DecimalField,
  InventoryGuard,
  ProductSearch,
  WarehouseSelect,
} from "./shared";

const PER_PAGE = 15;
const MOVEMENT_TYPES = ["receive", "issue", "transfer_in", "transfer_out", "adjustment", "return", "opening"] as const;
const POSTABLE_KINDS = ["receive", "issue", "return", "opening"] as const;

function randomKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ---------- record movement dialog ---------- */

function MovementDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<(typeof POSTABLE_KINDS)[number]>("receive");
  const [warehouseId, setWarehouseId] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    if (!product) {
      toast.error(t("inventory.productRequired"));
      return;
    }
    if (!isPositiveDecimal(quantity)) {
      toast.error(t("inventory.invalidPositive"));
      return;
    }
    if (!isValidDecimal(unitCost)) {
      toast.error(t("inventory.invalidDecimal"));
      return;
    }
    setBusy(true);
    try {
      const res =
        kind === "issue"
          ? await api.issueStock(
              {
                company_id: companyId,
                warehouse_id: warehouseId,
                product_id: product.id,
                movement_type: "receive",
                quantity: quantity.trim(),
                unit_cost: unitCost.trim(),
                movement_date: date || undefined,
              },
              randomKey(),
            )
          : await api.postStockMovement(
              kind,
              {
                company_id: companyId,
                warehouse_id: warehouseId,
                product_id: product.id,
                movement_type: "receive",
                quantity: quantity.trim(),
                unit_cost: unitCost.trim(),
                movement_date: date || undefined,
              },
              randomKey(),
            );
      toast.success(
        res.journal_id
          ? `${t("inventory.movementRecorded")} — ${t("inventory.journalRef")}: ${res.journal_id.slice(0, 8)}`
          : t("inventory.movementRecorded"),
      );
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("inventory.newMovement")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("inventory.movementKind")}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {POSTABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`inventory.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("inventory.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("inventory.product")}>
            <ProductSearch value={product} onSelect={setProduct} />
          </Field>
        </div>
        <DecimalField label={t("inventory.quantity")} value={quantity} onChange={setQuantity} />
        <DecimalField label={t("inventory.unitCost")} value={unitCost} onChange={setUnitCost} />
        <Field label={t("inventory.movementDate")}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? t("common.loading") : t("inventory.postMovement")}
        </Button>
      </div>
    </Dialog>
  );
}

/* ---------- reservation dialog ---------- */

function ReservationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!companyId) return;
    if (!warehouseId) {
      toast.error(t("inventory.warehouseRequired"));
      return;
    }
    if (!product) {
      toast.error(t("inventory.productRequired"));
      return;
    }
    if (!isPositiveDecimal(quantity)) {
      toast.error(t("inventory.invalidPositive"));
      return;
    }
    setBusy(true);
    try {
      await api.createReservation(
        {
          company_id: companyId,
          warehouse_id: warehouseId,
          product_id: product.id,
          quantity: quantity.trim(),
        },
        randomKey(),
      );
      toast.success(t("inventory.reservationCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("inventory.newReservation")} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <Field label={t("inventory.warehouse")}>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
        </Field>
        <Field label={t("inventory.product")}>
          <ProductSearch value={product} onSelect={setProduct} />
        </Field>
        <DecimalField label={t("inventory.quantity")} value={quantity} onChange={setQuantity} />
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

/* ---------- page ---------- */

export function MovementsPage() {
  const { t, i18n } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const lang = i18n.language;

  const canCreateMovement = hasPermission(PERMS.stockMovementCreate);
  const canCreateReservation = hasPermission(PERMS.stockReservationCreate);
  const canViewReservations = hasPermission(PERMS.stockReservationView);

  const [tab, setTab] = useState<"movements" | "reservations">("movements");
  const [type, setType] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState<Product | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [movementOpen, setMovementOpen] = useState(false);
  const [reservationOpen, setReservationOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [type, warehouseId, productId, from, to, companyId, tab]);

  const movements = useQuery({
    queryKey: ["inventory-movements", companyId, type, warehouseId, productId, from, to, page],
    queryFn: () =>
      api.listMovements({
        company_id: companyId!,
        movement_type: (type || undefined) as (typeof MOVEMENT_TYPES)[number] | undefined,
        warehouse_id: warehouseId || undefined,
        product_id: productId || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && tab === "movements",
    retry: false,
  });

  const reservations = useQuery({
    queryKey: ["inventory-reservations", companyId, warehouseId, page],
    queryFn: () =>
      api.listReservations({
        company_id: companyId!,
        warehouse_id: warehouseId || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && tab === "reservations" && canViewReservations,
    retry: false,
  });

  const doRelease = async () => {
    if (!releaseTarget) return;
    setBusy(true);
    try {
      await api.releaseReservation(releaseTarget);
      toast.success(t("inventory.reservationReleased"));
      setReleaseTarget(null);
      await qc.invalidateQueries({ queryKey: ["inventory-reservations"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    setMovementOpen(false);
    setReservationOpen(false);
    void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
    void qc.invalidateQueries({ queryKey: ["inventory-reservations"] });
    void qc.invalidateQueries({ queryKey: ["inventory-balances"] });
  };

  return (
    <InventoryGuard
      perm={PERMS.stockMovementView}
      title={t("inventory.movementsTitle")}
      subtitle={t("inventory.movementsSubtitle")}
      actions={
        tab === "movements" ? (
          <Button
            size="sm"
            disabled={!canCreateMovement}
            title={canCreateMovement ? undefined : t("common.noPermission")}
            onClick={() => setMovementOpen(true)}
          >
            {t("inventory.newMovement")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canCreateReservation}
            title={canCreateReservation ? undefined : t("common.noPermission")}
            onClick={() => setReservationOpen(true)}
          >
            {t("inventory.newReservation")}
          </Button>
        )
      }
    >
      <div className="mb-4 flex gap-2">
        {(["movements", "reservations"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === tb ? "bg-accent-soft text-accent-deep" : "text-ink-soft hover:bg-surface-soft"
            }`}
          >
            {t(tb === "movements" ? "inventory.movementsTab" : "inventory.reservationsTab")}
          </button>
        ))}
      </div>

      {tab === "movements" ? (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label={t("inventory.type")}>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{t("inventory.allTypes")}</option>
                  {MOVEMENT_TYPES.map((mt) => (
                    <option key={mt} value={mt}>
                      {t(MOVEMENT_TYPE_LABEL_KEYS[mt])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inventory.warehouse")}>
                <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll />
              </Field>
              <div className="lg:col-span-2">
                <Field label={t("inventory.productSearch")}>
                  <ProductSearch
                    value={productSearch}
                    onSelect={(p) => {
                      setProductSearch(p);
                      setProductId(p?.id ?? "");
                    }}
                  />
                </Field>
              </div>
              <Field label={t("inventory.fromDate")}>
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
              </Field>
              <Field label={t("inventory.toDate")}>
                <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
              </Field>
            </div>
          </Card>

          <Card>
            {movements.isLoading ? (
              <LoadingBlock />
            ) : movements.isError ? (
              <ErrorState message={errorMessage(movements.error, t)} onRetry={() => movements.refetch()} />
            ) : (movements.data?.data ?? []).length === 0 ? (
              <EmptyState title={t("inventory.noMovementsFiltered")} />
            ) : (
              <>
                <Table
                  head={[
                    t("common.date"),
                    t("inventory.type"),
                    t("inventory.product"),
                    t("inventory.warehouse"),
                    t("inventory.quantity"),
                    t("inventory.unitCost"),
                    t("inventory.totalCost"),
                  ]}
                >
                  {(movements.data?.data ?? []).map((m) => (
                    <tr key={m.id} className="hover:bg-surface-soft/50">
                      <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                        {formatDate(m.movement_date, lang)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone="neutral">{t(MOVEMENT_TYPE_LABEL_KEYS[m.movement_type])}</Badge>
                      </td>
                      <td className="max-w-52 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                        {m.product ? `${m.product.sku} — ${lang === "ar" ? m.product.nameAr : m.product.nameEn}` : m.product_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-soft" dir="auto">
                        {m.warehouse ? (lang === "ar" ? m.warehouse.nameAr : m.warehouse.name) : m.warehouse_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Qty value={m.quantity} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                        <Qty value={m.unit_cost} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                        <Qty value={m.total_cost} />
                      </td>
                    </tr>
                  ))}
                </Table>
                {movements.data?.meta && (
                  <Pagination
                    page={movements.data.meta.page}
                    totalPages={movements.data.meta.total_pages}
                    total={movements.data.meta.total}
                    onPage={setPage}
                  />
                )}
              </>
            )}
          </Card>
        </>
      ) : (
        <Card>
          {!canViewReservations ? (
            <EmptyState title={t("common.noPermission")} />
          ) : reservations.isLoading ? (
            <LoadingBlock />
          ) : reservations.isError ? (
            <ErrorState message={errorMessage(reservations.error, t)} onRetry={() => reservations.refetch()} />
          ) : (reservations.data?.data ?? []).length === 0 ? (
            <EmptyState title={t("inventory.noReservations")} />
          ) : (
            <>
              <Table
                head={[
                  t("common.date"),
                  t("inventory.product"),
                  t("inventory.warehouse"),
                  t("inventory.quantity"),
                  t("common.status"),
                  t("common.actions"),
                ]}
              >
                {(reservations.data?.data ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-surface-soft/50">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                      {formatDate(r.created_at, lang)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                      {r.product_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink-soft" dir="ltr">
                      {r.warehouse_id.slice(0, 8)}…
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Qty value={r.quantity} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={r.status === "active" ? "accent" : "neutral"}>{r.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.status === "active" && (
                        <Button variant="ghost" size="sm" onClick={() => setReleaseTarget(r.id)}>
                          <span className="text-danger">{t("inventory.release")}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              {reservations.data?.meta && (
                <Pagination
                  page={reservations.data.meta.page}
                  totalPages={reservations.data.meta.total_pages}
                  total={reservations.data.meta.total}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </Card>
      )}

      {movementOpen && <MovementDialog onClose={() => setMovementOpen(false)} onDone={refresh} />}
      {reservationOpen && <ReservationDialog onClose={() => setReservationOpen(false)} onDone={refresh} />}

      <ConfirmDialog
        open={releaseTarget !== null}
        title={t("inventory.release")}
        text={t("common.confirm")}
        confirmLabel={t("inventory.release")}
        loading={busy}
        onConfirm={() => void doRelease()}
        onClose={() => setReleaseTarget(null)}
      />
    </InventoryGuard>
  );
}
