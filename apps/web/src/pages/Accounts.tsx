import type { Account, AccountTypeCode } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  Table,
  TextInput,
} from "../components/ui";
import { api } from "../lib/api";
import {
  ACCOUNT_TYPE_CODES,
  ACCOUNT_TYPE_LABEL_KEYS,
  PERMS,
} from "../lib/accounting";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";

interface TreeNode {
  account: Account;
  children: TreeNode[];
}

function buildTree(accounts: Account[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const a of accounts) byId.set(a.id, { account: a, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.account.parent_id;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byCode = (x: TreeNode, y: TreeNode) => x.account.code.localeCompare(y.account.code);
  for (const node of byId.values()) node.children.sort(byCode);
  roots.sort(byCode);
  return roots;
}

function AccountForm({
  account,
  accounts,
  companyId,
  onSaved,
  onClose,
}: {
  account: Account | null;
  accounts: Account[];
  companyId: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!account;

  const [code, setCode] = useState(account?.code ?? "");
  const [nameAr, setNameAr] = useState(account?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(account?.name_en ?? "");
  const [typeCode, setTypeCode] = useState<AccountTypeCode>(
    (account?.account_type.code as AccountTypeCode) ?? "ASSET",
  );
  const [parentId, setParentId] = useState(account?.parent_id ?? "");
  const [isPostable, setIsPostable] = useState(account?.is_postable ?? true);
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      isEdit && account
        ? api.updateAccount(account.id, {
            name_ar: nameAr.trim(),
            name_en: nameEn.trim(),
            description: description.trim() || undefined,
            is_postable: isPostable,
          })
        : api.createAccount({
            company_id: companyId,
            code: code.trim(),
            name_ar: nameAr.trim(),
            name_en: nameEn.trim(),
            account_type_id: typeCode,
            parent_id: parentId || null,
            is_postable: isPostable,
            description: description.trim() || undefined,
          }),
    onSuccess: () => {
      toast.success(t(isEdit ? "accounts.updated" : "accounts.created"));
      onSaved();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const save = () => {
    if (!nameAr.trim() || !nameEn.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    if (!isEdit && !code.trim()) {
      setFormError(t("validation.required"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={t(isEdit ? "accounts.editAccount" : "accounts.newAccount")} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("accounts.code")} required={!isEdit}>
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            dir="ltr"
            disabled={isEdit}
            placeholder="1001"
          />
        </Field>
        <Field label={t("accounts.accountType")} required={!isEdit}>
          <Select
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value as AccountTypeCode)}
            disabled={isEdit}
          >
            {ACCOUNT_TYPE_CODES.map((c) => (
              <option key={c} value={c}>
                {t(ACCOUNT_TYPE_LABEL_KEYS[c])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("accounts.nameAr")} required>
          <TextInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t("accounts.nameEn")} required>
          <TextInput value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
        </Field>
        {!isEdit && (
          <Field label={t("accounts.parentAccount")} required={false}>
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t("accounts.noParent")}</option>
              {accounts
                .filter((a) => a.is_active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label={t("common.description")} required={false}>
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("common.optional")}
          />
        </Field>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={isPostable}
          onChange={(e) => setIsPostable(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        {t("accounts.postable")}
      </label>
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

function AccountRow({
  node,
  depth,
  expanded,
  onToggle,
  canManage,
  onEdit,
  onDeactivate,
  lang,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
  onEdit: (a: Account) => void;
  onDeactivate: (a: Account) => void;
  lang: string;
}) {
  const { t } = useTranslation();
  const a = node.account;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(a.id);
  const name = lang === "ar" ? a.name_ar : a.name_en;
  const typeKey = ACCOUNT_TYPE_LABEL_KEYS[a.account_type.code as AccountTypeCode];

  return (
    <>
      <tr className="hover:bg-surface-soft/50">
        <td className="tnum whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold text-ink" dir="ltr">
          {a.code}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5" style={{ paddingInlineStart: depth * 22 }}>
            {hasChildren ? (
              <button
                onClick={() => onToggle(a.id)}
                aria-label={isOpen ? t("accounts.collapseAll") : t("accounts.expandAll")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-soft hover:bg-surface-soft hover:text-ink"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={isOpen ? "" : "rtl:rotate-180"}
                >
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" className={isOpen ? "hidden" : ""} />
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" className={isOpen ? "" : "hidden"} />
                </svg>
              </button>
            ) : (
              <span className="w-6 shrink-0" />
            )}
            <span className={`text-sm ${a.is_active ? "font-medium text-ink" : "text-ink-faint line-through"}`}>
              {name}
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft">
          {typeKey ? t(typeKey) : a.account_type.name_ar}
        </td>
        <td className="whitespace-nowrap px-4 py-2.5">
          <Badge tone={a.is_postable ? "accent" : "neutral"}>
            {a.is_postable ? t("accounts.postableYes") : t("accounts.postableNo")}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5">
          <Badge tone={a.is_active ? "success" : "neutral"}>
            {a.is_active ? t("common.active") : t("accounts.inactive")}
          </Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-2.5">
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => onEdit(a)}>
              {t("common.edit")}
            </Button>
            {a.is_active && (
              <Button variant="secondary" size="sm" disabled={!canManage} onClick={() => onDeactivate(a)}>
                {t("common.deactivate")}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {hasChildren &&
        isOpen &&
        node.children.map((child) => (
          <AccountRow
            key={child.account.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            canManage={canManage}
            onEdit={onEdit}
            onDeactivate={onDeactivate}
            lang={lang}
          />
        ))}
    </>
  );
}

export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.accountsView);
  const canManage = hasPermission(PERMS.accountsManage);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formAccount, setFormAccount] = useState<Account | null | undefined>(undefined);
  const [deactivateTarget, setDeactivateTarget] = useState<Account | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);

  const accounts = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => api.listAccounts(companyId!),
    enabled: !!companyId && canView,
    retry: false,
  });

  const tree = useMemo(
    () => buildTree(accounts.data ?? []),
    [accounts.data],
  );

  // Expand everything once the list loads.
  useEffect(() => {
    if (accounts.data) setExpanded(new Set(accounts.data.map((a) => a.id)));
  }, [accounts.data]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.deactivateAccount(id),
    onSuccess: () => {
      toast.success(t("accounts.deactivated"));
      setDeactivateTarget(null);
      void qc.invalidateQueries({ queryKey: ["accounts", companyId] });
    },
    onError: (err) => toast.error(errorMessage(err, t)),
  });

  const seedMutation = useMutation({
    mutationFn: () => api.seedChartOfAccounts(companyId!),
    onSuccess: (res) => {
      toast.success(t("accounts.seedSuccess", { count: res.created }));
      setSeedOpen(false);
      void qc.invalidateQueries({ queryKey: ["accounts", companyId] });
    },
    onError: (err) => {
      setSeedOpen(false);
      toast.error(errorMessage(err, t));
    },
  });

  if (!canView) {
    return (
      <>
        <PageHeader title={t("accounts.title")} subtitle={t("accounts.subtitle")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("accounts.title")} subtitle={t("accounts.subtitle")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const flat = accounts.data ?? [];

  return (
    <>
      <PageHeader
        title={t("accounts.title")}
        subtitle={t("accounts.subtitle")}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(new Set(flat.map((a) => a.id)))}
            >
              {t("accounts.expandAll")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setExpanded(new Set())}>
              {t("accounts.collapseAll")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canManage}
              onClick={() => setSeedOpen(true)}
            >
              {t("accounts.seedChart")}
            </Button>
            <Button size="sm" disabled={!hasPermission(PERMS.accountsCreate)} onClick={() => setFormAccount(null)}>
              {t("accounts.newAccount")}
            </Button>
          </>
        }
      />
      <Card>
        {accounts.isLoading ? (
          <LoadingBlock />
        ) : accounts.isError ? (
          <ErrorState message={errorMessage(accounts.error, t)} onRetry={() => accounts.refetch()} />
        ) : flat.length === 0 ? (
          <EmptyState title={t("accounts.noAccounts")} />
        ) : (
          <Table
            head={[
              t("accounts.code"),
              t("common.name"),
              t("accounts.accountType"),
              t("accounts.postable"),
              t("common.status"),
              t("common.actions"),
            ]}
          >
            {tree.map((node) => (
              <AccountRow
                key={node.account.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                canManage={canManage}
                onEdit={(a) => setFormAccount(a)}
                onDeactivate={(a) => setDeactivateTarget(a)}
                lang={i18n.language}
              />
            ))}
          </Table>
        )}
      </Card>

      {formAccount !== undefined && (
        <AccountForm
          account={formAccount}
          accounts={flat}
          companyId={companyId}
          onClose={() => setFormAccount(undefined)}
          onSaved={() => {
            setFormAccount(undefined);
            void qc.invalidateQueries({ queryKey: ["accounts", companyId] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title={t("accounts.deactivateTitle")}
        text={deactivateTarget ? t("accounts.deactivateText", { name: deactivateTarget.name_ar }) : ""}
        confirmLabel={t("common.deactivate")}
        danger
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onClose={() => setDeactivateTarget(null)}
      />

      <ConfirmDialog
        open={seedOpen}
        title={t("accounts.seedTitle")}
        text={t("accounts.seedText")}
        confirmLabel={t("common.confirm")}
        loading={seedMutation.isPending}
        onConfirm={() => seedMutation.mutate()}
        onClose={() => setSeedOpen(false)}
      />
    </>
  );
}
