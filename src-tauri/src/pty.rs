use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::profile::{build_invocation, Profile};

/// Messages streamed to the frontend over a per-session channel.
#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum PtyMessage {
    /// Base64-encoded raw PTY output bytes.
    Data { data: String },
    /// The child process exited.
    Exit { code: i32 },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Lock the sessions map, recovering from a poisoned mutex so a panic in one
/// session's path cannot permanently disable every other terminal.
fn lock(m: &Mutex<HashMap<u32, Session>>) -> MutexGuard<'_, HashMap<u32, Session>> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Owns all live PTY sessions.
#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
    next_id: Arc<AtomicU32>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU32::new(1)),
        }
    }
}

impl PtyManager {
    pub fn create(
        &self,
        profile: &Profile,
        cols: u16,
        rows: u16,
        channel: Channel<PtyMessage>,
    ) -> Result<u32, String> {
        let size = PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| format!("openpty failed: {e}"))?;

        let inv = build_invocation(profile, cfg!(windows));
        let mut cmd = CommandBuilder::new(&inv.program);
        cmd.args(&inv.args);
        if let Some(cwd) = &inv.cwd {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed ({}): {e}", inv.program))?;
        // The slave handle is owned by the child now; drop our copy so EOF is
        // delivered to the reader when the child exits.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader failed: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer failed: {e}"))?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        lock(&self.sessions).insert(
            id,
            Session {
                master: pair.master,
                writer,
                child,
            },
        );

        // Reader thread: pump PTY output to the frontend, then reap on EOF.
        let sessions = Arc::clone(&self.sessions);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        if channel.send(PtyMessage::Data { data }).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let code = {
                let mut guard = lock(&sessions);
                guard
                    .remove(&id)
                    .and_then(|mut s| s.child.wait().ok())
                    .map(|status| status.exit_code() as i32)
                    .unwrap_or(0)
            };
            let _ = channel.send(PtyMessage::Exit { code });
        });

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut guard = lock(&self.sessions);
        let session = guard.get_mut(&id).ok_or("no such session")?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        session.writer.flush().ok();
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let guard = lock(&self.sessions);
        let session = guard.get(&id).ok_or("no such session")?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        // Remove first and drop the lock before killing/reaping so a slow wait
        // can't block other sessions' commands.
        let session = lock(&self.sessions).remove(&id);
        if let Some(mut session) = session {
            let _ = session.child.kill();
            // Reap so the killed child does not linger as a zombie (Unix).
            let _ = session.child.wait();
        }
        Ok(())
    }
}
