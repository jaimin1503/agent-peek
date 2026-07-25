//! Sole owner of the overlay's native window behaviour.
//!
//! macOS window behaviour across Spaces, fullscreen apps and multiple displays is
//! quirky enough that splitting this logic across the config, the setup hook, the
//! frontend and the tray produced two separate disappearing-window bugs. All of it
//! lives here now, behind a state machine.
//!
//! # Invariants
//!
//! 1. **Every operation that changes the frame or visibility ends with `reassert`.**
//!    Enforced structurally: `apply` is the only function that touches either, and
//!    it always reasserts as its last step.
//! 2. **No code outside this module mutates the native window.** `lib.rs` exposes
//!    only the commands at the bottom of this file; nothing else may call
//!    `set_size`, `set_position`, `show`, `hide` or reach for `ns_window`.
//! 3. **Tray actions route through here** — via `overlay_show` / `overlay_hide`.
//!    Calling `window.show()` directly skips reassertion and leaves the window
//!    ordered out of the current Space, which is bug #2 below.
//! 4. **Redocking is re-entrancy safe.** `set_position` emits `Moved`, and `Moved`
//!    triggers a redock; the `docking` flag breaks that loop.
//! 5. **Exactly one code path changes the frame** — `apply`.
//!
//! Set `AGENTPEEK_TRACE=1` to log the window's level, collection behaviour,
//! visibility and active-Space membership on every reassert. That readback is
//! what identified the activation-policy bug below; it is kept because these
//! failures are invisible from the outside — the window reports itself perfectly
//! healthy while not being composited at all.
//!
//! # The bugs this exists to prevent
//!
//! * An Accessory app is never the key window, so a newly shown or resized window
//!   is left *unordered*: `CGWindowListCopyWindowInfo` reports `onscreen=false`
//!   however high its level is, and the overlay is simply invisible.
//!   `orderFrontRegardless` is the fix, and it has to run after *every* frame change.
//! * AppKit is main-thread only. Tauri commands run on a worker thread, so the
//!   previous `reassert_overlay` command was calling `setLevel` and
//!   `orderFrontRegardless` off-main — undefined behaviour that happened to work.
//!   Every native call here goes through `run_on_main_thread`.
//! * Calling `set_activation_policy(.accessory)` at runtime strands the window
//!   off the active Space permanently — `isOnActiveSpace()` stays false, nothing
//!   composites, and because an uncomposited webview has its timers throttled the
//!   UI silently stops polling too. Agent status is declared via `LSUIElement` in
//!   `Info.plist` instead, so the process is an agent before any window exists.
//! * Ordering repair must not depend on the frontend. A throttled webview cannot
//!   run the timer that would fix the condition causing it to be throttled, so the
//!   keepalive lives on a Rust thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Monitor, PhysicalPosition, WebviewWindow, WindowEvent,
};

/// Air between the top of the usable screen area and the overlay.
const TOP_GAP: f64 = 6.0;

/// Frame changes below this are layout noise and are not worth a native round trip.
const EPSILON: f64 = 1.0;

/// How often the window treatment is re-asserted. Cheap — a monitor lookup and
/// three ObjC calls — and it is the only thing that recovers the overlay from a
/// Space change or a wake-from-sleep, neither of which raises an event.
const KEEPALIVE: std::time::Duration = std::time::Duration::from_secs(2);

/// Where the overlay sits. Only one variant today, but naming it keeps the
/// docking maths from being implicitly "top centre" everywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    TopCentre,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Frame {
    fn nearly_eq(&self, other: &Frame) -> bool {
        (self.x - other.x).abs() < EPSILON
            && (self.y - other.y).abs() < EPSILON
            && (self.width - other.width).abs() < EPSILON
            && (self.height - other.height).abs() < EPSILON
    }
}

/// Everything known about the native window, in one place. Reading any of this
/// from AppKit on demand would be racy; this is the authority.
#[derive(Debug)]
struct State {
    /// Size the frontend last asked for. Drives every redock.
    desired: LogicalSize<f64>,
    /// Frame last written to the native window, in logical points.
    frame: Option<Frame>,
    /// Name of the monitor last docked to, for change detection.
    monitor: Option<String>,
    visible: bool,
    /// Whether `orderFrontRegardless` has run since the last frame change.
    ordered: bool,
    anchor: Anchor,
}

struct Inner {
    window: WebviewWindow,
    state: Mutex<State>,
    /// True while we are writing the frame ourselves, so the `Moved` and
    /// `Resized` events that write produces do not trigger another redock.
    docking: AtomicBool,
}

#[derive(Clone)]
pub struct OverlayWindow {
    inner: Arc<Inner>,
}

impl OverlayWindow {
    pub fn new(window: WebviewWindow, initial: (f64, f64)) -> Self {
        Self {
            inner: Arc::new(Inner {
                window,
                state: Mutex::new(State {
                    desired: LogicalSize::new(initial.0, initial.1),
                    frame: None,
                    monitor: None,
                    visible: true,
                    ordered: false,
                    anchor: Anchor::TopCentre,
                }),
                docking: AtomicBool::new(false),
            }),
        }
    }

