use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Path to the persisted app-data JSON inside the OS app-config dir.
pub fn app_data_path(dir: &Path) -> PathBuf {
    dir.join("app-data.json")
}

/// Load persisted app data. Returns an empty object if nothing is stored yet
/// (the frontend fills in defaults).
pub fn load_app_data(config_dir: &Path) -> Value {
    let path = app_data_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default())),
        Err(_) => Value::Object(Default::default()),
    }
}

/// Persist app data atomically (temp file + rename).
pub fn save_app_data(config_dir: &Path, data: &Value) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let path = app_data_path(config_dir);
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&tmp, serialized).map_err(|e| format!("write failed: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
}

/// Parse a minimal flat YAML frontmatter block for `name` and `description`.
pub fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    // Body between the first and second `---` fences.
    let after = &trimmed[3..];
    let end = match after.find("\n---") {
        Some(i) => i,
        None => return (None, None),
    };
    let body = &after[..end];
    let mut name = None;
    let mut description = None;
    for line in body.lines() {
        let line = line.trim_end();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = unquote(val.trim());
            match key.as_str() {
                "name" => name = Some(val),
                "description" => description = Some(val),
                _ => {}
            }
        }
    }
    (name, description)
}

fn unquote(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// Scan one directory: each subdirectory containing a `SKILL.md` is a skill.
fn scan_dir(dir: &Path) -> Vec<Skill> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out, // missing dir is not an error
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if let Ok(content) = fs::read_to_string(&skill_file) {
            let (name, description) = parse_frontmatter(&content);
            let fallback = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            out.push(Skill {
                name: name.unwrap_or(fallback),
                description: description.unwrap_or_default(),
                path: skill_file.to_string_lossy().to_string(),
            });
        }
    }
    out
}

/// Discover skills across the given roots (deduped by path, sorted by name).
pub fn scan_skills(roots: &[String]) -> Vec<Skill> {
    let mut seen = std::collections::HashSet::new();
    let mut all: Vec<Skill> = Vec::new();
    for root in roots {
        if root.trim().is_empty() {
            continue;
        }
        for skill in scan_dir(Path::new(root)) {
            if seen.insert(skill.path.clone()) {
                all.push(skill);
            }
        }
    }
    all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn parses_name_and_description() {
        let md = "---\nname: my-skill\ndescription: Does a thing\nlevel: 3\n---\n# Body";
        let (n, d) = parse_frontmatter(md);
        assert_eq!(n.as_deref(), Some("my-skill"));
        assert_eq!(d.as_deref(), Some("Does a thing"));
    }

    #[test]
    fn handles_quoted_and_missing() {
        let (n, _) = parse_frontmatter("---\nname: \"quoted\"\n---\n");
        assert_eq!(n.as_deref(), Some("quoted"));
        assert_eq!(parse_frontmatter("no frontmatter"), (None, None));
    }

    #[test]
    fn scans_skill_dirs_and_ignores_missing() {
        let base = env::temp_dir().join(format!("mtc-skills-{}", std::process::id()));
        let skill = base.join("sample");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: sample\ndescription: A sample\n---\nbody",
        )
        .unwrap();
        fs::create_dir_all(base.join("not-a-skill")).unwrap();

        let skills = scan_skills(&[base.to_string_lossy().to_string(), "/no/such/dir".into()]);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "sample");
        assert_eq!(skills[0].description, "A sample");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = env::temp_dir().join(format!("mtc-data-{}", std::process::id()));
        let value = serde_json::json!({"todos": [{"id":"1","text":"x","done":false}]});
        save_app_data(&dir, &value).unwrap();
        let loaded = load_app_data(&dir);
        assert_eq!(loaded, value);
        fs::remove_dir_all(&dir).ok();
    }
}
