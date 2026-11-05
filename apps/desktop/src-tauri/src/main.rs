// Atlas ERP desktop shell (Tauri 2).
//
// The desktop app is a thin native shell around the shared React bundle
// (apps/web/dist). ALL business logic lives in the NestJS API — this Rust
// backend only wires native capabilities:
//
// - tauri-plugin-dialog   → native file dialogs (CSV import/export, PDF save)
// - tauri-plugin-notification → native OS notifications (bridged from the
//   in-app notification feed; the frontend decides when to fire them)
// - tauri-plugin-opener   → open PDFs / exported files with the OS default app
//
// Auth: the webview uses the same HttpOnly-cookie session auth as the
// browser. Cookies live in the OS webview's secure cookie jar — no tokens
// are ever written to localStorage by the desktop shell. See
// docs/phase10/AUTH.md for the full flow.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Atlas ERP desktop");
}
