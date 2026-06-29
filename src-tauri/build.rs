use std::fs;
use std::path::PathBuf;

fn main() {
    // Bake build-time secrets into the binary so users never see them.
    // Each entry: (rustc env-var emitted, file path relative to src-tauri/,
    // key inside that file).
    let secrets: &[(&str, &str, &str)] = &[
        // Kindle relay shared secret. The Worker's .env uses `SHARED_SECRET`
        // (that's the name `wrangler secret put` expects); the Rust side
        // sees it as `CS_KINDLE_RELAY_SECRET` to avoid colliding with any
        // generic env var.
        (
            "CS_KINDLE_RELAY_SECRET",
            "../workers/kindle/.env",
            "SHARED_SECRET",
        ),
        (
            "CS_ANDROID_VERSION_CODE",
            "gen/android/app/tauri.properties",
            "tauri.android.versionCode",
        ),
    ];

    for (env_var, source_rel, file_key) in secrets {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(source_rel);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(contents) = fs::read_to_string(&path) {
            for line in contents.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some(eq) = trimmed.find('=') {
                    let key = trimmed[..eq].trim();
                    let value =
                        trimmed[eq + 1..].trim().trim_matches(|c| c == '"' || c == '\'');
                    if key == *file_key {
                        println!("cargo:rustc-env={}={}", env_var, value);
                        break;
                    }
                }
            }
        }
    }

    tauri_build::build()
}
