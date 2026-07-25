import { Image } from '@tauri-apps/api/image';

/**
 * Menu bar / notification area icons: a ring at rest, filled when a session
 * wants you.
 *
 * They are inlined base64 rather than files because they are ~300 bytes each
 * and this avoids an asset pipeline for four shapes.
 *
 * Two pairs, because only macOS recolours a template image for the current menu
 * bar appearance. The black pair is flagged as a template there; everywhere else
 * the bitmap is drawn as-is, and black-on-a-dark-taskbar is invisible, so those
 * platforms get the white pair. Status colour stays in the overlay either way,
 * where it can actually carry meaning.
 *
 * Regenerate all four with scripts/make-tray-icons.cjs if the shape changes.
 */

const IDLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAyklEQVR42u1X2w0EIQicQmxkC6GQa8RCLMRGLGTvxy8iGx94O7k4CV8GMzKAABwcvIMLQASQANzKUj27fkHkA6A0SFhWqo87AoA8QERbrne4QBaIaJOdZFI9DyqSYuTWMqnwQCR0+lvEpuTLTq8TI6eGq8lT/xapoeorDZlWkRotobvpuWjekZNdzTNuiI4VpTjjJI6EZOaxO+R6km2YkDf+j9DrktElNV3Z0zVGuq+D8nOlGz8oBzS6EZZyyKdcgygXRdpV+uBA4wuB5yykD943vgAAAABJRU5ErkJggg==';

const ACTIVE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAgklEQVR42u2WwQnAIAxF/yBdxEFc0kGySAZJLx5KoVBqUj7yH/yLeHjEaASEEEKk0QAMAA4gZnyutT9FDgB2kXiKzb2l9Bci9/TKysTHlFTKFoSsooFjMamNPhKERqaQJwh5plAkZV8huiOja2q6a0/3MFKODrrhSvn9oPygCSHE1pxy8f2tUoutvgAAAABJRU5ErkJggg==';

const IDLE_LIGHT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAA2ElEQVR42u2YzQ3DIAyFGYRFGIRBWIRBPAiLMMjrhVMKxBCnfWpjyScU9MnP8Q8OgGNy9wD9C1AAkAEI3k3aWfgEUAJQobfavjEH8gAK9q20O0yAIuwsXgWawUg794dIxkFuqaDOZBqBeKXMIzC/A1R2Qq6MclkFSkYwM6i0AlQ7Ml0tetIpCSqgsKL5gvdyMmiA8g3RGUUpa4DEMHfOckk0QHfINZNtGci6o/8e0Nclo0tqut+erjDStQ7K5ko3flAOaHQjLOWQT7kGUS6KtKv08/rxAB39BaVyTlVbFAuiAAAAAElFTkSuQmCC';

const ACTIVE_LIGHT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAh0lEQVR42u3WwQnAIAyFYQdxEQdxSQfJIhnk70XosbSN5VXywIt4+EBjUoCitEqCEpSgBP0Y1IABOGd87rUvQRUwrmPz7FJQ5376KlDleeoKkL0AWTSo8T4tEjQCQCMS5AEgjwRFZV+Q3JXJPWq5spf7GCVbh1xzlRw/JAe0nKkTlKAEbQ06AJZ8H20MtkAQAAAAAElFTkSuQmCC';

/**
 * ponytail: Windows exposes no "is the taskbar light or dark" signal the webview
 * can read — it is a separate setting from the app theme `prefers-color-scheme`
 * reports — so the white pair is a straight bet on the default dark taskbar.
 * Under a light one the icon washes out; the fix if anyone hits it is to read
 * `SystemUsesLightTheme` from the registry in Rust and expose it as a command.
 */
const TEMPLATE = navigator.userAgent.includes('Mac');

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let idle: Image | null = null;
let active: Image | null = null;

export async function trayIcon(attention: boolean): Promise<Image> {
  if (attention)
    return (active ??= await Image.fromBytes(
      decode(TEMPLATE ? ACTIVE_PNG : ACTIVE_LIGHT_PNG)
    ));
  return (idle ??= await Image.fromBytes(decode(TEMPLATE ? IDLE_PNG : IDLE_LIGHT_PNG)));
}

/** Whether the icons above are macOS template images. Drives `iconAsTemplate`. */
export const iconsAreTemplate = TEMPLATE;
