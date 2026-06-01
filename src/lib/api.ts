import { invoke, Channel } from '@tauri-apps/api/core';
import type { AppData, Profile, Skill } from './types';

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

export async function scanSkills(roots: string[]): Promise<Skill[]> {
  return invoke<Skill[]>('scan_skills', { roots });
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