    /// One-time setup: the window treatment that does not depend on the frame.
    ///
    /// Note what is *not* here: `set_activation_policy(.accessory)`. Agent status
    /// is declared via `LSUIElement` in `Info.plist` instead. Setting it at
    /// runtime — after the window already exists — strands the window off the
    /// active Space permanently, and since an uncomposited webview has its timers
    /// throttled, the UI stops polling too. Both symptoms, one cause.
    pub fn install(&self, _app: &AppHandle) {
        self.redock();
        self.start_keepalive();
    }

    /// Periodically re-assert the window treatment, from Rust.
    ///
    /// This deliberately does **not** live in the frontend. macOS can drop the
    /// window off the active Space with no event to tell us, and an uncomposited
    /// webview has its timers throttled — so a JS-driven repair loop stops running
    /// exactly when it is needed and the overlay can never recover. Owning the
    /// heartbeat here keeps the invariant independent of the thing it protects.
    fn start_keepalive(&self) {
        let overlay = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(KEEPALIVE);
            overlay.redock();
        });
    }

    /// The frontend's only lever: "I need to be this big."
    ///
    /// Called both when the content actually changes size and on a slow heartbeat.
    /// It deliberately does not short-circuit on an unchanged size: the heartbeat
    /// is what repairs ordering after events macOS gives us no callback for.
    /// `redock` skips the frame write when nothing moved, so the repeat is cheap.
    pub fn resize(&self, width: f64, height: f64) {
        {
            let mut state = self.inner.state.lock().unwrap();
            state.desired = LogicalSize::new(width, height);
        }
        self.redock();
    }

    pub fn show(&self) {
        {
            let mut state = self.inner.state.lock().unwrap();
            state.visible = true;
        }
        // Deliberately a full redock, not a bare `show()`: a window shown after
        // being hidden is unordered again, and the display it should appear on
        // may have changed while it was away.
        self.redock();
    }

    pub fn hide(&self) {
        {
            let mut state = self.inner.state.lock().unwrap();
            state.visible = false;
        }
        // Also a redock, so visibility travels the same single path as the frame.
        // Hiding out-of-band was a real bug: `reassert` calls `orderFrontRegardless`,
        // so the next heartbeat brought the hidden window straight back.
        self.redock();
    }

    pub fn is_visible(&self) -> bool {
        self.inner.state.lock().unwrap().visible
    }

    /// Recompute where the overlay belongs and put it there.
    ///
    /// Invariant 5: this is the only caller of `apply`, and `apply` is the only
    /// thing that writes the frame.
    ///
    /// Note there is no early return when nothing has moved. Ordering can be lost
    /// with no event to tell us — waking from sleep, a Space reshuffle, a display
    /// coming back — and an overlay that is invisible until something happens to
    /// resize it is exactly the failure this module exists to prevent. Reasserting
    /// is three ObjC calls, so it is always done; the *frame write* is what gets
    /// skipped when nothing changed.
    pub fn redock(&self) {
        let (desired, anchor, last_frame, visible) = {
            let state = self.inner.state.lock().unwrap();
            (state.desired, state.anchor, state.frame, state.visible)
        };

        let Some(monitor) = self.target_monitor() else {
            // No monitor is a transient condition (display asleep, mid-reconfigure).
            // Leave the window alone rather than parking it at a guessed origin.
            return;
        };

        let frame = dock_frame(&monitor, desired, anchor);
        let monitor_name = monitor.name().cloned();

        // Never write the frame while hidden: on macOS, setting the size or
        // position of a hidden NSWindow brings it back on screen, so a hidden
        // overlay would resurrect itself the moment the content changed size.
        // The move is deferred — `show` sees a stale frame and writes it then.
        let move_frame = visible && !last_frame.map(|f| f.nearly_eq(&frame)).unwrap_or(false);

        {
            let mut state = self.inner.state.lock().unwrap();
            // Only record what was actually written, so the deferred move is
            // still pending next time round.
            if move_frame {
                state.frame = Some(frame);
            }
            state.monitor = monitor_name;
        }
        self.apply(frame, visible, move_frame);
    }

    /// Which display the overlay should live on.
    ///
    /// The one under the pointer, because that is where attention is. Falling
    /// back to the window's own monitor and then the primary keeps this working
    /// when the pointer is off-screen or a display just went away.
    fn target_monitor(&self) -> Option<Monitor> {
        let window = &self.inner.window;
        if let Ok(PhysicalPosition { x, y }) = window.cursor_position() {
            if let Ok(Some(monitor)) = window.monitor_from_point(x, y) {
                return Some(monitor);
            }
        }
        if let Ok(Some(monitor)) = window.current_monitor() {
            return Some(monitor);
        }
        window.primary_monitor().ok().flatten()
    }

    /// **The single frame-mutation path.** Everything native happens here, on the
    /// main thread, in one closure so the ordering of size / position / order-front
    /// cannot interleave with another redock.
    ///
    /// `move_frame` false means "nothing moved, just make sure we are still on top".
    fn apply(&self, frame: Frame, visible: bool, move_frame: bool) {
        let inner = self.inner.clone();
        inner.docking.store(true, Ordering::SeqCst);

        let result = self.inner.window.clone().run_on_main_thread(move || {
            let window = &inner.window;

            if move_frame {
                // Kept correct even while hidden, so showing again does not flash
                // at a stale position.
                let _ = window.set_size(LogicalSize::new(frame.width, frame.height));
                let _ = window.set_position(LogicalPosition::new(frame.x, frame.y));
            }

            // Invariant 1: every path through this function settles ordering.
            // Reassertion is conditional on visibility — `orderFrontRegardless`
            // would otherwise un-hide a deliberately hidden window.
            if visible {
                let _ = window.show();
                reassert(window);
            } else {
                let _ = window.hide();
            }

            if let Ok(mut state) = inner.state.lock() {
                state.ordered = visible;
            }
            // Cleared only after the writes have landed, so the Moved/Resized
            // events they generate are still recognised as ours.
            inner.docking.store(false, Ordering::SeqCst);
        });

        if result.is_err() {
            // The closure will never run, so nothing will clear the flag.
            self.inner.docking.store(false, Ordering::SeqCst);
        }
    }

    /// React to the window being moved or rescaled by anything other than us.
    pub fn handle_window_event(&self, event: &WindowEvent) {
        match event {
            WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. } => {
                // Invariant 4. Without this, `set_position` -> `Moved` -> redock
                // -> `set_position` spins forever.
                if self.inner.docking.load(Ordering::SeqCst) {
                    return;
                }
                self.redock();
            }
            _ => {}
        }
    }
}

