import type { Account, BankStatement } from "@atlas-erp/api-client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  Amount,
  accountLabel,
  BANK_STATEMENT_STATUS_LABEL_KEYS,
  bankStatementStatusTone,
  formatDate,
  PERMS,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { randomKey } from "../sales/shared";
import { PermButton } from "../purchasing/shared";
import { FinanceGuard } from "./shared";

const PER_PAGE = 15;
const BANK_CODES = ["1100", "1110"];

interface DraftLine {
  key: number;
  value_date: string;
  description: string;
  reference: string;
  amount: string;
}

let lineKey = 1;
function blankLine(): DraftLine {
  return { key: lineKey++, value_date: todayISO(), description: "", reference: "", amount: "" };
}

function StatementDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const lang = i18n.language;

  const [accountId, setAccountId] = useState("");
  const [statementDate, setStatementDate] = useState(todayISO());
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);

  const accounts = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => api.listAccountsFiltered(companyId!, { is_postable: true }),
    enabled: !!companyId,
    retry: false,
  });

  const bankAccounts = useMemo(
    () => (accounts.data ?? []).filter((a: Account) => BANK_CODES.includes(a.code)),
    [accounts.data],
  );

  const linesTotal = useMemo(() => {
    let s = 0;
    for (const l of lines) {
      const n = parseFloat(l.amount);
      if (Number.isFinite(n)) s += n;
    }
    return s;
  }, [lines]);
  const closingNum = parseFloat(closing);
  const openingNum = parseFloat(opening);
  const balanced =
    Number.isFinite(closingNum) &&
    Number.isFinite(openingNum) &&
    Math.abs(openingNum + linesTotal - closingNum) < 0.005;

  const valid =
    !!accountId &&
    !!statementDate &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && l.value_date && Number.isFinite(parseFloat(l.amount))) &&
    balanced;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.createBankStatement(
        {
          company_id: companyId!,
          account_id: accountId,
          statement_date: statementDate,
          opening_balance: openingNum.toFixed(2),
          closing_balance: closingNum.toFixed(2),
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({
            value_date: l.value_date,
            description: l.description.trim(),
            reference: l.reference.trim() || undefined,
            amount: parseFloat(l.amount).toFixed(2),
          })),
        },
        randomKey(),
      );
      toast.success(t("finance.statementCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("finance.newStatement")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("finance.bankAccount")}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a, lang)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("finance.statementDate")}>
          <TextInput type="date" dir="ltr" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
        </Field>
        <Field label={t("finance.openingBalance")}>
          <TextInput dir="ltr" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
        <Field label={t("finance.closingBalance")}>
          <TextInput dir="ltr" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} />
        </Field>
        <Field label={t("finance.notes")}>
          <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{t("finance.linesTab")}</h3>
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          {t("finance.addLine")}
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-line-soft p-2">
            <div className="col-span-3">
              <Field label={t("finance.valueDate")}>
                <TextInput
                  type="date"
                  dir="ltr"
                  value={l.value_date}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, value_date: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label={t("finance.description")}>
                <TextInput
                  value={l.description}
                  dir="auto"
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label={t("finance.reference")}>
                <TextInput
                  value={l.reference}
                  dir="ltr"
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, reference: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label={t("finance.amount")}>
                <TextInput
                  dir="ltr"
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, amount: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-1 pb-1">
              <Button
                size="sm"
                variant="ghost"
                title={t("finance.removeLine")}
                disabled={lines.length <= 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className={`mt-3 text-[13px] ${balanced ? "text-success" : "text-danger"}`}>
        {t("finance.closingMustBalance")}: <span dir="ltr" className="tnum font-semibold">{linesTotal.toFixed(2)}</span>
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? t("common.loading") : t("finance.createStatement")}
        </Button>
      </div>
    </Dialog>
  );
}

function StatementDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const lang = i18n.language;

  const [tab, setTab] = useState<"lines" | "outstanding">("lines");
  const [journalIds, setJournalIds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["bank-statement", id],
    queryFn: () => api.getBankStatement(id),
    enabled: !!id,
    retry: false,
  });

  const outstanding = useQuery({
    queryKey: ["bank-statement-outstanding", id],
    queryFn: () => api.outstandingBankItems(id),
    enabled: !!id && tab === "outstanding" && hasPermission(PERMS.bankReconciliationView),
    retry: false,
  });

  const st = detail.data;

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["bank-statement", id] }),
      qc.invalidateQueries({ queryKey: ["bank-statements"] }),
      qc.invalidateQueries({ queryKey: ["bank-statement-outstanding", id] }),
    ]);

  const post = async () => {
    setBusy(true);
    try {
      await api.postBankStatement(id, randomKey());
      toast.success(t("finance.statementPosted"));
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const match = async (lineId: string) => {
    const jid = (journalIds[lineId] ?? "").trim();
    if (!jid) return;
    setBusy(true);
    try {
      await api.matchBankStatementLine(lineId, jid);
      toast.success(t("finance.lineMatched"));
      setJournalIds((m) => ({ ...m, [lineId]: "" }));
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const unmatch = async (lineId: string) => {
    setBusy(true);
    try {
      await api.unmatchBankStatementLine(lineId);
      toast.success(t("finance.lineUnmatched"));
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (detail.isLoading) {
    return (
      <Card>
        <LoadingBlock />
      </Card>
    );
  }
  if (detail.isError || !st) {
    return (
      <Card>
        <ErrorState
          message={detail.isError ? errorMessage(detail.error, t) : t("common.error")}
          onRetry={() => detail.refetch()}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4">
        <Button variant="secondary" size="sm" onClick={onBack}>
          {t("finance.backToList")}
        </Button>
      </div>

      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-ink" dir="ltr">
              {st.number}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {t("finance.bankAccount")}: <span dir="ltr" className="font-semibold">{st.account_code}</span>
              {" · "}
              {t("finance.statementDate")}: <span dir="ltr">{formatDate(st.statement_date, lang)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("finance.openingBalance")}: <Amount value={st.opening_balance} />
              </span>
              <span>
                {t("finance.closingBalance")}: <Amount value={st.closing_balance} />
              </span>
              <span>
                {t("finance.matchedLines")}: <span dir="ltr" className="tnum font-semibold">{st.matched_lines}/{st.total_lines}</span>
              </span>
            </div>
            {st.notes && (
              <p className="mt-2 text-sm text-ink-soft" dir="auto">
                {st.notes}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={bankStatementStatusTone(st.status)}>{t(BANK_STATEMENT_STATUS_LABEL_KEYS[st.status])}</Badge>
            {st.status === "draft" && (
              <PermButton perm={PERMS.bankStatementPost} size="sm" disabled={busy} onClick={() => void post()}>
                {t("finance.post")}
              </PermButton>
            )}
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-2 border-b border-line-soft">
        {(["lines", "outstanding"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === tb
                ? "border-b-2 border-accent text-accent-deep"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t(tb === "lines" ? "finance.linesTab" : "finance.outstandingTab")}
          </button>
        ))}
      </div>

      {tab === "lines" && (
        <Card>
          <Table
            head={[
              "#",
              t("finance.valueDate"),
              t("finance.description"),
              t("finance.reference"),
              t("finance.amount"),
              t("finance.matched"),
              "",
            ]}
          >
            {st.lines.map((l) => (
              <tr key={l.id} className="hover:bg-surface-soft/50">
                <td className="px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                  {l.line_no}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                  {formatDate(l.value_date, lang)}
                </td>
                <td className="px-4 py-2.5 text-ink" dir="auto">
                  {l.description}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                  {l.reference || "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                  <Amount value={l.amount} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {l.reconciled_entry_id ? (
                    <Badge tone="success">{t("finance.matched")}</Badge>
                  ) : (
                    <Badge tone="warning">{t("finance.unmatched")}</Badge>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end">
                  {l.reconciled_entry_id ? (
                    <PermButton
                      perm={PERMS.bankReconciliationMatch}
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void unmatch(l.id)}
                    >
                      {t("finance.unmatch")}
                    </PermButton>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      <TextInput
                        dir="ltr"
                        className="!w-44"
                        placeholder={t("finance.enterJournalId")}
                        value={journalIds[l.id] ?? ""}
                        onChange={(e) => setJournalIds((m) => ({ ...m, [l.id]: e.target.value }))}
                      />
                      <PermButton
                        perm={PERMS.bankReconciliationMatch}
                        size="sm"
                        disabled={busy || !(journalIds[l.id] ?? "").trim()}
                        onClick={() => void match(l.id)}
                      >
                        {t("finance.match")}
                      </PermButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "outstanding" && (
        <div className="space-y-4">
          {outstanding.isLoading ? (
            <Card>
              <LoadingBlock />
            </Card>
          ) : outstanding.isError ? (
            <Card>
              <ErrorState message={errorMessage(outstanding.error, t)} onRetry={() => outstanding.refetch()} />
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-line-soft bg-surface-soft/50 px-4 py-3">
                  <h2 className="text-sm font-bold text-ink">{t("finance.unmatchedStatementLines")}</h2>
                </div>
                {(outstanding.data?.unmatched_statement_lines ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-sm text-ink-soft">{t("finance.noOutstanding")}</p>
                ) : (
                  <Table
                    head={["#", t("finance.valueDate"), t("finance.description"), t("finance.reference"), t("finance.amount")]}
                  >
                    {outstanding.data!.unmatched_statement_lines.map((l) => (
                      <tr key={l.id} className="hover:bg-surface-soft/50">
                        <td className="px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                          {l.line_no}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                          {formatDate(l.value_date, lang)}
                        </td>
                        <td className="px-4 py-2.5 text-ink" dir="auto">
                          {l.description}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                          {l.reference || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                          <Amount value={l.amount} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card className="overflow-hidden">
                <div className="border-b border-line-soft bg-surface-soft/50 px-4 py-3">
                  <h2 className="text-sm font-bold text-ink">{t("finance.unmatchedGlLines")}</h2>
                </div>
                {(outstanding.data?.unmatched_gl_lines ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-sm text-ink-soft">{t("finance.noOutstanding")}</p>
                ) : (
                  <Table
                    head={[t("finance.journal"), t("finance.date"), t("finance.description"), t("finance.amount")]}
                  >
                    {outstanding.data!.unmatched_gl_lines.map((l) => (
                      <tr key={l.journal_entry_id} className="hover:bg-surface-soft/50">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                          {l.journal_entry_id.slice(0, 8)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                          {formatDate(l.posting_date, lang)}
                        </td>
                        <td className="px-4 py-2.5 text-ink" dir="auto">
                          {l.description || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                          <Amount value={l.amount} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function BankReconciliationPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["bank-statements", companyId, page, status],
    queryFn: () =>
      api.listBankStatements({
        company_id: companyId!,
        status: status || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && !selected,
    retry: false,
  });

  const rows: BankStatement[] = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <FinanceGuard
      perm={PERMS.bankReconciliationView}
      title={t("finance.bankRecTitle")}
      subtitle={t("finance.bankRecSubtitle")}
      actions={
        !selected && (
          <PermButton perm={PERMS.bankStatementCreate} size="sm" onClick={() => setDialogOpen(true)}>
            {t("finance.newStatement")}
          </PermButton>
        )
      }
    >
      {selected ? (
        <StatementDetail id={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("finance.posted")}>
                <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <option value="">{t("common.all")}</option>
                  <option value="draft">{t("finance.statusDraft")}</option>
                  <option value="posted">{t("finance.statusPosted")}</option>
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
              <EmptyState title={t("reports.noLines")} />
            ) : (
              <>
                <Table
                  head={[
                    t("finance.statementNumber"),
                    t("finance.bankAccount"),
                    t("finance.statementDate"),
                    t("finance.linesCount"),
                    t("finance.closingBalance"),
                    t("finance.posted"),
                  ]}
                >
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer hover:bg-surface-soft/50"
                      onClick={() => setSelected(s.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] font-semibold text-accent-deep" dir="ltr">
                        {s.number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                        {s.account_code}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                        {formatDate(s.statement_date, lang)}
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                        {s.lines_count}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                        <Amount value={s.closing_balance} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Badge tone={bankStatementStatusTone(s.status)}>
                          {t(BANK_STATEMENT_STATUS_LABEL_KEYS[s.status])}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
                <Pagination page={page} totalPages={meta!.total_pages} total={meta!.total} onPage={setPage} />
              </>
            )}
          </Card>
        </>
      )}

      {dialogOpen && (
        <StatementDialog
          onClose={() => setDialogOpen(false)}
          onDone={() => {
            setDialogOpen(false);
            void list.refetch();
          }}
        />
      )}
    </FinanceGuard>
  );
}
