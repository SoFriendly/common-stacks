mod commands;
mod config;
mod dedup;
mod downloads;
mod epub;
mod opds;
mod plugins;
mod state;
mod tls;

use state::AppState;
use tauri::Manager;

#[cfg(target_os = "android")]
fn init_rustls_android(app: &tauri::App) {
    // rustls-platform-verifier panics on first HTTPS request unless given the
    // JNI context. Tauri's webview exposes a JniHandle whose exec closure runs
    // on the webview thread with access to `&mut JNIEnv` and the activity.
    // We block setup briefly until the init completes so the first network
    // call from any thread already has a usable verifier.
    use std::sync::mpsc;
    let webview = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            tracing::warn!("init_rustls_android: no main webview window");
            return;
        }
    };
    let (tx, rx) = mpsc::channel::<()>();
    let _ = webview.with_webview(move |platform| {
        platform.jni_handle().exec(move |env, activity, _webview| {
            let activity_ref = unsafe { jni::objects::JObject::from_raw(activity.as_raw()) };
            match rustls_platform_verifier::android::init_with_env(env, activity_ref) {
                Ok(()) => tracing::info!("rustls-platform-verifier initialised for Android"),
                Err(e) => tracing::error!("rustls-platform-verifier init failed: {}", e),
            }
            let _ = tx.send(());
        });
    });
    let _ = rx.recv_timeout(std::time::Duration::from_secs(5));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "common_stacks_lib=info".into()),
        )
        .with_target(false)
        .compact()
        .try_init()
        .ok();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            config::init_paths(&app.handle())?;
            #[cfg(target_os = "android")]
            init_rustls_android(app);
            app.manage(AppState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::get_app_version_info,
            commands::add_source,
            commands::remove_source,
            commands::update_source,
            commands::reorder_sources,
            commands::validate_source,
            commands::fetch_feed,
            commands::search,
            commands::download_book,
            commands::list_downloads,
            commands::inspect_download,
            commands::open_download,
            commands::reveal_download,
            commands::delete_download,
            commands::rename_download,
            commands::get_download_dir,
            commands::set_download_dir,
            commands::export_config,
            commands::export_config_to_path,
            commands::import_config,
            commands::import_config_from_path,
            commands::read_enrichment_cache,
            commands::write_enrichment_cache,
            commands::list_plugins,
            commands::plugins_dir,
            commands::reveal_plugins_dir,
            commands::list_enrichers,
            commands::enrich_book,
            commands::list_send_targets,
            commands::get_send_target_settings,
            commands::save_send_target_settings,
            commands::set_send_target_enabled,
            commands::send_book,
            commands::fetch_kindle_relay_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
