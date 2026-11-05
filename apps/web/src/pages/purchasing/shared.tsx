import { SearchPicker } from "../../components/SearchPicker";
import type { Supplier } from "@atlas-erp/api-client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  TextInput,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { randomKey } from "../sales/shared";

export { randomKey };

/* ---------- permission + company guard ---------- */

export function PurchaseGuard({
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

/* ---------- supplier ---------- */

export function supplierLabel(s: Supplier, lang: string): string {
  return `${s.number} — ${lang === "ar" ? s.name_ar : s.name_en}`;
}

export function SupplierSearch({
  value,
  onSelect,
  placeholder,
}: {
  value: Supplier | null;
  onSelect: (s: Supplier | null) => void;
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
    queryKey: ["purchasing-supplier-search", companyId, debounced],
    queryFn: () =>
      api.listSuppliers({
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
    valueLabel={value ? supplierLabel(value, i18n.language) : null}
    clear={() => { onSelect(null); setText(""); setOpen(false); }}
    text={text} setText={setText} open={open} setOpen={setOpen}
    loading={results.isFetching} error={results.isError} retry={() => void results.refetch()}
    placeholder={placeholder ?? t("purchasing.supplierSearch")}
    options={options.map(item => ({ id: item.id, label: supplierLabel(item, i18n.language), select: () => onSelect(item) }))}
  />;
}

/* ---------- action button with permission gate ---------- */

export function PermButton({
  perm,
  size,
  variant,
  disabled,
  title,
  onClick,
  children,
}: {
  perm: string;
  size?: "sm";
  variant?: "secondary" | "ghost";
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission(perm);
  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || !allowed}
      title={allowed ? title : t("common.noPermission")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/* ---------- progress bar (received / billed) ---------- */

export function ProgressBar({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-soft">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
