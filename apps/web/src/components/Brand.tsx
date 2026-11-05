import { useTranslation } from "react-i18next";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  return <span className="brand" aria-label="رِواق — RIWAQ">
    <svg className="brand-mark" width="38" height="42" viewBox="0 0 40 44" fill="none" aria-hidden="true">
      <path d="M4 40V20a16 16 0 0 1 32 0v20M12 40V20a8 8 0 0 1 16 0v20M20 26v14" stroke="currentColor" strokeWidth="3.5" />
    </svg>
    {!compact && <span className="brand-type"><strong>{i18n.language === "ar" ? "رِواق" : "riwaq"}</strong><small>{i18n.language === "ar" ? "مساحة أعمالك" : "BUSINESS, CONNECTED"}</small></span>}
  </span>;
}