/// Top-centred within the monitor's *usable* area.
///
/// `work_area` already excludes the menu bar and the Dock, and it does so per
/// display — which is why this is computed here rather than in the frontend,
/// where the menu bar height would have to be a hardcoded guess.
fn dock_frame(monitor: &Monitor, size: LogicalSize<f64>, anchor: Anchor) -> Frame {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();

    // Physical -> logical. Secondary displays do not start at 0,0.
    let area_x = area.position.x as f64 / scale;
    let area_y = area.position.y as f64 / scale;
    let area_width = area.size.width as f64 / scale;

    match anchor {
        Anchor::TopCentre => Frame {
            x: (area_x + (area_width - size.width) / 2.0).round(),
            y: (area_y + TOP_GAP).round(),
            width: size.width,
            height: size.height,
        },
    }
}

/// Force the window back above everything, including fullscreen Spaces.
///
/// Must run on the main thread — see the module header.
fn reassert(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};

        let Ok(ptr) = window.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

        // tao only sets CanJoinAllSpaces. A fullscreen app owns its own Space, so
        // without FullScreenAuxiliary the overlay vanishes exactly when it matters.
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary,
        );
        ns_window.setLevel(NSStatusWindowLevel);

        // The overlay is never the key window — it is an Accessory app that
        // deliberately does not activate — and a non-key window does not receive
        // mouse-moved events unless it asks for them. Without this, hovering the
        // capsule to expand it does nothing.
        ns_window.setAcceptsMouseMovedEvents(true);

        ns_window.orderFrontRegardless();

        // Setting CanJoinAllSpaces on a window that is *already* ordered in does
        // not re-associate it with the current Space: AppKit reports
        // `isOnActiveSpace() == false` and the window is simply not composited,
        // even though it is visible, at the right level and correctly configured.
        // Ordering it out and straight back in forces the re-association.
        //
        // This is what strands the overlay on a Space that no longer has focus —
        // leave a fullscreen app, and it stays behind on the Space it was born on.
        if !ns_window.isOnActiveSpace() {
            ns_window.orderOut(None);
            ns_window.orderFrontRegardless();
        }

        if std::env::var("AGENTPEEK_TRACE").is_ok() {
            eprintln!(
                "[reassert] level={} behavior={:?} visible={} onActiveSpace={}",
                ns_window.level(),
                ns_window.collectionBehavior(),
                ns_window.isVisible(),
                ns_window.isOnActiveSpace()
            );
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// ── Commands: the entire surface the frontend is allowed to touch ────────────

#[tauri::command]
pub fn overlay_resize(overlay: tauri::State<'_, OverlayWindow>, width: f64, height: f64) {
    overlay.resize(width, height);
}

#[tauri::command]
pub fn overlay_show(overlay: tauri::State<'_, OverlayWindow>) {
    overlay.show();
}

#[tauri::command]
pub fn overlay_hide(overlay: tauri::State<'_, OverlayWindow>) {
    overlay.hide();
}

#[tauri::command]
pub fn overlay_is_visible(overlay: tauri::State<'_, OverlayWindow>) -> bool {
    overlay.is_visible()
}
