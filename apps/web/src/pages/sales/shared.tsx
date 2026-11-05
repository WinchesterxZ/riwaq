import { SearchPicker } from "../../components/SearchPicker";
import type { Customer, PricedLineInput, Product, SalesPartyRef } from "@atlas-erp/api-client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  TextInput,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { isPositiveDecimal, isValidDecimal, toNumber } from "../../lib/accounting";
import { productLabel } from "../inventory/shared";

/* ---------- misc ---------- */

export function randomKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ---------- permission + company guard ---------- */

export function SalesGuard({
  perm,
  title,
  subtitle,
  actions,
  children,
}: {
  perm: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const canView = hasPermission(perm);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {!canView ? (
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      ) : !companyId ? (
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      ) : (
        children
      )}
    </>
  );
}

/* ---------- customer ---------- */

export function customerLabel(
  c: { number: string; name_ar?: string | null; name_en?: string | null; nameAr?: string | null; nameEn?: string | null },
  lang: string,
): string {
  const ar = c.name_ar ?? c.nameAr ?? "";
  const en = c.name_en ?? c.nameEn ?? "";
  return `${c.number} — ${lang === "ar" ? ar : en}`;
}

export function CustomerSearch({
  value,
  onSelect,
  placeholder,
}: {
  value: Customer | null;
  onSelect: (c: Customer | null) => void;
  placeholder?: string;
}) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 300);
    return () => clearTimeout(id);
  }, [text]);


  const results = useQuery({
    queryKey: ["sales-customer-search", companyId, debounced],
    queryFn: () =>
      api.listCustomers({
        company_id: companyId!,
        search: debounced || undefined,
        status: "active",
        per_page: 10,
      }),
    enabled: !!companyId && open && !value,
    retry: false,
  });

  const options = results.data?.data ?? [];

  return <SearchPicker
    valueLabel={value ? customerLabel(value, i18n.language) : null}
    clear={() => { onSelect(null); setText(""); setOpen(false); }}
    text={text} setText={setText} open={open} setOpen={setOpen}
    loading={results.isFetching} error={results.isError} retry={() => void results.refetch()}
    placeholder={placeholder ?? t("sales.customerSearch")}
    options={options.map(item => ({ id: item.id, label: customerLabel(item, i18n.language), select: () => onSelect(item) }))}
  />;
}

/* ---------- product (all active types; sales allows services) ---------- */

export function SalesProductSearch({
  value,
  onSelect,
  excludeIds,
  excludeTypes,
  placeholder,
}: {
  value: Product | null;
  onSelect: (p: Product | null) => void;
  excludeIds?: string[];
  excludeTypes?: string[];
  placeholder?: string;
}) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 300);
    return () => clearTimeout(id);
  }, [text]);


  const results = useQuery({
    queryKey: ["sales-product-search", companyId, debounced],
    queryFn: () =>
      api.listProducts({
        company_id: companyId!,
        search: debounced || undefined,
        status: "active",
        per_page: 10,
      }),
    enabled: !!companyId && open && !value,
    retry: false,
  });

  const options = (results.data?.data ?? [])
    .filter((p) => !(excludeIds ?? []).includes(p.id))
    .filter((p) => !(excludeTypes ?? []).includes(p.type));

  return <SearchPicker
    valueLabel={value ? productLabel(value, i18n.language) : null}
    clear={() => { onSelect(null); setText(""); setOpen(false); }}
    text={text} setText={setText} open={open} setOpen={setOpen}
    loading={results.isFetching} error={results.isError} retry={() => void results.refetch()}
    placeholder={placeholder ?? t("inventory.productSearch")}
    options={options.map(item => ({ id: item.id, label: productLabel(item, i18n.language), select: () => onSelect(item) }))}
  />;
}

/* ---------- priced lines ---------- */

/** Display-only estimate of one priced line (backend recomputes authoritatively). */
export function estimateLineAmounts(line: {
  quantity: string;
  unit_price: string;
  discount_rate: string;
  tax_rate: string;
}): { net: number; tax: number; total: number } {
  const qty = toNumber(line.quantity);
  const price = toNumber(line.unit_price);
  const disc = toNumber(line.discount_rate) / 100;
  const tax = toNumber(line.tax_rate) / 100;
  const net = qty * price * (1 - disc);
  const taxAmt = net * tax;
  return { net, tax: taxAmt, total: net + taxAmt };
}

export function estimateTotals(
  lines: { quantity: string; unit_price: string; discount_rate: string; tax_rate: string }[],
): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const a = estimateLineAmounts(l);
    subtotal += a.net;
    tax += a.tax;
  }
  return { subtotal, tax, total: subtotal + tax };
}

export interface DraftPricedLine {
  key: number;
  product: Product | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_rate: string;
  tax_rate: string;
}

export function blankPricedLine(key: number): DraftPricedLine {
  return {
    key,
    product: null,
    description: "",
    quantity: "",
    unit_price: "",
    discount_rate: "",
    tax_rate: "",
  };
}

/** A draft line is submittable when qty + price are positive and percents are 0-100. */
export function isDraftLineValid(l: DraftPricedLine): boolean {
  if (!isPositiveDecimal(l.quantity)) return false;
  if (!isValidDecimal(l.unit_price)) return false;
  for (const p of [l.discount_rate, l.tax_rate]) {
    if (p.trim() !== "") {
      if (!isValidDecimal(p) || toNumber(p) < 0 || toNumber(p) > 100) return false;
    }
  }
  return true;
}

