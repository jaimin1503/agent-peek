import { Image } from '@tauri-apps/api/image';

/**
 * Menu bar icons: a ring at rest, filled when a session wants you.
 *
 * They are inlined base64 rather than files because they are ~300 bytes each
 * and this avoids an asset pipeline for two shapes. Both are black-with-alpha
 * and flagged as template images, so macOS recolours them for the current menu
 * bar appearance — the native convention, and the reason status colour stays in
 * the overlay where it can actually carry meaning.
 *
 * Regenerate with scripts/make-tray-icons.cjs if the shape changes.
 */

const IDLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAyklEQVR42u1X2w0EIQicQmxkC6GQa8RCLMRGLGTvxy8iGx94O7k4CV8GMzKAABwcvIMLQASQANzKUj27fkHkA6A0SFhWqo87AoA8QERbrne4QBaIaJOdZFI9DyqSYuTWMqnwQCR0+lvEpuTLTq8TI6eGq8lT/xapoeorDZlWkRotobvpuWjekZNdzTNuiI4VpTjjJI6EZOaxO+R6km2YkDf+j9DrktElNV3Z0zVGuq+D8nOlGz8oBzS6EZZyyKdcgygXRdpV+uBA4wuB5yykD943vgAAAABJRU5ErkJggg==';

const ACTIVE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAgklEQVR42u2WwQnAIAxF/yBdxEFc0kGySAZJLx5KoVBqUj7yH/yLeHjEaASEEEKk0QAMAA4gZnyutT9FDgB2kXiKzb2l9Bci9/TKysTHlFTKFoSsooFjMamNPhKERqaQJwh5plAkZV8huiOja2q6a0/3MFKODrrhSvn9oPygCSHE1pxy8f2tUoutvgAAAABJRU5ErkJggg==';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let idle: Image | null = null;
let active: Image | null = null;

export async function trayIcon(attention: boolean): Promise<Image> {
  if (attention) return (active ??= await Image.fromBytes(decode(ACTIVE_PNG)));
  return (idle ??= await Image.fromBytes(decode(IDLE_PNG)));
}
