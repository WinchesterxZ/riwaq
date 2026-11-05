import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "./errors";
import { isTauri, saveFileDialog } from "./tauri";
import { useToast } from "./toast";

/**
 * Downloads a PDF blob from an authenticated API endpoint and opens it in a
 * new tab (the API uses HttpOnly cookies, so we fetch → blob URL rather than
 * linking the endpoint directly). Falls back to an anchor download when the
 * popup is blocked. On desktop (Tauri) uses the native save dialog.
 */
export function usePdfDownload() {
  const { t } = useTranslation();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async (fetchBlob: () => Promise<Blob>, filename?: string) => {
    setDownloading(true);
    try {
      toast.info(t("pdf.downloading"));
      const blob = await fetchBlob();
      // Desktop: native save dialog (user picks the destination).
      if (isTauri()) {
        const path = await saveFileDialog({
          defaultPath: filename ?? "document.pdf",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (path) {
          // Write the blob via the Tauri FS bridge.
          const { writeFile } = await import("@tauri-apps/plugin-fs");
          const buf = new Uint8Array(await blob.arrayBuffer());
          await writeFile(path, buf);
          toast.success(t("pdf.saved", "Saved"));
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener");
      if (!win) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename ?? "document.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Give the new tab time to load before revoking.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(errorMessage(err, t) || t("pdf.failed"));
    } finally {
      setDownloading(false);
    }
  };

  return { download, downloading };
}
