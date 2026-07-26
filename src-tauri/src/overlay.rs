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
//!    ordered out of the current Space, which is bug #2 below. On macOS `show()` is
//!    not used at all — see the note in `apply`.
//! 4. **Redocking is re-entrancy safe.** `set_position` emits `Moved`, and `Moved`
//!    triggers a redock; the `docking` flag breaks that loop.
//! 5. **Exactly one code path changes the frame** — `apply`.
//!
//! # Being dragged
//!
//! The overlay docks itself, so a user-chosen position has to be a *mode* of the
//! docking rather than an escape from it — otherwise the 2s keepalive drags it
//! straight back. `Anchor::Free` is that mode: `move_by` accumulates pointer
//! deltas into it, `dock_frame` clamps it to the work area, and `redock` folds
//! the clamped result back into the anchor so an overshoot cannot accrue an
//! invisible offset. Everything else — ordering, level, Space behaviour — is
//! untouched, and the frame is still only ever written by `apply`.
//!
//! ponytail: in memory only, so it docks top-centre again on relaunch.
//! Persisting it means a file to write, version, and repair when it names a
//! display that is no longer attached — worth it only if re-dragging after every
//! restart becomes a real annoyance.
//!
//! # Windows and Linux
//!
//! Everything below with a macOS `cfg` is a no-op there, and the contract is
//! correspondingly smaller. tao's `always_on_top` and `skip_taskbar` — both set
//! in `tauri.conf.json` — already give what `NSPopUpMenuWindowLevel` and
//! `LSUIElement` give here: a window above the normal band, absent from the
//! taskbar and from Alt-Tab. `reassert` re-applies topmost on the keepalive
//! because Windows silently demotes it when another app claims topmost. There is
//! no Spaces analogue, so none of the ordering repair applies.
//!
//! The one behavioural difference is focus: the overlay is a plain window there,
//! so clicking it takes focus, and losing focus is therefore a reliable "you
//! clicked somewhere else" — which is what `handle_window_event` emits
//! `overlay:blur` from, in place of the global mouse monitor.
//!
//! ponytail: letting it take focus is the whole simplification. Full parity —
//! never activating, and still knowing about outside clicks — means
//! `WS_EX_NOACTIVATE` plus a `WH_MOUSE_LL` hook on its own message pump. Worth it
//! only if bouncing focus off the terminal for one click turns out to annoy.
//! Known ceiling either way: an *exclusive*-fullscreen Direct3D app covers a
//! topmost window, and nothing short of an overlay swapchain changes that.
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
//! * The overlay was invisible over every *native*-fullscreen app (green button)
//!   while working fine over a fullscreen VLC window — so the level was never the
//!   problem, joining the fullscreen app's Space was. Two causes, both in `reassert`
//!   and `apply`: the orderOut/orderFrontRegardless re-association was guarded by
//!   `!isOnActiveSpace()`, which a CanJoinAllSpaces window reports as `true` even
//!   when stranded, so it never ran; and `apply` called Tauri's `show()`, which tao
//!   implements as `makeKeyAndOrderFront:` — a key-status request from an app that
//!   never activates, which pulls the window back to its original Space on every
//!   keepalive tick.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Monitor, PhysicalPosition, WebviewWindow,
    WindowEvent,
};

/// Air between the top of the usable screen area and the overlay.
const TOP_GAP: f64 = 6.0;

/// Frame changes below this are layout noise and are not worth a native round trip.
const EPSILON: f64 = 1.0;

/// How often the window treatment is re-asserted. Cheap — a monitor lookup and
/// three ObjC calls — and it is the only thing that recovers the overlay from a
/// Space change or a wake-from-sleep, neither of which raises an event.
const KEEPALIVE: std::time::Duration = std::time::Duration::from_secs(2);

