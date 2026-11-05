import { ApiError } from "@atlas-erp/api-client";
import i18n from "./i18n";

/**
 * Resolve a user-facing message for a query/mutation failure.
 * - ApiError → the server's bilingual message (message_ar when UI is Arabic).
 * - Network failure (fetch TypeError) → honest connectivity message.
 * - Anything else → generic fallback.
 */
export function errorMessage(err: unknown, t: (k: string) => string): string {
  const lang = (i18n.language === "ar" ? "ar" : "en") as "ar" | "en";
  if (err instanceof ApiError) {
    return err.localizedMessage(lang);
  }
  if (err instanceof TypeError) {
    return t("errors.network");
  }
  return t("errors.unknown");
}
