// Smoke test: prove portable-pty round-trips bytes in this runtime by spawning
// a bash login shell (the same shape the Unix profile path uses), running a
// command, and asserting its output is captured. Run: `cargo run --example pty_smoke`.
use std::io::Read;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

fn main() {
    let pair = native_pty_system()
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .expect("openpty");

    // Mirrors build_invocation(profile{command:"echo …"}, windows=false).
    let mut cmd = CommandBuilder::new("bash");
    cmd.arg("-lic");
    cmd.arg("echo PTY_SMOKE_OK; exit 0");
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().expect("reader");

    // Resize works on the master.
    pair.master
        .resize(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
        .expect("resize");

    let mut out = String::new();
    let mut buf = [0u8; 4096];
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
        if std::time::Instant::now() > deadline {
            break;
        }
    }
    let _ = child.wait();

    if out.contains("PTY_SMOKE_OK") {
        println!("PTY_SMOKE_OK present — portable-pty streaming works");
    } else {
        eprintln!("FAIL: output did not contain marker:\n{out}");
        std::process::exit(1);
    }
}
