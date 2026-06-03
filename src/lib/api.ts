import { invoke, Channel, isTauri } from '@tauri-apps/api/core';
import type { AppData, Profile, SkillDiscovery } from './types';

/** Messages streamed from a backend PTY over a Tauri channel. */
export type PtyMessage =
  | { event: 'data'; data: string } // base64-encoded bytes
  | { event: 'exit'; code: number };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// --- persistence ---

export async function loadAppData(): Promise<AppData> {
  return invoke<AppData>('load_app_data');
}

export async function saveAppData(data: AppData): Promise<void> {
  await invoke('save_app_data', { data });
}

// --- skills ---

/**
 * Discover skills with zero manual configuration: the given manual roots plus
 * the host + WSL user skills dirs and the active project's `.claude/skills`.
 * WSL roots are scanned inside WSL so owner-only/symlinked skills resolve.
 * `projectPath` is the active project's path, or `null`.
 */
export async function discoverSkills(
  manualRoots: string[],
  projectPath: string | null,
): Promise<SkillDiscovery> {
  return invoke<SkillDiscovery>('discover_skills', { manualRoots, projectPath });
}

// --- terminal sessions ---

export interface SessionCallbacks {
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

/**
 * Spawn a PTY for the given profile. Returns the backend session id.
 * Output is streamed over a channel and dispatched to the callbacks.
 */
export async function createSession(
  profile: Profile,
  cols: number,
  rows: number,
  cb: SessionCallbacks,
): Promise<number> {
  const channel = new Channel<PtyMessage>();
  channel.onmessage = (msg) => {
    if (msg.event === 'data') cb.onData(base64ToBytes(msg.data));
    else cb.onExit(msg.code);
  };
  return invoke<number>('create_session', { profile, cols, rows, onEvent: channel });
}

export async function writeSession(id: number, data: string): Promise<void> {
  await invoke('write_session', { id, data });
}

export async function resizeSession(id: number, cols: number, rows: number): Promise<void> {
  await invoke('resize_session', { id, cols, rows });
}

export async function closeSession(id: number): Promise<void> {
  await invoke('close_session', { id });
}

// --- clipboard ---
// WebView2 gates `navigator.clipboard.readText()` far more strictly than writes,
// so in Tauri we go through the clipboard-manager plugin (loaded lazily so the
// standalone `vite` build doesn't pull it in). In standalone/browser mode there
// is no plugin, so we fall back to the web Clipboard API. Errors propagate to the
// caller, which decides whether a failed copy/paste is worth surfacing.

export async function clipboardWriteText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

export async function clipboardReadText(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return (await readText()) ?? '';
  }
  return navigator.clipboard.readText();
}