/// Where the overlay sits.
///
/// `Free` is what a drag produces, and it changes more than the origin: the
/// monitor lookup stops following the pointer (see `target_monitor`), because a
/// window you deliberately put somewhere must not migrate to whichever display
/// the mouse later wandered onto.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Anchor {
    TopCentre,
    /// Where the user dragged it, in global logical points. Always the clamped
    /// value — `redock` writes back what `dock_frame` decided was on screen.
    Free { x: f64, y: f64 },
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
        // Order matters, and it is the whole fix for fullscreen.
        //
        // The window is declared `"visible": false` in tauri.conf.json, so tao
        // creates it without ordering it in. It is re-classed to an `NSPanel` here,
        // and only then does `redock` order it front — so its *first* order-in
        // happens as a panel.
        //
        // Doing it the other way round strands the overlay: a window whose first
        // order-in happened as a plain `NSWindow` is assigned to the Space it was
        // born on, and if a fullscreen Space was already active at launch it never
        // migrates into it. No repair fixes that afterwards — not the
        // orderOut/orderFrontRegardless bounce, not resetting the collection
        // behaviour, not re-classing. Measured, not guessed: a panel that is a panel
        // before it is first shown joins an already-active fullscreen Space every
        // time.
        //
        // Both calls hop to the main thread through the same queue, so the promotion
        // is guaranteed to land ahead of `redock`'s writes.
        promote_to_panel(&self.inner.window);
        watch_outside_clicks(&self.inner.window);
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

    /// Nudge the overlay by a pointer delta. The frontend's second lever.
    ///
    /// Deltas rather than an absolute position: the frontend has no idea where
    /// the window actually is — that is this module's business — and a sum of
    /// deltas is order-independent, so nothing breaks if two of these land out
    /// of order.
    pub fn move_by(&self, dx: f64, dy: f64) {
        {
            let mut state = self.inner.state.lock().unwrap();
            let (x, y) = match state.anchor {
                Anchor::Free { x, y } => (x, y),
                // The first drag converts wherever docking last put it into a
                // free position. No frame yet means nothing has ever been
                // written, so there is nothing to drag from.
                Anchor::TopCentre => match state.frame {
                    Some(frame) => (frame.x, frame.y),
                    None => return,
                },
            };
            state.anchor = Anchor::Free {
                x: x + dx,
                y: y + dy,
            };
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

        let Some(monitor) = self.target_monitor(anchor) else {
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
            // Fold the clamp back into the anchor, every time — not just when the
            // frame moved. Letting the anchor drift past the edge it was clamped
            // to means a drag that overshoots builds up an invisible offset, and
            // dragging back does nothing until it has been paid off.
            if let Anchor::Free { .. } = state.anchor {
                state.anchor = Anchor::Free {
                    x: frame.x,
                    y: frame.y,
                };
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
    ///
    /// Once dragged, none of that applies: the display it is *on* is the answer,
    /// and following the pointer would yank it off the screen you parked it on
    /// the moment you moved the mouse elsewhere.
    fn target_monitor(&self, anchor: Anchor) -> Option<Monitor> {
        let window = &self.inner.window;
        if let Anchor::Free { .. } = anchor {
            if let Ok(Some(monitor)) = window.current_monitor() {
                return Some(monitor);
            }
            return window.primary_monitor().ok().flatten();
        }
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
                // Deliberately *not* `window.show()` on macOS: tao implements it as
                // `makeKeyAndOrderFront:`, which asks for key status on behalf of an
                // Accessory app that never activates. From another app's fullscreen
                // Space that request is answered by ordering the window back into the
                // Space it came from — and this runs on every keepalive tick, so the
                // overlay is repeatedly pulled off the Space you are looking at.
                // `reassert`'s `orderFrontRegardless` both shows and orders in, which
                // is the call documented for windows of inactive applications.
                #[cfg(not(target_os = "macos"))]
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
            // The Windows/Linux stand-in for the global mouse monitor: this
            // window *can* be focused there, so losing focus is a click that
            // landed somewhere else. See the platform note in the module header.
            #[cfg(not(target_os = "macos"))]
            WindowEvent::Focused(false) => {
                let _ = self.inner.window.emit("overlay:blur", ());
            }
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

/// Placed within the monitor's *usable* area.
///
/// `work_area` already excludes the menu bar and the Dock, and it does so per
/// display — which is why this is computed here rather than in the frontend,
/// where the menu bar height would have to be a hardcoded guess. It is also what
/// keeps a dragged overlay reachable: the clamp below is against the usable area,
/// so it can be parked at the top of the screen without going under the menu bar.
fn dock_frame(monitor: &Monitor, size: LogicalSize<f64>, anchor: Anchor) -> Frame {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();

    // Physical -> logical. Secondary displays do not start at 0,0.
    let area_x = area.position.x as f64 / scale;
    let area_y = area.position.y as f64 / scale;
    let area_width = area.size.width as f64 / scale;
    let area_height = area.size.height as f64 / scale;

    match anchor {
        Anchor::TopCentre => Frame {
            x: (area_x + (area_width - size.width) / 2.0).round(),
            y: (area_y + TOP_GAP).round(),
            width: size.width,
            height: size.height,
        },
        // `.max(area_x)` and `.max(area_y)`, because a panel taller or wider than
        // the work area gives an upper bound below the lower one, and `clamp`
        // panics on that rather than picking a side.
        Anchor::Free { x, y } => Frame {
            x: x
                .clamp(area_x, (area_x + area_width - size.width).max(area_x))
                .round(),
            y: y
                .clamp(area_y, (area_y + area_height - size.height).max(area_y))
                .round(),
            width: size.width,
            height: size.height,
        },
    }
}

/// Re-class the window as a non-activating `NSPanel`. Once, at startup.
///
/// This is the only thing that gets the overlay onto another app's native-fullscreen
/// Space. Collection behaviour and window level are not enough — with
/// `CanJoinAllSpaces | FullScreenAuxiliary | CanJoinAllApplications` at level 101 and
/// an `orderOut`/`orderFrontRegardless` bounce every two seconds, the readback still
/// said `onActiveSpace=false` on every tick while VS Code was fullscreen. macOS
/// admits a window to another application's fullscreen Space based on what *kind* of
/// window it is, and the kind that qualifies is a non-activating panel.
///
/// `NSWindowStyleMaskNonactivatingPanel` is ignored on a plain `NSWindow`, which is
/// why the class has to change and not just the mask.
///
/// # What re-classing costs
///
/// tao's window is its own `NSWindow` subclass, and swapping the class discards its
/// overrides:
///
/// * `canBecomeKeyWindow` / `canBecomeMainWindow`, which returned tao's `focusable`
///   ivar. `NSPanel` answers for itself; a *non-activating* panel does not activate
///   the app when clicked, which is the property that actually mattered.
/// * `sendEvent:`, which existed only to forward background drags for
///   `movable_by_window_background`. This window is `decorations: false` and never
///   movable by background — `dock_frame` owns the position, and the drag support
///   above goes through `move_by` rather than AppKit's own window dragging.
/// * The `focusable` ivar itself no longer exists, so `tao::Window::set_focusable`
///   would be reading a field off a class that never declared it. Nothing calls it,
///   and nothing may start: it is not reachable from the four commands at the bottom
///   of this file, and the capability set does not grant the frontend any
///   window-mutating permission.
///
/// Instance size is safe: `NSPanel` adds no ivars over `NSWindow`, and the object was
/// allocated as `NSWindow` + one `Bool`.
#[cfg(target_os = "macos")]
fn promote_to_panel(window: &WebviewWindow) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        use objc2::runtime::AnyObject;
        use objc2::ClassType;
        use objc2_app_kit::{NSPanel, NSWindow, NSWindowStyleMask};

        let Ok(ptr) = window.ns_window() else { return };
        if ptr.is_null() {
            return;
        }

        // SAFETY: main thread, non-null NSWindow subclass instance, and NSPanel is a
        // subclass of NSWindow that declares no additional ivars.
        let obj: &AnyObject = unsafe { &*(ptr as *const AnyObject) };
        unsafe { AnyObject::set_class(obj, NSPanel::class()) };

        let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        // OR'd into the existing mask rather than replacing it: the window is
        // borderless and transparent, and that is expressed in this same mask.
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        // Panels default to hiding when their app deactivates, which for an overlay
        // whose app is *never* active would mean never being seen again.
        ns_window.setHidesOnDeactivate(false);

        // ponytail: tao re-sets the first responder after a style-mask change, for key
        // handling. Skipped — this window takes no keyboard input, and hover and
        // clicks reach the view under the pointer regardless of first responder.
    });
}

#[cfg(not(target_os = "macos"))]
fn promote_to_panel(_window: &WebviewWindow) {}

/// Tell the frontend when a click lands anywhere outside the overlay, so the
/// expanded card can close itself.
///
/// The click that closes the card happens in *another application*, so the webview
/// never receives it. The obvious hook — the window losing key status — does not
/// exist here: the overlay is a non-activating panel belonging to an Accessory app
/// that never activates, so it is never key in the first place (`key=false` in every
/// trace line, clicked or not).
///
/// A global monitor is the remaining option, and it happens to be exactly the right
/// predicate: it never sees its own application's events, so anything it reports is
/// by definition a click somewhere else. Mouse events need no Accessibility
/// permission — only keyboard monitoring does — so this costs the user no prompt.
#[cfg(target_os = "macos")]
fn watch_outside_clicks(window: &WebviewWindow) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2_app_kit::{NSEvent, NSEventMask};

        let handler = RcBlock::new(move |_event: core::ptr::NonNull<NSEvent>| {
            let _ = window.emit("overlay:blur", ());
        });

        let token = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown,
            &handler,
        );
        // Dropping the token unregisters the monitor, and this one lives as long as
        // the process does. One deliberately leaked object, not a growing leak.
        std::mem::forget(token);
    });
}

