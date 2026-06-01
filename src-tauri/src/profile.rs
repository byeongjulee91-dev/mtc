use serde::{Deserialize, Serialize};

/// A launch profile, mirrored from the frontend `Profile` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub distro: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub keep_open: bool,
}

/// A concrete process invocation derived from a profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: String,
    pub args: Vec<String>,
    /// Working directory for the spawned process (host-side). `None` lets the
    /// child decide (on Windows the cwd is handled via `wsl --cd`).
    pub cwd: Option<String>,
}

/// Build the inner shell command that runs the profile's command and,
/// optionally, keeps an interactive login shell open afterwards.
fn inner_shell_args(profile: &Profile) -> Vec<String> {
    if profile.command.trim().is_empty() {
        // Just an interactive login shell.
        vec!["-l".to_string()]
    } else {
        // `command` is trusted user input authored in the profile editor; it is
        // composed verbatim into the shell script by design (the user is running
        // their own commands in their own WSL).
        let script = if profile.keep_open {
            format!("{}; exec bash -l", profile.command)
        } else {
            profile.command.clone()
        };
        vec!["-lic".to_string(), script]
    }
}

/// Compute the process invocation for a profile.
///
/// On Windows we enter WSL via `wsl.exe` (optionally `-d <distro>` and
/// `--cd <cwd>`), then run the command in a bash login shell. On Unix (used for
/// local development and for this Linux sandbox) we run bash directly so the
/// exact same PTY plumbing can be exercised without a Windows host.
pub fn build_invocation(profile: &Profile, windows: bool) -> Invocation {
    let shell_args = inner_shell_args(profile);
    if windows {
        let mut args: Vec<String> = Vec::new();
        if !profile.distro.trim().is_empty() {
            args.push("-d".to_string());
            args.push(profile.distro.clone());
        }
        if !profile.cwd.trim().is_empty() {
            args.push("--cd".to_string());
            args.push(profile.cwd.clone());
        }
        args.push("--".to_string());
        args.push("bash".to_string());
        args.extend(shell_args);
        Invocation {
            program: "wsl.exe".to_string(),
            args,
            cwd: None,
        }
    } else {
        let cwd = if profile.cwd.trim().is_empty() {
            None
        } else {
            Some(profile.cwd.clone())
        };
        Invocation {
            program: "bash".to_string(),
            args: shell_args,
            cwd,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(command: &str, keep_open: bool) -> Profile {
        Profile {
            id: "p".into(),
            name: "P".into(),
            color: "#fff".into(),
            distro: String::new(),
            cwd: String::new(),
            command: command.into(),
            keep_open,
        }
    }

    #[test]
    fn windows_shell_profile_enters_wsl_interactively() {
        let inv = build_invocation(&profile("", false), true);
        assert_eq!(inv.program, "wsl.exe");
        assert_eq!(inv.args, vec!["--", "bash", "-l"]);
        assert_eq!(inv.cwd, None);
    }

    #[test]
    fn windows_command_profile_runs_command_in_wsl() {
        let inv = build_invocation(&profile("claude", true), true);
        assert_eq!(inv.program, "wsl.exe");
        assert_eq!(
            inv.args,
            vec!["--", "bash", "-lic", "claude; exec bash -l"]
        );
    }

    #[test]
    fn windows_profile_includes_distro_and_cwd() {
        let mut p = profile("codex", false);
        p.distro = "Ubuntu".into();
        p.cwd = "~/work".into();
        let inv = build_invocation(&p, true);
        assert_eq!(
            inv.args,
            vec!["-d", "Ubuntu", "--cd", "~/work", "--", "bash", "-lic", "codex"]
        );
    }

    #[test]
    fn unix_command_profile_runs_bash_directly() {
        let mut p = profile("echo hi", true);
        p.cwd = "/tmp".into();
        let inv = build_invocation(&p, false);
        assert_eq!(inv.program, "bash");
        assert_eq!(inv.args, vec!["-lic", "echo hi; exec bash -l"]);
        assert_eq!(inv.cwd, Some("/tmp".to_string()));
    }

    #[test]
    fn unix_shell_profile_is_login_shell() {
        let inv = build_invocation(&profile("", false), false);
        assert_eq!(inv.program, "bash");
        assert_eq!(inv.args, vec!["-l"]);
    }
}
