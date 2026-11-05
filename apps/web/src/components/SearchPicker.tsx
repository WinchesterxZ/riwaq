import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useFieldControl } from "./ui";

type Choice = { id: string; label: string; select: () => void };

/** A real combobox: full labels, keyboard selection and a viewport-bounded popup. */
export function SearchPicker({ valueLabel, clear, text, setText, open, setOpen, loading, error, retry, options, placeholder }: {
  valueLabel: string | null; clear: () => void; text: string; setText: (text: string) => void;
  open: boolean; setOpen: (open: boolean) => void; loading: boolean; error: boolean;
  retry: () => void; options: Choice[]; placeholder: string;
}) {
  const { t } = useTranslation();
  const field = useFieldControl();
  const generated = useId();
  const id = field?.id ?? generated;
  const listId = `${id}-options`;
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(-1);
  const [bounds, setBounds] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const visible = open && !valueLabel;

  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const below = height - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < 180 && above > below;
      const maxHeight = Math.max(72, Math.min(280, flip ? above : below));
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      const left = Math.max(12, Math.min(document.dir === "rtl" ? rect.right - width : rect.left, window.innerWidth - width - 12));
      const actualHeight = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight);
      setBounds({ left, width, maxHeight, top: flip ? Math.max(8, rect.top - actualHeight - 6) : rect.bottom + 6 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [visible, options.length, loading, error]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [visible, setOpen]);
  useEffect(() => { setActive(-1); }, [text, visible]);
  useEffect(() => {
    if (active >= 0) popup.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (choice: Choice) => { choice.select(); setOpen(false); setText(""); setActive(-1); };
  return <div ref={root} className="search-picker">
    {valueLabel ? <div className="picker-value" role="group" aria-labelledby={field ? `${field.id}-label` : undefined} aria-label={field ? undefined : placeholder}>
      <span id={id} className="picker-value-label" dir="auto">{valueLabel}</span>
      <button type="button" className="picker-clear" aria-label={`${t("common.remove")}: ${valueLabel}`} onClick={() => { clear(); requestAnimationFrame(() => input.current?.focus()); }}>×</button>
    </div> : <div className="picker-input-wrap">
      <input ref={input} id={id} className="ui-input picker-input" type="text" role="combobox" autoComplete="off"
        aria-label={field ? undefined : placeholder} aria-autocomplete="list" aria-expanded={visible}
        aria-controls={visible ? listId : undefined} aria-activedescendant={visible && active >= 0 && options[active] ? `${listId}-${active}` : undefined}
        aria-describedby={field?.description} aria-invalid={field?.invalid || undefined} aria-required={field?.required || undefined}
        value={text} placeholder={placeholder} onFocus={() => setOpen(true)}
        onChange={event => { setText(event.target.value); setOpen(true); }}
        onBlur={event => { if (!root.current?.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={event => {
          if (event.key === "Escape" && visible) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            if (options.length) setActive(previous => event.key === "ArrowDown" ? (previous + 1) % options.length : (previous <= 0 ? options.length - 1 : previous - 1));
          } else if (event.key === "Enter" && visible && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]); }
          else if (event.key === "Tab") setOpen(false);
        }} />
      <button type="button" tabIndex={-1} className="picker-toggle" aria-label={placeholder} aria-expanded={visible}
        onMouseDown={event => event.preventDefault()} onClick={() => { if (visible) setOpen(false); else { input.current?.focus(); setOpen(true); } }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>}
    {visible && createPortal(<div ref={popup} className="picker-popup" style={{ position: "fixed", ...bounds, visibility: bounds ? "visible" : "hidden" }}>
      {loading ? <p role="status" className="picker-message">{t("common.loading")}</p>
        : error ? <div className="picker-message" role="alert"><p>{t("common.error")}</p><button type="button" className="text-accent-deep underline" onMouseDown={event => event.preventDefault()} onClick={retry}>{t("common.retry")}</button></div>
        : options.length === 0 ? <p role="status" className="picker-message">{t("common.noResults")}</p> : null}
      <div role="listbox" id={listId} aria-label={placeholder}>
        {!loading && !error && options.map((choice, index) => <button type="button" key={choice.id} id={`${listId}-${index}`}
          role="option" aria-selected={active === index} tabIndex={-1} data-index={index}
          className={`picker-option ${active === index ? "is-highlighted" : ""}`} onMouseEnter={() => setActive(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(choice)}><span dir="auto">{choice.label}</span></button>)}
      </div>
    </div>, document.body)}
  </div>;
}
