mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            storage::storage_get_current_workspace,
            storage::storage_list_recent_workspaces,
            storage::storage_open_workspace_dialog,
            storage::storage_create_workspace_dialog,
            storage::storage_write_text_file_dialog,
            storage::storage_switch_workspace,
            storage::storage_read_project_files,
            storage::storage_write_project_files,
            storage::storage_prepare_legacy_project_files,
            storage::storage_delete_legacy_project_files,
            storage::storage_read_user_data,
            storage::storage_compare_and_swap_user_data,
            storage::storage_write_user_field_asset,
            storage::storage_read_user_field_asset,
            storage::storage_delete_user_field_asset,
            storage::storage_read_field_asset,
            storage::storage_delete_field_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running BLine Web");
}
