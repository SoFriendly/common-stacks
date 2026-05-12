mod commands;
mod config;
mod dedup;
mod downloads;
mod epub;
mod opds;
mod plugins;
mod state;

use state::AppState;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
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
            commands::reveal_download,
            commands::delete_download,
            commands::rename_download,
            commands::get_download_dir,
            commands::set_download_dir,
            commands::export_config,
            commands::import_config,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
