import type {
  CreateProductInput,
  ProductType,
  ProductVariant,
  UpdateProductInput,
} from "@atlas-erp/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DirtyGuardPrompt, useDirtyGuard } from "../lib/dirtyGuard";
import {
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
  Table,
  TextInput,
} from "../components/ui";
import { PERMS } from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { AttachmentsSection } from "./PartyShared";
import { PRODUCT_TYPE_LABEL_KEYS, flattenCategories } from "./Products";

const PRODUCT_TYPES: ProductType[] = ["stocked", "non_stock", "service"];

function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function formatAttributes(attrs: Record<string, string> | undefined): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function VariantDialog({
  variant,
  onClose,
  onSubmit,
  saving,
}: {
  variant: ProductVariant | null;
  onClose: () => void;
  onSubmit: (input: { sku: string; attributes: Record<string, string> }) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [attrs, setAttrs] = useState(formatAttributes(variant?.attributes));
  const [formError, setFormError] = useState("");

  const save = () => {
    if (!sku.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    onSubmit({ sku: sku.trim(), attributes: parseAttributes(attrs) });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(variant ? "products.editVariant" : "products.addVariant")}
    >
      <div className="grid grid-cols-1 gap-4">
        <Field label={t("products.sku")} required>
          <TextInput value={sku} onChange={(e) => setSku(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t("products.attributes")} hint={t("products.attributesHint")}>
          <textarea
            value={attrs}
            onChange={(e) => setAttrs(e.target.value)}
            rows={4}
            dir="ltr"
            className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </Field>
      </div>
      {formError && <p className="mt-3 text-sm font-medium text-danger">{formError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button loading={saving} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </Dialog>
  );
}

export function ProductEditorPage({ isNew = false }: { isNew?: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { companyId, hasPermission } = useAuth();

  const canCreate = hasPermission(PERMS.productsCreate);
  const canManage = hasPermission(PERMS.productsManage);
  const canWrite = isNew ? canCreate : canManage;
  const canView = hasPermission(PERMS.productsView);

  const [sku, setSku] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [type, setType] = useState<ProductType>("stocked");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [preferredSupplierId, setPreferredSupplierId] = useState("");
  const [inventoryAccountId, setInventoryAccountId] = useState("");
  const [cogsAccountId, setCogsAccountId] = useState("");
  const [revenueAccountId, setRevenueAccountId] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(isNew);

  const [variantDialog, setVariantDialog] = useState<ProductVariant | null | undefined>(undefined);
  const [variantDeleteTarget, setVariantDeleteTarget] = useState<ProductVariant | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const existing = useQuery({
    queryKey: ["product", id],
    queryFn: () => api.getProduct(id!),
    enabled: !isNew && !!id && canView,
    retry: false,
  });

  const categories = useQuery({
    queryKey: ["product-categories", companyId],
    queryFn: () => api.listProductCategories(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const units = useQuery({
    queryKey: ["units-of-measure", companyId],
    queryFn: () => api.listUnitsOfMeasure(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const taxCodes = useQuery({
    queryKey: ["tax-codes", companyId],
    queryFn: () => api.listTaxCodes(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const suppliers = useQuery({
    queryKey: ["suppliers-lite", companyId],
    queryFn: () =>
      api.listSuppliers({ company_id: companyId!, status: "active", page: 1, per_page: 100 }),
    enabled: !!companyId && canView,
    retry: false,
  });

  const accounts = useQuery({
    queryKey: ["accounts-postable", companyId],
    queryFn: () => api.listAccountsFiltered(companyId!, { is_postable: true }),
    enabled: !!companyId && canView,
    retry: false,
  });

  const variants = useQuery({
    queryKey: ["product", id, "variants"],
    queryFn: () => api.listProductVariants(id!),
    enabled: !isNew && !!id && canView,
    retry: false,
  });

  useEffect(() => {
    if (existing.data && !initialized) {
      const p = existing.data;
      setSku(p.sku);
      setNameAr(p.name_ar);
      setNameEn(p.name_en);
      setType(p.type);
      setCategoryId(p.category_id ?? "");
      setUnitId(p.base_uom_id ?? "");
      setPurchasePrice(p.purchase_price != null ? String(p.purchase_price) : "");
      setSalesPrice(p.sales_price != null ? String(p.sales_price) : "");
      setTaxCodeId(p.tax_code_id ?? "");
      setReorderLevel(p.reorder_level != null ? String(p.reorder_level) : "");
      setPreferredSupplierId(p.preferred_supplier_id ?? "");
      setInventoryAccountId(p.inventory_account_id ?? "");
      setCogsAccountId(p.cogs_account_id ?? "");
      setRevenueAccountId(p.revenue_account_id ?? "");
      setInitialized(true);
    }
  }, [existing.data, initialized]);

  // Dirty-state guard: snapshot the form once initialized, compare on each render.
  const pristineRef = useRef<string>("");
  const snapshotOf = (): string =>
    JSON.stringify({
      sku, nameAr, nameEn, type, categoryId, unitId, purchasePrice, salesPrice,
      taxCodeId, reorderLevel, preferredSupplierId, inventoryAccountId,
      cogsAccountId, revenueAccountId,
    });
  useEffect(() => {
    if (initialized && pristineRef.current === "") {
      pristineRef.current = snapshotOf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);
  const dirty = initialized && pristineRef.current !== "" && snapshotOf() !== pristineRef.current;
  const guard = useDirtyGuard(dirty);

  const lang = i18n.language;
  const flatCategories = flattenCategories(categories.data ?? [], lang);
  const activeUnits = (units.data ?? []).filter((u) => u.is_active);
  const activeTaxCodes = (taxCodes.data ?? []).filter((tc) => tc.is_active);
  const activeAccounts = (accounts.data ?? [])
    .filter((a) => a.is_active)
    .sort((a, b) => a.code.localeCompare(b.code));
  const supplierRows = suppliers.data?.data ?? [];

  const save = async () => {
    if (!sku.trim() || !nameAr.trim() || !nameEn.trim() || !unitId) {
      setFormError(t("validation.required"));
      return;
    }
    for (const [label, val] of [
      [t("products.purchasePrice"), purchasePrice],
      [t("products.salesPrice"), salesPrice],
      [t("products.reorderLevel"), reorderLevel],
    ] as [string, string][]) {
      if (val.trim() !== "" && Number.isNaN(Number(val.trim()))) {
        setFormError(label);
        return;
      }
    }
    setFormError("");
    setSaving(true);
    try {
      const base = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        type,
        category_id: categoryId || null,
        base_uom_id: unitId,
        purchase_price: purchasePrice.trim() || null,
        sales_price: salesPrice.trim() || null,
        tax_code_id: taxCodeId || null,
        reorder_level: reorderLevel.trim() || null,
        preferred_supplier_id: preferredSupplierId || null,
        inventory_account_id: inventoryAccountId || null,
        cogs_account_id: cogsAccountId || null,
        revenue_account_id: revenueAccountId || null,
      };
      if (isNew) {
        const input: CreateProductInput = { company_id: companyId!, sku: sku.trim(), ...base };
        const res = await api.createProduct(input);
        toast.success(t("products.created"));
        await qc.invalidateQueries({ queryKey: ["products"] });
        guard.allowNavigation();
        navigate(`/products/${res.id}`, { replace: true });
      } else {
        const input: UpdateProductInput = { ...base };
        await api.updateProduct(id!, input);
        toast.success(t("products.saved"));
        await qc.invalidateQueries({ queryKey: ["product", id] });
        await qc.invalidateQueries({ queryKey: ["products"] });
        pristineRef.current = snapshotOf();
      }
    } catch (err) {
      setFormError(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const saveVariant = async (input: { sku: string; attributes: Record<string, string> }) => {
    setSaving(true);
    try {
      if (variantDialog) {
        await api.updateProductVariant(id!, variantDialog.id, input);
      } else {
        await api.createProductVariant(id!, input);
      }
      toast.success(t("products.variantSaved"));
      setVariantDialog(undefined);
      await qc.invalidateQueries({ queryKey: ["product", id, "variants"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const deleteVariant = async () => {
    if (!variantDeleteTarget) return;
    setSaving(true);
    try {
      await api.deleteProductVariant(id!, variantDeleteTarget.id);
      toast.success(t("products.variantDeleted"));
      setVariantDeleteTarget(null);
      await qc.invalidateQueries({ queryKey: ["product", id, "variants"] });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const doDeactivate = async () => {
    setSaving(true);
    try {
      await api.deactivateProduct(id!);
      toast.success(t("products.deactivated"));
      setDeactivateOpen(false);
      await qc.invalidateQueries({ queryKey: ["product", id] });
      await qc.invalidateQueries({ queryKey: ["products"] });
      guard.allowNavigation();
      navigate("/products");
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <>
        <PageHeader title={t(isNew ? "products.new" : "products.edit")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t(isNew ? "products.new" : "products.edit")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const accountOption = (a: { id: string; code: string; name_ar: string; name_en: string }) => (
    <option key={a.id} value={a.id}>
      {a.code} — {lang === "ar" ? a.name_ar : a.name_en}
    </option>
  );

  return (
    <>
      <DirtyGuardPrompt show={guard.showPrompt} onLeave={guard.confirmLeave} onStay={guard.stay} />
      <PageHeader
        title={t(isNew ? "products.new" : "products.edit")}
        actions={
          <>
            <Link to="/products">
              <Button variant="secondary" size="sm">
                {t("common.back")}
              </Button>
            </Link>
            {!isNew && canManage && existing.data?.is_active && (
              <Button variant="danger" size="sm" onClick={() => setDeactivateOpen(true)}>
                {t("common.deactivate")}
              </Button>
            )}
            <Button loading={saving} size="sm" disabled={!canWrite} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      />

      {!isNew && existing.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : !isNew && (existing.isError || !existing.data) ? (
        <Card>
          <ErrorState message={errorMessage(existing.error, t)} onRetry={() => existing.refetch()} />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-4 text-base font-bold text-ink">{t("products.basicInfo")}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={t("products.sku")} required>
                <TextInput value={sku} onChange={(e) => setSku(e.target.value)} dir="ltr" disabled={!canWrite} />
              </Field>
              <Field label={t("products.type")} required>
                <Select value={type} onChange={(e) => setType(e.target.value as ProductType)} disabled={!canWrite}>
                  {PRODUCT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {t(PRODUCT_TYPE_LABEL_KEYS[pt])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("parties.nameAr")} required>
                <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} disabled={!canWrite} />
              </Field>
              <Field label={t("parties.nameEn")} required>
                <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" disabled={!canWrite} />
              </Field>
              <Field label={t("products.category")}>
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noCategory")}</option>
                  {flatCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("products.unit")} required>
                <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noUnit")}</option>
                  {activeUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {lang === "ar" ? u.name_ar : u.name_en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-base font-bold text-ink">{t("products.pricing")}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={t("products.purchasePrice")}>
                <TextInput
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={!canWrite}
                />
              </Field>
              <Field label={t("products.salesPrice")}>
                <TextInput
                  value={salesPrice}
                  onChange={(e) => setSalesPrice(e.target.value)}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={!canWrite}
                />
              </Field>
              <Field label={t("products.taxCode")}>
                <Select value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noTax")}</option>
                  {activeTaxCodes.map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {lang === "ar" ? tc.name_ar : tc.name_en} ({String(tc.rate)}%)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("products.reorderLevel")}>
                <TextInput
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  dir="ltr"
                  inputMode="decimal"
                  disabled={!canWrite}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-base font-bold text-ink">{t("products.accounts")}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label={t("products.inventoryAccount")}>
                <Select value={inventoryAccountId} onChange={(e) => setInventoryAccountId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noAccount")}</option>
                  {activeAccounts.map(accountOption)}
                </Select>
              </Field>
              <Field label={t("products.cogsAccount")}>
                <Select value={cogsAccountId} onChange={(e) => setCogsAccountId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noAccount")}</option>
                  {activeAccounts.map(accountOption)}
                </Select>
              </Field>
              <Field label={t("products.revenueAccount")}>
                <Select value={revenueAccountId} onChange={(e) => setRevenueAccountId(e.target.value)} disabled={!canWrite}>
                  <option value="">{t("products.noAccount")}</option>
                  {activeAccounts.map(accountOption)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-base font-bold text-ink">{t("products.extra")}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label={t("products.preferredSupplier")}>
                <Select
                  value={preferredSupplierId}
                  onChange={(e) => setPreferredSupplierId(e.target.value)}
                  disabled={!canWrite}
                >
                  <option value="">{t("products.noSupplier")}</option>
                  {supplierRows.map((s) => (
                    <option key={s.id} value={s.id}>
                      {lang === "ar" ? s.name_ar : s.name_en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          {formError && (
            <p className="text-sm font-medium text-danger">{formError}</p>
          )}

          {!isNew && (
            <>
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-bold text-ink">{t("products.variants")}</h2>
                  {canManage && (
                    <Button variant="secondary" size="sm" onClick={() => setVariantDialog(null)}>
                      {t("products.addVariant")}
                    </Button>
                  )}
                </div>
                {variants.isLoading ? (
                  <LoadingBlock />
                ) : variants.isError ? (
                  <ErrorState message={errorMessage(variants.error, t)} onRetry={() => variants.refetch()} />
                ) : (variants.data ?? []).length === 0 ? (
                  <EmptyState title={t("products.noVariants")} />
                ) : (
                  <Table head={[t("products.sku"), t("products.attributes"), t("common.actions")]}>
                    {(variants.data ?? []).map((v) => (
                      <tr key={v.id} className="hover:bg-surface-soft/50">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] text-ink" dir="ltr">
                          {v.sku}
                        </td>
                        <td className="max-w-72 cell-readable px-4 py-3 text-ink-soft" dir="ltr">
                          {Object.entries(v.attributes ?? {})
                            .map(([k, val]) => `${k}=${val}`)
                            .join(", ") || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {canManage && (
                            <div className="flex gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setVariantDialog(v)}>
                                {t("common.edit")}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setVariantDeleteTarget(v)}>
                                <span className="text-danger">{t("common.delete")}</span>
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <AttachmentsSection ownerType="product" ownerId={id!} canManage={canManage} />
            </>
          )}
        </div>
      )}

      {variantDialog !== undefined && !isNew && (
        <VariantDialog
          variant={variantDialog}
          onClose={() => setVariantDialog(undefined)}
          onSubmit={(i) => void saveVariant(i)}
          saving={saving}
        />
      )}
      <ConfirmDialog
        open={variantDeleteTarget !== null}
        title={t("products.deleteVariantTitle")}
        text={t("products.deleteVariantText")}
        confirmLabel={t("common.delete")}
        danger
        loading={saving}
        onConfirm={() => void deleteVariant()}
        onClose={() => setVariantDeleteTarget(null)}
      />
      <ConfirmDialog
        open={deactivateOpen}
        title={t("products.deactivateTitle")}
        text={t("products.deactivateText", { name: lang === "ar" ? nameAr : nameEn })}
        confirmLabel={t("common.deactivate")}
        danger
        loading={saving}
        onConfirm={() => void doDeactivate()}
        onClose={() => setDeactivateOpen(false)}
      />
    </>
  );
}
