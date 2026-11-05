import type { Account, ExpenseBill, Supplier } from "@atlas-erp/api-client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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
  EXPENSE_BILL_STATUS_LABEL_KEYS,
  expenseBillStatusTone,
  formatDate,
  PERMS,
  todayISO,
} from "../../lib/accounting";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { useToast } from "../../lib/toast";
import { randomKey } from "../sales/shared";
import { PermButton, SupplierSearch } from "../purchasing/shared";
import { FinanceGuard } from "./shared";

const PER_PAGE = 15;
const BANK_CODES = ["1100", "1110"];

interface DraftLine {
  key: number;
  account_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
}

let lineKey = 1;
function blankLine(): DraftLine {
  return { key: lineKey++, account_id: "", description: "", quantity: "1", unit_price: "", tax_rate: "0" };
}

function ExpenseBillDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const toast = useToast();
  const lang = i18n.language;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [billDate, setBillDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [payFrom, setPayFrom] = useState<"supplier" | "bank" | "cash">("supplier");
  const [bankAccountId, setBankAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);

  const accounts = useQuery({
    queryKey: ["postable-accounts", companyId],
    queryFn: () => api.listAccountsFiltered(companyId!, { is_postable: true }),
    enabled: !!companyId,
    retry: false,
  });

  const expenseAccounts = useMemo(
    () => (accounts.data ?? []).filter((a: Account) => a.account_type.code === "EXPENSE"),
    [accounts.data],
  );
  const bankAccounts = useMemo(
    () => (accounts.data ?? []).filter((a: Account) => BANK_CODES.includes(a.code)),
    [accounts.data],
  );

  const linesValid = lines.every(
    (l) =>
      !!l.account_id &&
      l.description.trim() &&
      Number.isFinite(parseFloat(l.quantity)) &&
      parseFloat(l.quantity) > 0 &&
      Number.isFinite(parseFloat(l.unit_price)) &&
      Number.isFinite(parseFloat(l.tax_rate)) &&
      parseFloat(l.tax_rate) >= 0,
  );

  const valid =
    !!billDate &&
    lines.length > 0 &&
    linesValid &&
    (payFrom === "supplier" || !!bankAccountId);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.createExpenseBill(
        {
          company_id: companyId!,
          supplier_id: supplier?.id ?? null,
          bill_date: billDate,
          due_date: dueDate || null,
          pay_from: payFrom,
          bank_account_id: payFrom === "supplier" ? null : bankAccountId,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({
            account_id: l.account_id,
            description: l.description.trim(),
            quantity: String(parseFloat(l.quantity)),
            unit_price: String(parseFloat(l.unit_price)),
            tax_rate: String(parseFloat(l.tax_rate)),
          })),
        },
        randomKey(),
      );
      toast.success(t("finance.expenseBillCreated"));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title={t("finance.newExpenseBill")} onClose={onClose} wide>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`${t("finance.supplier")} (${t("finance.optional")})`}>
          <SupplierSearch value={supplier} onSelect={setSupplier} />
        </Field>
        <Field label={t("finance.billDate")}>
          <TextInput type="date" dir="ltr" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        <Field label={`${t("finance.dueDate")} (${t("finance.optional")})`}>
          <TextInput type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t("finance.payFrom")}>
          <Select value={payFrom} onChange={(e) => setPayFrom(e.target.value as typeof payFrom)}>
            <option value="supplier">{t("finance.payFromSupplier")}</option>
            <option value="bank">{t("finance.payFromBank")}</option>
            <option value="cash">{t("finance.payFromCash")}</option>
          </Select>
        </Field>
        {payFrom !== "supplier" && (
          <Field label={t("finance.bankAccount")}>
            <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">—</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a, lang)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={`${t("finance.notes")} (${t("finance.optional")})`}>
          <TextInput value={notes} dir="auto" onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{t("finance.expenses")}</h3>
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          {t("finance.addLine")}
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-line-soft p-2">
            <div className="col-span-12 sm:col-span-4">
              <Field label={t("finance.expenseAccount")}>
                <Select
                  value={l.account_id}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, account_id: e.target.value } : x)))
                  }
                >
                  <option value="">{t("finance.pickExpenseAccount")}</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a, lang)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="col-span-12 sm:col-span-3">
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
            <div className="col-span-4 sm:col-span-1">
              <Field label={t("finance.quantity")}>
                <TextInput
                  dir="ltr"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Field label={t("finance.unitPrice")}>
                <TextInput
                  dir="ltr"
                  inputMode="decimal"
                  value={l.unit_price}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unit_price: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <Field label={t("finance.taxRate")}>
                <TextInput
                  dir="ltr"
                  inputMode="decimal"
                  value={l.tax_rate}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, tax_rate: e.target.value } : x)))
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

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? t("common.loading") : t("finance.newExpenseBill")}
        </Button>
      </div>
    </Dialog>
  );
}

function ExpenseBillDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const lang = i18n.language;

  const [busy, setBusy] = useState(false);
  const [journalId, setJournalId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["expense-bill", id],
    queryFn: () => api.getExpenseBill(id),
    enabled: !!id,
    retry: false,
  });

  const b = detail.data;

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["expense-bill", id] }),
      qc.invalidateQueries({ queryKey: ["expense-bills"] }),
    ]);

  const transition = async (action: "submit" | "approve" | "reject" | "cancel") => {
    setBusy(true);
    try {
      await api.transitionExpenseBill(id, action);
      toast.success(
        t(
          action === "submit"
            ? "finance.billSubmitted"
            : action === "approve"
              ? "finance.billApproved"
              : action === "reject"
                ? "finance.billRejected"
                : "finance.billCancelled",
        ),
      );
      await invalidate();
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      const res = await api.postExpenseBill(id, randomKey());
      toast.success(t("finance.billPosted"));
      setJournalId(res.journal_id);
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
  if (detail.isError || !b) {
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
              {b.number}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {t("finance.billDate")}: <span dir="ltr">{formatDate(b.bill_date, lang)}</span>
              {b.due_date && (
                <>
                  {" · "}
                  {t("finance.dueDate")}: <span dir="ltr">{formatDate(b.due_date, lang)}</span>
                </>
              )}
              {b.supplier_name && (
                <>
                  {" · "}
                  {t("finance.supplier")}: <span dir="auto">{b.supplier_name}</span>
                </>
              )}
              {" · "}
              {t("finance.payFrom")}:{" "}
              {t(
                b.pay_from === "supplier"
                  ? "finance.payFromSupplier"
                  : b.pay_from === "bank"
                    ? "finance.payFromBank"
                    : "finance.payFromCash",
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
              <span>
                {t("finance.subtotal")}: <Amount value={b.subtotal} />
              </span>
              <span>
                {t("finance.taxTotal")}: <Amount value={b.tax_total} />
              </span>
              <span className="font-bold text-ink">
                {t("finance.grandTotal")}: <Amount value={b.total} />
              </span>
              <span>
                {t("finance.paidTotal")}: <Amount value={b.paid_total} />
              </span>
              <span className="font-bold text-ink">
                {t("finance.outstanding")}: <Amount value={b.outstanding} />
              </span>
            </div>
            {b.notes && (
              <p className="mt-2 text-sm text-ink-soft" dir="auto">
                {b.notes}
              </p>
            )}
          </div>
          <Badge tone={expenseBillStatusTone(b.status)}>{t(EXPENSE_BILL_STATUS_LABEL_KEYS[b.status])}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {b.status === "draft" && (
            <>
              <PermButton perm={PERMS.expenseBillSubmit} size="sm" disabled={busy} onClick={() => void transition("submit")}>
                {t("finance.submit")}
              </PermButton>
              <PermButton perm={PERMS.expenseBillCreate} size="sm" variant="secondary" disabled={busy} onClick={() => void transition("cancel")}>
                {t("finance.cancel")}
              </PermButton>
            </>
          )}
          {b.status === "submitted" && (
            <>
              <PermButton perm={PERMS.expenseBillApprove} size="sm" disabled={busy} onClick={() => void transition("approve")}>
                {t("finance.approve")}
              </PermButton>
              <PermButton perm={PERMS.expenseBillApprove} size="sm" variant="secondary" disabled={busy} onClick={() => void transition("reject")}>
                {t("finance.reject")}
              </PermButton>
            </>
          )}
          {b.status === "approved" && (
            <>
              <PermButton perm={PERMS.expenseBillPost} size="sm" disabled={busy} onClick={() => void post()}>
                {t("finance.post")}
              </PermButton>
              <PermButton perm={PERMS.expenseBillCreate} size="sm" variant="secondary" disabled={busy} onClick={() => void transition("cancel")}>
                {t("finance.cancel")}
              </PermButton>
            </>
          )}
          {(journalId || b.journal_entry_id) && (
            <Link
              to={`/journals/${journalId ?? b.journal_entry_id}`}
              className="text-sm font-semibold text-accent-deep hover:underline"
              dir="ltr"
            >
              {t("finance.viewJournal")}
            </Link>
          )}
        </div>
      </Card>

      <Card>
        <Table
          head={[
            t("finance.expenseAccount"),
            t("finance.description"),
            t("finance.quantity"),
            t("finance.unitPrice"),
            t("finance.taxRate"),
            t("finance.lineTotal"),
            t("finance.taxAmount"),
          ]}
        >
          {b.lines.map((l) => (
            <tr key={l.id} className="hover:bg-surface-soft/50">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft" dir="ltr">
                {l.account_code}
              </td>
              <td className="px-4 py-2.5 text-ink" dir="auto">
                {l.description}
              </td>
              <td className="px-4 py-2.5 text-ink-soft" dir="ltr">
                <span className="tnum">{l.quantity}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                <Amount value={l.unit_price} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">
                <span dir="ltr" className="tnum">
                  {l.tax_rate}%
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                <Amount value={l.line_total} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                <Amount value={l.tax_amount} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const { companyId } = useAuth();
  const lang = i18n.language;

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["expense-bills", companyId, page, status],
    queryFn: () =>
      api.listExpenseBills({
        company_id: companyId!,
        status: status || undefined,
        page,
        per_page: PER_PAGE,
      }),
    enabled: !!companyId && !selected,
    retry: false,
  });

  const rows: ExpenseBill[] = list.data?.data ?? [];
  const meta = list.data?.meta;

  const payFromLabel = (p: string) =>
    t(p === "supplier" ? "finance.payFromSupplier" : p === "bank" ? "finance.payFromBank" : "finance.payFromCash");

  return (
    <FinanceGuard
      perm={PERMS.expenseBillView}
      title={t("finance.expensesTitle")}
      subtitle={t("finance.expensesSubtitle")}
      actions={
        !selected && (
          <PermButton perm={PERMS.expenseBillCreate} size="sm" onClick={() => setDialogOpen(true)}>
            {t("finance.newExpenseBill")}
          </PermButton>
        )
      }
    >
      {selected ? (
        <ExpenseBillDetail id={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("finance.posted")}>
                <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <option value="">{t("common.all")}</option>
                  {(
                    ["draft", "submitted", "approved", "rejected", "cancelled", "posted"] as const
                  ).map((s) => (
                    <option key={s} value={s}>
                      {t(EXPENSE_BILL_STATUS_LABEL_KEYS[s])}
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
              <EmptyState title={t("reports.noLines")} />
            ) : (
              <>
                <Table
                  head={[
                    t("finance.billNumber"),
                    t("finance.billDate"),
                    t("finance.payFrom"),
                    t("finance.grandTotal"),
                    t("finance.outstanding"),
                    t("finance.posted"),
                  ]}
                >
                  {rows.map((b) => (
                    <tr
                      key={b.id}
                      className="cursor-pointer hover:bg-surface-soft/50"
                      onClick={() => setSelected(b.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] font-semibold text-accent-deep" dir="ltr">
                        {b.number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft" dir="ltr">
                        {formatDate(b.bill_date, lang)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[13px] text-ink-soft">
                        {payFromLabel(b.pay_from)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end font-semibold text-ink">
                        <Amount value={b.total} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-end text-ink-soft">
                        <Amount value={b.outstanding} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Badge tone={expenseBillStatusTone(b.status)}>
                          {t(EXPENSE_BILL_STATUS_LABEL_KEYS[b.status])}
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
        <ExpenseBillDialog
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
