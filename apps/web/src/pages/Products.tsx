import type { Product, ProductCategory, ProductType } from "@atlas-erp/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  Table,
  TextInput,
} from "../components/ui";
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { CsvImportDialog, downloadBlob } from "./PartyShared";

const PER_PAGE = 15;
const PRODUCT_TYPES: ProductType[] = ["stocked", "non_stock", "service"];
const SORTS = ["name", "-name", "sku", "-sku"] as const;

export const PRODUCT_TYPE_LABEL_KEYS: Record<ProductType, string> = {
  stocked: "products.typeStocked",
  non_stock: "products.typeNonStock",
  service: "products.typeService",
};

export function flattenCategories(
  cats: ProductCategory[],
  lang: string,
  depth = 0,
): { id: string; label: string }[] {
  return cats.flatMap((c) => [
    {
      id: c.id,
      label: `${"— ".repeat(depth)}${lang === "ar" ? c.name_ar : c.name_en}`,
    },
    ...flattenCategories(c.children ?? [], lang, depth + 1),
  ]);
}

export function ProductsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.productsView);
  const canCreate = hasPermission(PERMS.productsCreate);
  const canManage = hasPermission(PERMS.productsManage);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<string>("");
  const [page, setPage] = useState(1);
  const [deactivateTarget, setDeactivateTarget] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [search, type, categoryId, status, sort, companyId]);

  const categories = useQuery({
    queryKey: ["product-categories", companyId],
    queryFn: () => api.listProductCategories(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const list = useQuery({
    queryKey: ["products", companyId, search, type, categoryId, status, sort, page],
    queryFn: () =>
      api.listProducts({
        company_id: companyId!,
        search: search || undefined,
        type: type || undefined,
        category_id: categoryId || undefined,
        status: status || undefined,
        sort: sort || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && canView,
    retry: false,
  });

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    try {
      await api.deactivateProduct(deactivateTarget.id);
      toast.success(t("products.deactivated"));
      setDeactivateTarget(null);
      await qc.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    if (!companyId) return;
    try {
      downloadBlob(await api.exportProducts(companyId), "products-export.csv");
    } catch (err) {
      toast.error(errorMessage(err, t));
    }
  };

  if (!canView) {
    return (
      <>
        <PageHeader title={t("products.title")} subtitle={t("products.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("products.title")} subtitle={t("products.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const lang = i18n.language;
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const flatCategories = flattenCategories(categories.data ?? [], lang);

  return (
    <>
      <PageHeader
        title={t("products.title")}
        subtitle={t("products.subtitle")}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void doExport()}>
              {t("parties.export")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canCreate}
              title={canCreate ? undefined : t("common.noPermission")}
              onClick={() => setImportOpen(true)}
            >
              {t("parties.import")}
            </Button>
            <Link to="/products/new">
              <Button
                size="sm"
                disabled={!canCreate}
                title={canCreate ? undefined : t("common.noPermission")}
              >
                {t("products.new")}
              </Button>
            </Link>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t("common.search")}>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("products.searchPlaceholder")}
            />
          </Field>
          <Field label={t("products.typeFilter")}>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">{t("products.allTypes")}</option>
              {PRODUCT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {t(PRODUCT_TYPE_LABEL_KEYS[pt])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("products.categoryFilter")}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("products.allCategories")}</option>
              {flatCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("common.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.all")}</option>
              <option value="active">{t("common.active")}</option>
              <option value="inactive">{t("common.inactive")}</option>
            </Select>
          </Field>
          <Field label={t("products.sortLabel")}>
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">{t("common.all")}</option>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(
                    s === "name"
                      ? "products.sortNameAsc"
                      : s === "-name"
                        ? "products.sortNameDesc"
                        : s === "sku"
                          ? "products.sortSkuAsc"
                          : "products.sortSkuDesc",
                  )}
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
        ) : rows.length === 0 ? (
          <EmptyState title={t("products.noProducts")} />
        ) : (
          <>
            <Table
              head={[
                t("products.sku"),
                t("common.name"),
                t("products.type"),
                t("products.category"),
                t("products.salesPrice"),
                t("common.status"),
                t("common.actions"),
              ]}
            >
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-soft/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                    {p.sku}
                  </td>
                  <td className="max-w-56 cell-readable px-4 py-3 font-medium text-ink" dir="auto">
                    {lang === "ar" ? p.name_ar : p.name_en}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={p.type === "service" ? "accent" : "neutral"}>
                      {t(PRODUCT_TYPE_LABEL_KEYS[p.type])}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">
                    {flatCategories.find((c) => c.id === p.category_id)?.label.replace(/— /g, "") ??
                      t("products.noCategory")}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-3 text-ink-soft" dir="ltr">
                    {p.sales_price != null && p.sales_price !== "" ? String(p.sales_price) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={p.is_active ? "success" : "danger"}>
                      {p.is_active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex gap-2">
                      <Link to={`/products/${p.id}`}>
                        <Button variant="secondary" size="sm">
                          {t("common.edit")}
                        </Button>
                      </Link>
                      {canManage && p.is_active && (
                        <Button variant="ghost" size="sm" onClick={() => setDeactivateTarget(p)}>
                          <span className="text-danger">{t("common.deactivate")}</span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            {meta && (
              <Pagination page={meta.page} totalPages={meta.total_pages} total={meta.total} onPage={setPage} />
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("products.deactivateTitle")}
        text={t("products.deactivateText", {
          name: deactivateTarget ? (lang === "ar" ? deactivateTarget.name_ar : deactivateTarget.name_en) : "",
        })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={busy}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateTarget(null)}
      />

      {importOpen && companyId && (
        <CsvImportDialog
          title={t("parties.importTitle")}
          hint={t("parties.importHint")}
          filename="products-template.csv"
          onImport={(f) => api.importProducts(f)}
          onTemplate={() => api.exportProducts(companyId)}
          onDone={() => void qc.invalidateQueries({ queryKey: ["products"] })}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}
