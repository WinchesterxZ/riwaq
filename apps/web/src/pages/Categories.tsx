import type { ProductCategory } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  PageHeader,
  Select,
  TextInput,
} from "../components/ui";
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { flattenCategories } from "./Products";

function CategoryFormDialog({
  category,
  allCategories,
  companyId,
  onClose,
  onSaved,
}: {
  category: ProductCategory | null;
  allCategories: ProductCategory[];
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const isEdit = category !== null;
  const lang = i18n.language;

  // Exclude the edited category and its descendants from the parent picker.
  const excluded = useMemo(() => {
    if (!category) return new Set<string>();
    const s = new Set<string>();
    const walk = (c: ProductCategory) => {
      s.add(c.id);
      (c.children ?? []).forEach(walk);
    };
    walk(category);
    return s;
  }, [category]);

  const [code, setCode] = useState(category?.code ?? "");
  const [nameAr, setNameAr] = useState(category?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(category?.name_en ?? "");
  const [parentId, setParentId] = useState(category?.parent_id ?? "");
  const [formError, setFormError] = useState("");

  const flat = flattenCategories(allCategories, lang).filter((c) => !excluded.has(c.id));

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        code: code.trim() || undefined,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        parent_id: parentId || null,
      };
      return isEdit && category
        ? api.updateProductCategory(category.id, input)
        : api.createProductCategory({ company_id: companyId, ...input });
    },
    onSuccess: () => {
      toast.success(t("categories.saved"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!nameAr.trim() || !nameEn.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "categories.edit" : "categories.new")} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("categories.code")}>
          <TextInput value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("categories.parent")}>
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("categories.noParent")}</option>
            {flat.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("parties.nameAr")} required>
          <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t("parties.nameEn")} required>
          <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={mutation.isPending} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

function collectIds(cats: ProductCategory[]): string[] {
  return cats.flatMap((c) => [c.id, ...collectIds(c.children ?? [])]);
}

export function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.masterDataView);
  const canManage = hasPermission(PERMS.masterDataManage);

  const [formCategory, setFormCategory] = useState<ProductCategory | null | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<ProductCategory | null>(null);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["product-categories", companyId],
    queryFn: () => api.listProductCategories(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const tree = list.data ?? [];
  const q = search.trim().toLowerCase();
  const nodeMatches = (c: ProductCategory): boolean => {
    const name = `${c.name_ar} ${c.name_en} ${c.code ?? ""}`.toLowerCase();
    if (q && name.includes(q)) return true;
    return (c.children ?? []).some(nodeMatches);
  };
  const filterNodes = (nodes: ProductCategory[]): ProductCategory[] =>
    nodes.flatMap((c) =>
      nodeMatches(c) ? [{ ...c, children: filterNodes(c.children ?? []) }] : [],
    );
  const visibleTree = q ? filterNodes(tree) : tree;
  const expandedSet = q ? new Set(collectIds(visibleTree)) : expanded ?? new Set(collectIds(tree));
  const lang = i18n.language;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const base = prev ?? new Set(collectIds(tree));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doDeactivate = async () => {
    if (!deactivateTarget) return;
    setBusy(true);
    try {
      await api.deactivateProductCategory(deactivateTarget.id);
      toast.success(t("categories.deactivated"));
      setDeactivateTarget(null);
      await qc.invalidateQueries({ queryKey: ["product-categories"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const renderNodes = (nodes: ProductCategory[], depth: number) =>
    nodes.map((c) => {
      const children = c.children ?? [];
      const isOpen = expandedSet.has(c.id);
      const name = lang === "ar" ? c.name_ar : c.name_en;
      return (
        <div key={c.id}>
          <div
            className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 hover:bg-surface-soft/50"
            style={{ paddingInlineStart: `${1 + depth * 1.75}rem` }}
          >
            {children.length > 0 ? (
              <button
                onClick={() => toggle(c.id)}
                aria-label={isOpen ? t("categories.collapseAll") : t("categories.expandAll")}
                className="rounded p-1 text-ink-soft hover:bg-surface-soft hover:text-ink"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={isOpen ? "" : "ltr:-rotate-90 rtl:rotate-90"}
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="w-6" />
            )}
            <span className="font-mono text-xs text-ink-faint" dir="ltr">
              {c.code || "—"}
            </span>
            <span className="font-medium text-ink" dir="auto">
              {name}
            </span>
            {children.length > 0 && (
              <span className="text-xs text-ink-faint">{t("categories.childrenCount", { count: children.length })}</span>
            )}
            <Badge tone={c.is_active ? "success" : "danger"}>
              {c.is_active ? t("common.active") : t("common.inactive")}
            </Badge>
            <span className="ms-auto flex gap-1">
              {canManage && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setFormCategory(c)}>
                    {t("common.edit")}
                  </Button>
                  {c.is_active && (
                    <Button variant="ghost" size="sm" onClick={() => setDeactivateTarget(c)}>
                      <span className="text-danger">{t("common.deactivate")}</span>
                    </Button>
                  )}
                </>
              )}
            </span>
          </div>
          {isOpen && children.length > 0 && renderNodes(children, depth + 1)}
        </div>
      );
    });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("categories.title")} subtitle={t("categories.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("categories.title")} subtitle={t("categories.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("categories.title")}
        subtitle={t("categories.subtitle")}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(new Set(collectIds(tree)))}
            >
              {t("categories.expandAll")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setExpanded(new Set())}>
              {t("categories.collapseAll")}
            </Button>
            <Button
              size="sm"
              disabled={!canManage}
              title={canManage ? undefined : t("common.noPermission")}
              onClick={() => setFormCategory(null)}
            >
              {t("categories.new")}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t("common.search")}>
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("categories.searchPlaceholder")}
            className="!w-64"
            aria-label={t("common.search")}
          />
        </Field>
      </div>
      <Card>
        {list.isLoading ? (
          <LoadingBlock />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error, t)} onRetry={() => list.refetch()} />
        ) : visibleTree.length === 0 ? (
          <EmptyState title={t("categories.noCategories")} />
        ) : (
          renderNodes(visibleTree, 0)
        )}
      </Card>

      {formCategory !== undefined && (
        <CategoryFormDialog
          category={formCategory}
          allCategories={tree}
          companyId={companyId}
          onClose={() => setFormCategory(undefined)}
          onSaved={() => {
            setFormCategory(undefined);
            void qc.invalidateQueries({ queryKey: ["product-categories"] });
          }}
        />
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("categories.deactivateTitle")}
        text={t("categories.deactivateText", {
          name: deactivateTarget ? (lang === "ar" ? deactivateTarget.name_ar : deactivateTarget.name_en) : "",
        })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={busy}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateTarget(null)}
      />
    </>
  );
}
