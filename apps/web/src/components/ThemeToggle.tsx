import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export type Theme = "light" | "dark";

const STORAGE_KEY = "atlas-theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies the theme to <html data-theme> and persists it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

// Apply as early as possible on module load to avoid a flash.
applyTheme(initialTheme());

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Keep in sync if the theme was changed before this component mounted.
    setTheme(initialTheme());
  }, []);

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? t("header.themeLight") : t("header.themeDark")}
      aria-label={t("header.themeToggle")}
      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
    >
      {theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