export function draftLineToInput(l: DraftPricedLine): PricedLineInput {
  return {
    product_id: l.product?.id,
    description: l.description.trim(),
    quantity: l.quantity.trim(),
    unit_price: l.unit_price.trim(),
    discount_rate: l.discount_rate.trim() === "" ? "0" : l.discount_rate.trim(),
    tax_rate: l.tax_rate.trim() === "" ? "0" : l.tax_rate.trim(),
  };
}

export function PricedLineEditor({
  lines,
  setLines,
  requireProduct,
  autoDescription,
  excludeProductTypes,
}: {
  lines: DraftPricedLine[];
  setLines: (ls: DraftPricedLine[]) => void;
  requireProduct?: boolean;
  autoDescription?: boolean;
  excludeProductTypes?: string[];
}) {
  const { t, i18n } = useTranslation();
  const setLine = (key: number, patch: Partial<DraftPricedLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink">{t("sales.lines")}</p>
      <div className="space-y-3">
        {lines.map((l) => {
          const est = estimateLineAmounts({
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_rate: l.discount_rate || "0",
            tax_rate: l.tax_rate || "0",
          });
          return (
            <div key={l.key} className="rounded-xl border border-line-soft p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("inventory.product")}>
                  <SalesProductSearch
                    value={l.product}
                    excludeTypes={excludeProductTypes}
                    onSelect={(p) => {
                      const patch: Partial<DraftPricedLine> = { product: p };
                      if (autoDescription && p && !l.description) {
                        patch.description = i18n.language === "ar" ? p.name_ar : p.name_en;
                      }
                      setLine(l.key, patch);
                    }}
                    excludeIds={lines
                      .filter((x) => x.key !== l.key && x.product)
                      .map((x) => x.product!.id)}
                  />
                </Field>
                <Field label={t("sales.description")}>
                  <TextInput
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                    dir="auto"
                    maxLength={255}
                  />
                </Field>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label={t("sales.quantity")}>
                  <TextInput
                    dir="ltr"
                    inputMode="decimal"
                    className="tnum"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                    placeholder="0.0000"
                  />
                </Field>
                <Field label={t("sales.unitPrice")}>
                  <TextInput
                    dir="ltr"
                    inputMode="decimal"
                    className="tnum"
                    value={l.unit_price}
                    onChange={(e) => setLine(l.key, { unit_price: e.target.value })}
                    placeholder="0.0000"
                  />
                </Field>
                <Field label={t("sales.discountRate")}>
                  <TextInput
                    dir="ltr"
                    inputMode="decimal"
                    className="tnum"
                    value={l.discount_rate}
                    onChange={(e) => setLine(l.key, { discount_rate: e.target.value })}
                    placeholder="0"
                  />
                </Field>
                <Field label={t("sales.taxRate")}>
                  <TextInput
                    dir="ltr"
                    inputMode="decimal"
                    className="tnum"
                    value={l.tax_rate}
                    onChange={(e) => setLine(l.key, { tax_rate: e.target.value })}
                    placeholder="0"
                  />
                </Field>
                <Field label={t("sales.lineTotal")}>
                  <p dir="ltr" className="tnum px-3 py-2 text-sm font-semibold text-ink">
                    {est.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </Field>
              </div>
              {requireProduct && !l.product && (
                <p className="mt-2 text-xs text-warning">{t("inventory.productRequired")}</p>
              )}
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                >
                  <span className="text-danger">{t("common.remove")}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={() => setLines([...lines, blankPricedLine(Date.now())])}
      >
        {t("sales.addLine")}
      </Button>
      {lines.some((l) => isDraftLineValid(l)) && (
        <div className="mt-3 rounded-xl bg-surface-soft p-3">
          {(() => {
            const valid = lines.filter(isDraftLineValid);
            const tt = estimateTotals(
              valid.map((l) => ({
                quantity: l.quantity,
                unit_price: l.unit_price,
                discount_rate: l.discount_rate || "0",
                tax_rate: l.tax_rate || "0",
              })),
            );
            const f = (n: number) =>
              n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink-soft">
                <span>
                  {t("sales.subtotal")}:{" "}
                  <b dir="ltr" className="tnum text-ink">
                    {f(tt.subtotal)}
                  </b>
                </span>
                <span>
                  {t("sales.taxTotal")}:{" "}
                  <b dir="ltr" className="tnum text-ink">
                    {f(tt.tax)}
                  </b>
                </span>
                <span>
                  {t("sales.grandTotal")}:{" "}
                  <b dir="ltr" className="tnum text-ink">
                    {f(tt.total)}
                  </b>
                </span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function salesCustomerName(c: SalesPartyRef | null | undefined, lang: string): string {
  if (!c) return "—";
  return lang === "ar" ? c.nameAr ?? c.nameEn ?? c.number : c.nameEn ?? c.nameAr ?? c.number;
}

/** Product label for sales DTO refs (names are nullable in sales responses). */
export function salesProductLabel(
  p: { sku: string; nameAr?: string | null; nameEn?: string | null; name_ar?: string | null; name_en?: string | null },
  lang: string,
): string {
  const ar = p.nameAr ?? p.name_ar ?? "";
  const en = p.nameEn ?? p.name_en ?? "";
  return `${p.sku} — ${lang === "ar" ? ar : en}`;
}