#[cfg(not(target_os = "macos"))]
fn watch_outside_clicks(_window: &WebviewWindow) {}

/// Force the window back above everything, including fullscreen Spaces.
///
/// Must run on the main thread — see the module header.
fn reassert(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSPopUpMenuWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowOcclusionState,
        };

        let Ok(ptr) = window.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

        // tao only sets CanJoinAllSpaces. A fullscreen app owns its own Space, so
        // without FullScreenAuxiliary the overlay vanishes exactly when it matters.
        //
        // These flags come from four independent groups, and each answers a different
        // question — which is why setting three of them left a gap:
        //   CanJoinAllSpaces       which Spaces may it appear on
        //   Stationary             does it move with the Space (Exposé)
        //   FullScreenAuxiliary    what about *our own* fullscreen window
        //   CanJoinAllApplications may it appear alongside *another app's* windows
        //   IgnoresCycle           keep a never-focusable window out of window cycling
        // Nothing said "another application", which is exactly the fullscreen case.
        // CanJoinAllApplications is macOS 13+; older versions ignore the unknown bit,
        // so it is safe against the 10.15 minimum in tauri.conf.json.
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::CanJoinAllApplications
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        // One band above NSStatusWindowLevel (25). The status band is where macOS
        // reshuffles windows as the menu bar reveals itself over a fullscreen Space;
        // 101 sits clear of that. Deliberately far below NSScreenSaverWindowLevel
        // (1000) and CGShieldingWindowLevel — the overlay must never be able to draw
        // over the screen saver or the lock screen.
        ns_window.setLevel(NSPopUpMenuWindowLevel);

        // The overlay is never the key window — it is an Accessory app that
        // deliberately does not activate — and a non-key window does not receive
        // mouse-moved events unless it asks for them. Without this, hovering the
        // capsule to expand it does nothing.
        ns_window.setAcceptsMouseMovedEvents(true);

        // Ordering a window out and straight back in re-associates it with the
        // current Space, and is the only repair for an overlay stranded on a Space
        // that no longer has focus.
        //
        // It is also destructive, so it needs an honest predicate for "am I actually
        // on screen", and two candidates are not:
        //
        //   `isVisible()`        true for a window nobody can see.
        //   `isOnActiveSpace()`  a CanJoinAllSpaces window answers true even while
        //                        stranded, so gating on it meant the repair never
        //                        ran in the case it was written for.
        //
        // Running it unconditionally instead is worse: in another app's fullscreen
        // Space the re-order does not always take, so a bounce every two seconds
        // evicts the overlay from the Space the user is looking at and leaves it out.
        //
        // `occlusionState` is AppKit's own answer to "is any part of this window
        // being displayed", and it agrees with what `CGWindowListCopyWindowInfo`
        // reports for the on-screen list — which is the ground truth the other two
        // disagree with.
        if !ns_window
            .occlusionState()
            .contains(NSWindowOcclusionState::Visible)
        {
            ns_window.orderOut(None);
            ns_window.orderFrontRegardless();
        }

        if std::env::var("AGENTPEEK_TRACE").is_ok() {
            // The frame is in the readback because "docked to the display the pointer
            // is on, not the one the fullscreen app is on" looks identical to
            // "invisible" from the outside, and only the origin tells them apart.
            // The class is here because `promote_to_panel` swallows its own failures —
            // it runs inside a main-thread closure whose errors go nowhere — so this
            // is the only evidence that the re-class actually happened.
            let class = unsafe { &*(ptr as *const objc2::runtime::AnyObject) }
                .class()
                .name()
                .to_string_lossy()
                .into_owned();
            eprintln!(
                "[reassert] class={class} key={} level={} behavior={:?} visible={} occlusion={:?} onActiveSpace={} frame={:?}",
                ns_window.isKeyWindow(),
                ns_window.level(),
                ns_window.collectionBehavior(),
                ns_window.isVisible(),
                ns_window.occlusionState(),
                ns_window.isOnActiveSpace(),
                ns_window.frame()
            );
        }
    }
    // Windows demotes a topmost window whenever another application claims
    // topmost for itself, and says nothing about it. The keepalive already runs
    // for macOS's sake, so repairing it here costs one `SetWindowPos` every two
    // seconds — and tao issues that with `SWP_NOACTIVATE`, so the heartbeat can
    // never steal focus from what you are typing into.
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_always_on_top(true);
}

// ── Commands: the entire surface the frontend is allowed to touch ────────────

#[tauri::command]
pub fn overlay_resize(overlay: tauri::State<'_, OverlayWindow>, width: f64, height: f64) {
    overlay.resize(width, height);
}

#[tauri::command]
pub fn overlay_move_by(overlay: tauri::State<'_, OverlayWindow>, dx: f64, dy: f64) {
    overlay.move_by(dx, dy);
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
