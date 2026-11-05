import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent on-solid hover:bg-accent-deep disabled:bg-accent/50",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-soft disabled:opacity-50",
  danger: "bg-danger on-solid hover:bg-danger/90 disabled:bg-danger/50",
  ghost: "text-ink-soft hover:bg-surface-soft hover:text-ink disabled:opacity-50",
};

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2.5 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`ui-button inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-2 disabled:cursor-not-allowed ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

/* ---------- Spinner ---------- */

export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-soft">
      <Spinner />
      <span className="text-sm">{label ?? t("common.loading")}</span>
    </div>
  );
}

/* ---------- Field / inputs ---------- */

const FieldContext = createContext<{ id: string; description?: string; invalid: boolean; required?: boolean } | null>(null);
export function useFieldControl() { return useContext(FieldContext); }

export function Field({
  label,
  error,
  children,
  required,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  const description = error || hint ? `${id}-description` : undefined;
  const content = isValidElement(children) && children.type === "textarea"
    ? cloneElement(children as React.ReactElement<React.TextareaHTMLAttributes<HTMLTextAreaElement>>, { id, "aria-describedby": description, "aria-invalid": !!error })
    : children;
  return (
    <FieldContext.Provider value={{ id, description, invalid: !!error, required }}>
    <div className="ui-field min-w-0">
      <label id={`${id}-label`} htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {content}
      {hint && !error && <span id={description} className="mt-1 block text-[13px] text-ink-soft">{hint}</span>}
      {error && <span id={description} role="alert" className="mt-1 block text-[13px] font-medium text-danger">{error}</span>}
    </div>
    </FieldContext.Provider>
  );
}

const INPUT_CLS =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:bg-surface-soft disabled:opacity-60";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const field = useFieldControl();
  return <input id={field?.id} aria-describedby={field?.description} aria-invalid={field?.invalid || undefined} aria-required={field?.required || undefined} {...props} className={`ui-input ${INPUT_CLS} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useFieldControl();
  const selectRef = useRef<HTMLSelectElement>(null);
  const noteId = useId();
  const [selection, setSelection] = useState({ label: "", clipped: false });
  useEffect(() => {
    const el = selectRef.current;
    if (!el) return;
    let mounted = true;
    const update = () => {
      if (!mounted) return;
      const label = el.selectedOptions[0]?.textContent?.trim() ?? "";
      const style = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) context.font = style.font;
      const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const clipped = (context?.measureText(label).width ?? 0) > available + 1;
      setSelection(previous => previous.label === label && previous.clipped === clipped ? previous : { label, clipped });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    void document.fonts.ready.then(update);
    return () => { mounted = false; observer.disconnect(); };
  }, [props.value, props.children]);
  const description = [props["aria-describedby"] ?? field?.description, selection.clipped ? noteId : undefined].filter(Boolean).join(" ") || undefined;
  return <div className="select-control">
    <select id={field?.id} aria-invalid={field?.invalid || undefined} aria-required={field?.required || undefined} {...props} ref={selectRef}
      title={props.title ?? selection.label} aria-describedby={description} data-selected-clipped={selection.clipped || undefined}
      className={`ui-select ${INPUT_CLS} ${props.className ?? ""}`} />
    {selection.clipped && <span className="select-full-value" id={noteId} dir="auto">{selection.label}</span>}
  </div>;
}

/* ---------- Card / page header ---------- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`ui-card rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Badge ---------- */

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "danger" | "accent" | "warning";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-soft text-ink-soft",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent-deep",
    warning: "bg-warning-soft text-warning",
  };
  return (
    <span
      className={`ui-badge inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ---------- Table ---------- */

export function Table({
  head,
  children,
}: {
  head: ReactNode[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setScrollable(el.scrollWidth > el.clientWidth + 2);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    update();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="table-block min-w-0">
      {scrollable && <p className="table-scroll-hint">{t("brand.tableScroll")} <span aria-hidden="true">↔</span></p>}
    <div ref={scrollRef} className="data-table overflow-x-auto" tabIndex={scrollable ? 0 : undefined} role={scrollable ? "region" : undefined} aria-label={scrollable ? t("brand.tableScroll") : undefined}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-soft/60">
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-ink-soft"
              >
                {h === "" && i === head.length - 1 && head.some(label => label !== "") ? t("common.actions") : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">{children}</tbody>
      </table>
    </div>
    </div>
  );
}

/* ---------- Empty / error states ---------- */

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-ink-faint">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 4v5" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {text && <p className="max-w-sm text-[13px] text-ink-soft">{text}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
        </svg>
      </div>
      <p className="max-w-md text-sm text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

/* ---------- Pagination ---------- */

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line-soft px-4 py-3">
      <span className="tnum text-xs text-ink-soft">
        {t("common.page")} {page} {t("common.of")} {totalPages} · {t("common.showing")} {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("common.previous")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

/* ---------- Dialog ---------- */

export function Dialog({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling inside the dialog.
      if (e.key === "Tab" && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog on open.
    const t = window.setTimeout(() => {
      const target =
        ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([aria-label])") ??
        ref.current;
      target?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-pop`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-soft hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p className="text-sm leading-relaxed text-ink-soft">{text}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("common.cancel")}
        </Button>
        <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
