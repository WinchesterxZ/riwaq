/**
 * Tauri desktop integration (graceful degradation in browser).
 *
 * All functions feature-detect the Tauri runtime and fall back to web
 * equivalents when running in a plain browser. The desktop shell
 * (apps/desktop) is a thin native wrapper — no business logic here.
 */

/** True when running inside the Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Show a native OS notification (desktop) or fall back to the in-app feed.
 * The in-app notification feed (Phase 9) is the source of truth; this is
 * only the native bridge.
 */
export async function notifyNative(opts: {
  title: string;
  body: string;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    const { sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    // Request permission once; silent no-op if denied.
    let granted = await (async () => {
      try {
        const { isPermissionGranted, requestPermission } = await import(
          "@tauri-apps/plugin-notification"
        );
        if (await isPermissionGranted()) return true;
        return (await requestPermission()) === "granted";
      } catch {
        return false;
      }
    })();
    if (granted) sendNotification({ title: opts.title, body: opts.body });
  } catch {
    // Never break the app over a notification.
  }
}

/**
 * Native save-file dialog (desktop) — returns the chosen path or null.
 * In the browser, returns null and the caller falls back to blob download.
 */
export async function saveFileDialog(opts: {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return await save({
      defaultPath: opts.defaultPath,
      filters: opts.filters,
    });
  } catch {
    return null;
  }
}

/**
 * Native open-file dialog (desktop) — returns chosen paths.
 * In the browser, returns null and the caller falls back to <input type=file>.
 */
export async function openFileDialog(opts: {
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | string[] | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return await open({
      multiple: opts.multiple ?? false,
      filters: opts.filters,
    });
  } catch {
    return null;
  }
}
