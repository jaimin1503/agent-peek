mod overlay;

use overlay::OverlayWindow;
use tauri::Manager;

/// Initial capsule size. The frontend corrects this as soon as it has measured
/// itself; this only needs to be close enough not to flash.
const INITIAL_SIZE: (f64, f64) = (300.0, 40.0);

/// Bring a terminal application to the front.
///
/// `name` is a macOS application name (e.g. "Visual Studio Code"), taken from
/// the fixed TERM_PROGRAM -> app map in the AgentPeek hook — never free text.
/// `open` receives it as a single argv element, so there is no shell involved.
#[tauri::command]
fn focus_app(name: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", &name])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            focus_app,
            quit,
            overlay::overlay_resize,
            overlay::overlay_show,
            overlay::overlay_hide,
            overlay::overlay_is_visible,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");

            // OverlayWindow owns every native window concern from here on. Nothing
            // else in this process may position, order or show/hide the window —
            // see the invariants in overlay.rs.
            let overlay = OverlayWindow::new(window, INITIAL_SIZE);
            overlay.install(app.handle());
            app.manage(overlay);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let Some(overlay) = window.app_handle().try_state::<OverlayWindow>() {
                overlay.handle_window_event(event);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
