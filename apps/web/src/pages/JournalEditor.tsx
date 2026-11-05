import { ApiError, type Account, type JournalEntry } from "@atlas-erp/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DirtyGuardPrompt, useDirtyGuard } from "../lib/dirtyGuard";
import {
  Amount,
  JOURNAL_STATUS_LABEL_KEYS,
  PERMS,
  formatAmount,
  journalStatusTone,
  toCents,
  todayISO,
} from "../lib/accounting";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
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
  Select,
  Table,
  TextInput,
} from "../components/ui";

interface LineState {
  key: string;
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  /** Embedded account info for lines whose account isn't in the active list. */
  snapshot?: { code: string; name_ar: string; name_en: string };
}

let lineSeq = 0;
const newLine = (): LineState => ({
  key: `line-${Date.now()}-${lineSeq++}`,
  account_id: "",
  debit: "",
  credit: "",
  description: "",
});

function AccountSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="min-w-52">
      <option value="">{t("journals.selectAccount")}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function JournalEditorPage({ isNew = false }: { isNew?: boolean }) {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { companyId, orgId, hasPermission } = useAuth();

  const canView = hasPermission(PERMS.journalsView);
  const canManage =
    hasPermission(PERMS.journalsCreate) || hasPermission(PERMS.journalsEdit);
  const canApprove = hasPermission(PERMS.journalsApprove);
  const canPost = hasPermission(PERMS.journalsPost);
  const canReverse = hasPermission(PERMS.journalsReverse);

  const entryId = isNew ? undefined : id;

  const entry = useQuery({
    queryKey: ["journal-entry", entryId],
    queryFn: () => api.getJournalEntry(entryId!),
    enabled: !!entryId && canView,
    retry: false,
  });

  const accounts = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => api.listAccounts(companyId!),
    enabled: !!companyId,
    retry: false,
  });

  const companiesQuery = useQuery({
    queryKey: ["companies", orgId],
    queryFn: () => api.listCompanies(),
    enabled: !!orgId,
    retry: false,
  });
  const defaultCurrency =
    companiesQuery.data?.find((c) => c.id === companyId)?.baseCurrency ?? "EGP";

  const [postingDate, setPostingDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [lines, setLines] = useState<LineState[]>([newLine(), newLine()]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [confirmAction, setConfirmAction] = useState<"delete" | "post" | "reverse" | null>(null);
  // One idempotency key per new-entry form so a retried submit can't double-create.
  const [idemKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
  );

  // Pristine snapshot of the form; compared against current state for the dirty guard.
  const pristineRef = useRef<string>("");

  const snapshotOf = (pd: string, desc: string, cur: string, ls: LineState[]): string =>
    JSON.stringify({
      postingDate: pd,
      description: desc,
      currency: cur,
      lines: ls.map((l) => ({
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    });

  // Populate the form when the entry loads.
  useEffect(() => {
    const e: JournalEntry | undefined = entry.data;
    if (!e || loadedFor === e.id) return;
    setLoadedFor(e.id);
    const pd = e.posting_date.slice(0, 10);
    const desc = e.description ?? "";
    const cur = e.currency ?? defaultCurrency;
    const ls = e.lines.map((l) => ({
      key: `line-${l.id}`,
      account_id: l.account_id,
      debit: l.debit ? String(l.debit) : "",
      credit: l.credit ? String(l.credit) : "",
      description: l.description ?? "",
      snapshot: { code: l.account.code, name_ar: l.account.name_ar, name_en: l.account.name_en },
    }));
    setPostingDate(pd);
    setDescription(desc);
    setCurrency(cur);
    setLines(ls);
    pristineRef.current = snapshotOf(pd, desc, cur, ls);
  }, [entry.data, loadedFor, defaultCurrency]);

  // Baseline for a brand-new entry (blank form).
  useEffect(() => {
    if (isNew && !entry.data && pristineRef.current === "") {
      pristineRef.current = snapshotOf(postingDate, description, currency, lines);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  const dirty =
    pristineRef.current !== "" &&
    snapshotOf(postingDate, description, currency, lines) !== pristineRef.current;
  const guard = useDirtyGuard(dirty);

  const lang = i18n.language;
  const accountLabel = (a: { code: string; name_ar: string; name_en: string }) =>
    `${a.code} — ${lang === "ar" ? a.name_ar : a.name_en}`;

  const selectOptions = useMemo(() => {
    const list: Account[] = accounts.data ?? [];
    const byId = new Map(list.map((a) => [a.id, a]));
    const opts: { id: string; label: string; disabled?: boolean }[] = [];
    const sorted = [...list]
      .filter((a) => a.is_active)
      .sort((x, y) => x.code.localeCompare(y.code));
    for (const a of sorted) {
      opts.push({ id: a.id, label: accountLabel(a), disabled: !a.is_postable });
    }
    // Keep current values visible even if their account is inactive/non-postable.
    for (const line of lines) {
      if (line.account_id && !byId.has(line.account_id) && line.snapshot) {
        opts.push({ id: line.account_id, label: accountLabel(line.snapshot), disabled: true });
      }
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data, lines, lang]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += toCents(l.debit);
      credit += toCents(l.credit);
    }
    return { debit, credit, diff: debit - credit, balanced: debit === credit };
  }, [lines]);

  const e = entry.data;
  const status = e?.status ?? "draft";
  const editable = isNew || (status === "draft" && canManage);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["journal-entries"] });
    if (entryId) void qc.invalidateQueries({ queryKey: ["journal-entry", entryId] });
  };

  function validate(): string | null {
    if (!postingDate) return t("validation.required");
    if (!description.trim()) return t("validation.required");
    if (lines.length === 0) return t("journals.linesRequired");
    for (const l of lines) {
      if (!l.account_id) return t("journals.lineAccountRequired");
      const d = toCents(l.debit);
      const c = toCents(l.credit);
      if ((d === 0 && c === 0) || (d > 0 && c > 0)) return t("journals.lineAmountInvalid");
    }
    if (!totals.balanced) return t("journals.unbalancedError");
    return null;
  }

  const payload = () => ({
    posting_date: postingDate,
    description: description.trim(),
    currency: currency.trim() || defaultCurrency,
    lines: lines.map((l) => ({
      account_id: l.account_id,
      debit: toCents(l.debit) / 100,
      credit: toCents(l.credit) / 100,
      description: l.description.trim() || undefined,
    })),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const err = validate();
      if (err) throw new Error(err);
      if (isNew) {
        return api.createJournalEntry({
          company_id: companyId!,
          ...payload(),
          idempotency_key: idemKey,
        });
      }
      return api.updateJournalEntry(entryId!, { ...payload(), version: e?.version });
    },
    onSuccess: (saved) => {
      toast.success(t("journals.saved"));
      invalidate();
      guard.allowNavigation();
      if (isNew) navigate(`/journals/${saved.id}`, { replace: true });
      else setLoadedFor(null); // re-sync form from the fresh entry
    },
    onError: (err) => {
      // Plain Errors are client-side validation messages (already localized);
      // ApiErrors go through the localized envelope.
      setFormError(err instanceof ApiError ? errorMessage(err, t) : err instanceof Error ? err.message : errorMessage(err, t));
    },
  });

  function useEntryTransition(
    key: "submitted" | "approved" | "rejected" | "posted" | "reversed" | "deleted",
    fn: () => Promise<unknown>,
  ) {
    return useMutation({
      mutationFn: fn,
      onSuccess: () => {
        toast.success(t(`journals.${key}`));
        setConfirmAction(null);
        invalidate();
        if (key === "deleted") {
          guard.allowNavigation();
          navigate("/journals");
        }
      },
      onError: (err) => {
        setConfirmAction(null);
        toast.error(errorMessage(err, t));
      },
    });
  }

  // Individual transition mutations (unconditional hooks).
  const submitMutation = useEntryTransition("submitted", () => api.submitJournalEntry(entryId!));
  const approveMutation = useEntryTransition("approved", () => api.approveJournalEntry(entryId!));
  const rejectMutation = useEntryTransition("rejected", () => api.rejectJournalEntry(entryId!));
  const postMutation = useEntryTransition("posted", () => api.postJournalEntry(entryId!, e?.version ?? 0));
  const reverseMutation = useEntryTransition("reversed", () => api.reverseJournalEntry(entryId!));
  const deleteMutation = useEntryTransition("deleted", () => api.deleteJournalEntry(entryId!));

  const updateLine = (key: string, patch: Partial<LineState>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (!canView) {
    return (
      <>
        <PageHeader title={t("journals.title")} />
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      </>
    );
  }

  if (!companyId) {
    return (
      <>
        <PageHeader title={t("journals.title")} />
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      </>
    );
  }

  const busy =
    saveMutation.isPending ||
    submitMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    postMutation.isPending ||
    reverseMutation.isPending ||
    deleteMutation.isPending;

  return (
    <>
      <DirtyGuardPrompt show={guard.showPrompt} onLeave={guard.confirmLeave} onStay={guard.stay} />
      <PageHeader
        title={isNew ? t("journals.new") : t("journals.details")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isNew && e && <Badge tone={journalStatusTone(e.status)}>{t(JOURNAL_STATUS_LABEL_KEYS[e.status])}</Badge>}
            <Link to="/journals">
              <Button variant="secondary" size="sm">
                {t("common.back")}
              </Button>
            </Link>
          </div>
        }
      />

      {!isNew && entry.isLoading ? (
        <Card>
          <LoadingBlock />
        </Card>
      ) : !isNew && entry.isError ? (
        <Card>
          <ErrorState message={errorMessage(entry.error, t)} onRetry={() => entry.refetch()} />
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label={t("journals.postingDate")} required>
                <TextInput
                  type="date"
                  dir="ltr"
                  value={postingDate}
                  onChange={(e2) => setPostingDate(e2.target.value)}
                  disabled={!editable}
                />
              </Field>
              <Field label={t("common.currency")}>
                <TextInput
                  value={currency}
                  onChange={(e2) => setCurrency(e2.target.value.toUpperCase())}
                  dir="ltr"
                  maxLength={3}
                  disabled={!editable}
                />
              </Field>
              <Field label={t("common.description")} required>
                <TextInput
                  value={description}
                  onChange={(e2) => setDescription(e2.target.value)}
                  disabled={!editable}
                />
              </Field>
            </div>
          </Card>

          <Card className="mb-4">
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
              <h2 className="text-sm font-bold text-ink">{t("journals.lines")}</h2>
              {editable && (
                <Button variant="secondary" size="sm" onClick={() => setLines((p) => [...p, newLine()])}>
                  {t("journals.addLine")}
                </Button>
              )}
            </div>
            <Table
              head={[
                t("journals.account"),
                t("common.description"),
                t("common.debit"),
                t("common.credit"),
                editable ? t("common.actions") : "",
              ]}
            >
              {lines.map((l) => (
                <tr key={l.key} className="hover:bg-surface-soft/50">
                  <td className="px-4 py-2">
                    <AccountSelect
                      value={l.account_id}
                      onChange={(v) => updateLine(l.key, { account_id: v })}
                      options={selectOptions}
                      disabled={!editable}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <TextInput
                      value={l.description}
                      onChange={(e2) => updateLine(l.key, { description: e2.target.value })}
                      disabled={!editable}
                      className="!py-2"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <TextInput
                      type="number"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      value={l.debit}
                      onChange={(e2) => updateLine(l.key, { debit: e2.target.value, credit: e2.target.value ? "" : l.credit })}
                      disabled={!editable}
                      className="!py-2 text-end"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <TextInput
                      type="number"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      value={l.credit}
                      onChange={(e2) => updateLine(l.key, { credit: e2.target.value, debit: e2.target.value ? "" : l.debit })}
                      disabled={!editable}
                      className="!py-2 text-end"
                    />
                  </td>
                  {editable && (
                    <td className="px-4 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={lines.length <= 1}
                        onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                      >
                        {t("common.remove")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-surface-soft/40 px-5 py-3">
              <div className="flex items-center gap-5 text-sm">
                <span className="text-ink-soft">
                  {t("journals.totalDebit")}: <Amount value={totals.debit / 100} />
                </span>
                <span className="text-ink-soft">
                  {t("journals.totalCredit")}: <Amount value={totals.credit / 100} />
                </span>
              </div>
              <Badge tone={totals.balanced && lines.length > 0 ? "success" : "danger"}>
                {totals.balanced && lines.length > 0
                  ? t("journals.balanceOk")
                  : t("journals.balanceOff", { diff: formatAmount(totals.diff / 100) })}
              </Badge>
            </div>
          </Card>

          {formError && (
            <p className="mb-4 rounded-xl border border-danger/25 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button loading={saveMutation.isPending} disabled={busy} onClick={() => saveMutation.mutate()}>
                {t("journals.saveDraft")}
              </Button>
            )}
            {!isNew && status === "draft" && canManage && (
              <>
                <Button
                  variant="secondary"
                  loading={submitMutation.isPending}
                  disabled={busy}
                  onClick={() => submitMutation.mutate()}
                >
                  {t("journals.submit")}
                </Button>
                <Button
                  variant="danger"
                  loading={deleteMutation.isPending}
                  disabled={busy}
                  onClick={() => setConfirmAction("delete")}
                >
                  {t("common.delete")}
                </Button>
              </>
            )}
            {!isNew && status === "submitted" && canApprove && (
              <>
                <Button loading={approveMutation.isPending} disabled={busy} onClick={() => approveMutation.mutate()}>
                  {t("journals.approve")}
                </Button>
                <Button
                  variant="secondary"
                  loading={rejectMutation.isPending}
                  disabled={busy}
                  onClick={() => rejectMutation.mutate()}
                >
                  {t("journals.reject")}
                </Button>
              </>
            )}
            {!isNew && status === "approved" && canPost && (
              <Button loading={postMutation.isPending} disabled={busy} onClick={() => setConfirmAction("post")}>
                {t("journals.post")}
              </Button>
            )}
            {!isNew && status === "posted" && canReverse && (
              <Button
                variant="secondary"
                loading={reverseMutation.isPending}
                disabled={busy}
                onClick={() => setConfirmAction("reverse")}
              >
                {t("journals.reverse")}
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmAction === "delete"}
        title={t("journals.deleteTitle")}
        text={t("journals.deleteText")}
        confirmLabel={t("common.delete")}
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === "post"}
        title={t("journals.postTitle")}
        text={t("journals.postText")}
        confirmLabel={t("journals.post")}
        loading={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
        onClose={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === "reverse"}
        title={t("journals.reverseTitle")}
        text={t("journals.reverseText")}
        confirmLabel={t("journals.reverse")}
        loading={reverseMutation.isPending}
        onConfirm={() => reverseMutation.mutate()}
        onClose={() => setConfirmAction(null)}
      />
    </>
  );
}
