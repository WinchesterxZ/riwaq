import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/auth";
import { usePdfDownload } from "../lib/pdf";
import { Button } from "./ui";

/**
 * Permission-gated "Download PDF" button. Fetches the PDF through the
 * authenticated API client (HttpOnly cookies) and opens it in a new tab.
 */
export function PdfButton({
  fetch,
  filename,
  permission,
}: {
  fetch: () => Promise<Blob>;
  filename?: string;
  /** When provided and not granted, the button is not rendered. */
  permission?: string;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { download, downloading } = usePdfDownload();

  if (permission && !hasPermission(permission)) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={downloading}
      onClick={() => void download(fetch, filename)}
      aria-label={t("pdf.downloadPdf")}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t("pdf.downloadPdf")}
    </Button>
  );
}
