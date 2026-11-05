import { SearchPicker } from "../../components/SearchPicker";
import type { Product, Warehouse } from "@atlas-erp/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, Field, PageHeader, Select, TextInput } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/* ---------- warehouses across all branches ---------- */

export function useWarehouses() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["inventory-warehouses", companyId],
    queryFn: () => api.listCompanyWarehouses(companyId!),
    enabled: !!companyId,
    retry: false,
    staleTime: 60_000,
  });
}

export function warehouseLabel(w: Warehouse, lang: string): string {
  return lang === "ar" ? w.nameAr || w.name : w.name;
}

export function WarehouseSelect({
  value,
  onChange,
  allowAll,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const warehouses = useWarehouses();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {allowAll && <option value="">{t("inventory.allWarehouses")}</option>}
      {(warehouses.data ?? []).map((w) => (
        <option key={w.id} value={w.id}>
          {warehouseLabel(w, i18n.language)}
        </option>
      ))}
    </Select>
  );
}

/* ---------- product search combobox ---------- */

export function productLabel(
  p: { sku: string; name_ar?: string; name_en?: string; nameAr?: string; nameEn?: string },
  lang: string,
): string {
  const ar = p.name_ar ?? p.nameAr ?? "";
  const en = p.name_en ?? p.nameEn ?? "";
  return `${p.sku} — ${lang === "ar" ? ar : en}`;
}

export function ProductSearch({
  value,
  onSelect,
  excludeIds,
  placeholder,
}: {
  value: Product | null;
  onSelect: (p: Product | null) => void;
  excludeIds?: string[];
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
    queryKey: ["inventory-product-search", companyId, debounced],
    queryFn: () =>
      api.listProducts({
        company_id: companyId!,
        search: debounced || undefined,
        type: "stocked",
        status: "active",
        per_page: 10,
      }),
    enabled: !!companyId && open && !value,
    retry: false,
  });

  const options = (results.data?.data ?? []).filter((p) => !(excludeIds ?? []).includes(p.id));

  return <SearchPicker
    valueLabel={value ? productLabel(value, i18n.language) : null}
    clear={() => { onSelect(null); setText(""); setOpen(false); }}
    text={text} setText={setText} open={open} setOpen={setOpen}
    loading={results.isFetching} error={results.isError} retry={() => void results.refetch()}
    placeholder={placeholder ?? t("inventory.productSearch")}
    options={options.map(item => ({ id: item.id, label: productLabel(item, i18n.language), select: () => onSelect(item) }))}
  />;
}

/* ---------- decimal input ---------- */

export function DecimalField({
  label,
  value,
  onChange,
  placeholder,
  signed,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  signed?: boolean;
}) {
  return (
    <Field label={label}>
      <TextInput
        dir="ltr"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (signed ? "+/- 0.0000" : "0.0000")}
        className="tnum"
      />
    </Field>
  );
}

/* ---------- permission + company guard ---------- */

export function InventoryGuard({
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
