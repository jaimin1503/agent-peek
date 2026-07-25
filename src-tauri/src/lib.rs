mod overlay;

use overlay::OverlayWindow;
use tauri::Manager;

/// Initial capsule size. The frontend corrects this as soon as it has measured
/// itself; this only needs to be close enough not to flash.
const INITIAL_SIZE: (f64, f64) = (300.0, 40.0);

/// Bring a terminal application to the front.
///
/// `name` comes from the fixed environment -> app map in the AgentPeek hook and
/// is platform-shaped: a macOS application name ("Visual Studio Code") there, an
/// executable basename ("Code.exe") on Windows. The hook writes `null` where it
/// cannot identify the terminal, and the card disables the button in that case,
/// so this is never called with free text — but the session JSON is a file the
/// user can edit, so neither branch below may treat `name` as something to run.
#[cfg(target_os = "macos")]
#[tauri::command]
fn focus_app(name: String) -> Result<(), String> {
    // A single argv element, so there is no shell involved.
    std::process::Command::new("open")
        .args(["-a", &name])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Windows has no `open -a`: the terminal is found by walking the top-level
/// windows and matching each one's process image name against `name`. Note that
/// `name` is only ever *compared* — nothing derived from it is executed, which
/// is a stricter position than the macOS branch can take.
#[cfg(target_os = "windows")]
#[tauri::command]
fn focus_app(name: String) -> Result<(), String> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, MAX_PATH};
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    use windows::core::{BOOL, PWSTR};

    const CONTINUE: BOOL = BOOL(1);
    const STOP: BOOL = BOOL(0);

    /// The window's own executable, file name only. `None` for anything we are
    /// not allowed to query — a system process, or one that exited mid-walk.
    unsafe fn image_name(hwnd: HWND) -> Option<String> {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        // LIMITED_INFORMATION is the access right that does not require the
        // target to be same-integrity, so this works for a terminal launched
        // from anywhere without asking for elevation.
        let process: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(process);

        if !ok {
            return None;
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit(['\\', '/']).next().map(str::to_owned)
    }

    struct Search {
        target: String,
        /// The raw pointer, because `HWND` is not `Send` and this crosses an
        /// `extern "system"` boundary as an integer anyway.
        found: Option<*mut c_void>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: `lparam` is the `&mut Search` handed to `EnumWindows` below,
        // which outlives the enumeration and is not aliased — the callback runs
        // synchronously on this thread.
        let search = &mut *(lparam.0 as *mut Search);

        // Every process owns invisible message-only and tool windows. A visible
        // window with a title is the cheap approximation of "the one you can
        // actually switch to", and avoids matching those.
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return CONTINUE;
        }
        match image_name(hwnd) {
            Some(exe) if exe.eq_ignore_ascii_case(&search.target) => {
                search.found = Some(hwnd.0);
                STOP
            }
            _ => CONTINUE,
        }
    }

    let mut search = Search {
        target: name,
        found: None,
    };
    // Deliberately ignored: stopping the walk early makes `EnumWindows` report
    // failure, which is indistinguishable from a real error. `found` is the
    // answer either way.
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };

    let hwnd = HWND(search.found.ok_or("terminal window not found")?);

    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        // Windows only lets the foreground thread hand focus away. Attaching to
        // its input queue first is the documented way for a background process
        // to raise a window; without it `SetForegroundWindow` merely flashes the
        // taskbar button.
        let foreground = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let ours = GetCurrentThreadId();
        let attached = foreground != 0 && foreground != ours;
        if attached {
            let _ = AttachThreadInput(foreground, ours, true);
        }
        let raised = SetForegroundWindow(hwnd).as_bool();
        if attached {
            let _ = AttachThreadInput(foreground, ours, false);
        }
        if !raised {
            return Err("the foreground window refused to give up focus".into());
        }
    }
    Ok(())
}

/// No portable way to raise another application's window across X11 and
/// Wayland, so the hook reports no terminal on Linux and the card's button stays
/// disabled. This exists to keep the command's shape the same on every platform.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn focus_app(name: String) -> Result<(), String> {
    let _ = name;
    Err("focusing the terminal is not supported on this platform".into())
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
