use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceSummary {
    pub id: String,
    pub display_name: String,
    pub directory_path: String,
    pub updated_at: String,
    pub version: String,
}

/// One canonical, project-owned text file. `contents` is deliberately not parsed in
/// Rust: TypeScript owns the BLine schemas and can therefore surface and recover
/// malformed JSON without the desktop shell rewriting it first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTextFile {
    pub relative_path: String,
    pub contents: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTextFileSet {
    /// Opaque desktop storage locator. This is intentionally not a Project ID.
    pub directory_locator: String,
    pub files: Vec<ProjectTextFile>,
    /// Read-only migration inputs from the previous editor layout. These are never
    /// accepted as canonical write targets or rewritten while opening a Project.
    pub legacy_files: Vec<ProjectTextFile>,
    pub version: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTextFileWriteResult {
    /// Opaque desktop storage locator. This is intentionally not a Project ID.
    pub directory_locator: String,
    pub version: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldAssetPayload {
    pub file_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct FieldAssetMetadataFile {
    assets: std::collections::HashMap<String, FieldAssetMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct FieldAssetMetadata {
    file_name: Option<String>,
    mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
struct LegacyEditorStateFile {
    field_assets: std::collections::HashMap<String, FieldAssetMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct DesktopStorageState {
    current_project_dir: Option<String>,
    recent_project_dirs: Vec<String>,
    active_path_by_project_dir: std::collections::HashMap<String, String>,
}

const PROJECT_SAVE_TRANSACTION_DIR: &str = ".bline-save-transaction";
const PROJECT_SAVE_CLEANUP_DIR: &str = ".bline-save-cleanup";
const PROJECT_SAVE_TRANSACTION_MARKER: &str = "state";
const PROJECT_SAVE_SNAPSHOT_VERSION: &str = "version";
const PROJECT_SAVE_TRANSACTION_PREPARED: &str = "prepared";
const PROJECT_SAVE_TRANSACTION_COMMITTED: &str = "committed";
const LEGACY_CLEANUP_TRANSACTION_DIR: &str = ".bline-legacy-cleanup-transaction";
const LEGACY_CLEANUP_RETIRE_DIR: &str = ".bline-legacy-cleanup-retired";
const LEGACY_CLEANUP_EXPECTED_VERSION: &str = "expected-version";
const LEGACY_CLEANUP_FILE_MANIFEST: &str = "legacy-files.json";
const LEGACY_PROJECT_FILE_PATHS: [&str; 4] = [
    ".bline-web/field-assets.json",
    ".bline-web/path-metadata.json",
    ".bline-web/state.json",
    "pathgroups.json",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCleanupManifest {
    files: Vec<LegacyCleanupManifestEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCleanupManifestEntry {
    relative_path: String,
    content_hash: String,
}

#[tauri::command]
pub fn storage_get_current_workspace(
    app: AppHandle,
) -> Result<Option<ProjectWorkspaceSummary>, String> {
    let state = read_state(&app)?;
    let Some(dir) = state.current_project_dir else {
        return Ok(None);
    };

    let path = PathBuf::from(dir);
    if !path.is_dir() {
        return Ok(None);
    }

    workspace_summary(&path).map(Some)
}

#[tauri::command]
pub fn storage_list_recent_workspaces(
    app: AppHandle,
) -> Result<Vec<ProjectWorkspaceSummary>, String> {
    let mut state = read_state(&app)?;
    let mut summaries = Vec::new();
    let mut retained = Vec::new();

    for dir in state.recent_project_dirs {
        let path = PathBuf::from(&dir);
        if path.is_dir() {
            retained.push(dir);
            summaries.push(workspace_summary(&path)?);
        }
    }

    state.recent_project_dirs = retained;
    write_state(&app, &state)?;
    Ok(summaries)
}

#[tauri::command]
pub fn storage_open_workspace_dialog() -> Result<Option<ProjectWorkspaceSummary>, String> {
    let Some(selected) = pick_workspace_dir("Open BLine Project") else {
        return Ok(None);
    };

    workspace_summary(&effective_project_dir(&selected)).map(Some)
}

#[tauri::command]
pub fn storage_create_workspace_dialog() -> Result<Option<ProjectWorkspaceSummary>, String> {
    let Some(selected) = pick_workspace_dir("Create BLine Project in Empty Folder") else {
        return Ok(None);
    };

    let effective_dir = effective_project_dir(&selected);
    validate_new_workspace_dir(&effective_dir)?;
    workspace_summary(&effective_dir).map(Some)
}

#[tauri::command]
pub fn storage_write_text_file_dialog(
    title: String,
    default_file_name: String,
    contents: String,
) -> Result<bool, String> {
    let Some(selected) = rfd::FileDialog::new()
        .set_title(title)
        .set_file_name(default_file_name)
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(false);
    };

    fs::write(selected, contents).map_err(error_string)?;
    Ok(true)
}

#[tauri::command]
pub fn storage_switch_workspace(
    app: AppHandle,
    id: String,
) -> Result<Option<ProjectWorkspaceSummary>, String> {
    if id.trim().is_empty() {
        return Ok(None);
    }

    set_workspace_dir(&app, PathBuf::from(id)).map(Some)
}

/// Read the complete team-owned Project file set without interpreting its JSON.
///
/// Merely opening a directory is read-only. In particular, a legacy/runtime-only
/// folder does not gain `project.json`, `paths/`, or any desktop sidecar until the
/// caller explicitly saves a canonical file set.
#[tauri::command]
pub fn storage_read_project_files(
    app: AppHandle,
    directory_locator: Option<String>,
) -> Result<ProjectTextFileSet, String> {
    let dir = resolve_project_directory(&app, directory_locator.as_deref())?;
    read_project_text_file_set(&dir)
}

/// Atomically replace the complete team-owned Project file set supplied by
/// TypeScript. The bounded transaction contains exactly an old and new snapshot plus
/// a two-state marker; it is removed after success and is not a general journal.
#[tauri::command]
pub fn storage_write_project_files(
    app: AppHandle,
    directory_locator: Option<String>,
    files: Vec<ProjectTextFile>,
    expected: Option<String>,
) -> Result<ProjectTextFileWriteResult, String> {
    let dir = resolve_project_directory(&app, directory_locator.as_deref())?;
    write_project_text_file_set(&dir, &files, expected.as_deref())
}

/// Write the canonical snapshot used to migrate one explicitly identified legacy
/// Project. Unlike a normal save, this command must not change the desktop shell's
/// remembered current or recent Project while an asynchronous migration finishes.
#[tauri::command]
pub fn storage_prepare_legacy_project_files(
    directory_locator: String,
    files: Vec<ProjectTextFile>,
    expected: String,
) -> Result<ProjectTextFileWriteResult, String> {
    let dir = resolve_explicit_project_directory(&directory_locator)?;
    write_project_text_file_set(&dir, &files, Some(&expected))
}

/// Remove only the obsolete editor metadata that TypeScript has already migrated
/// into a successfully written canonical Project. Field assets and every other file
/// are outside this command's ownership boundary.
#[tauri::command]
pub fn storage_delete_legacy_project_files(
    directory_locator: String,
    expected: String,
) -> Result<ProjectTextFileWriteResult, String> {
    let dir = resolve_explicit_project_directory(&directory_locator)?;
    delete_legacy_project_files(&dir, &expected)
}

#[tauri::command]
pub fn storage_read_user_data(app: AppHandle) -> Result<Option<Value>, String> {
    let path = user_data_path(&app)?;
    if let Some(data) = read_recoverable_json(&path)? {
        return Ok(Some(data));
    }

    let legacy_state = read_state(&app)?;
    if legacy_state.active_path_by_project_dir.is_empty() {
        return Ok(None);
    }
    let project_views = legacy_state
        .active_path_by_project_dir
        .into_iter()
        .map(|(project_id, active_path_id)| {
            (project_id, json!({ "active_path_id": active_path_id }))
        })
        .collect::<serde_json::Map<String, Value>>();
    Ok(Some(json!({
        "schema_version": 1,
        "project_views": project_views
    })))
}

#[tauri::command]
pub fn storage_write_user_data(app: AppHandle, data: Value) -> Result<(), String> {
    write_recoverable_json(&user_data_path(&app)?, &data)
}

#[tauri::command]
pub fn storage_write_user_field_asset(
    app: AppHandle,
    entry_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    write_recoverable_bytes(&user_field_asset_path(&app, &entry_id)?, &bytes)
}

#[tauri::command]
pub fn storage_read_user_field_asset(
    app: AppHandle,
    entry_id: String,
) -> Result<Option<Vec<u8>>, String> {
    read_recoverable_bytes(&user_field_asset_path(&app, &entry_id)?)
}

#[tauri::command]
pub fn storage_delete_user_field_asset(app: AppHandle, entry_id: String) -> Result<(), String> {
    let path = user_field_asset_path(&app, &entry_id)?;
    for candidate in [
        path.clone(),
        sibling_path(&path, ".tmp"),
        sibling_path(&path, ".bak"),
    ] {
        if candidate.exists() {
            fs::remove_file(candidate).map_err(error_string)?;
        }
    }
    Ok(())
}

/// Migration-only access to Project-scoped field bytes. New field backgrounds live
/// in User Data and use the `storage_*_user_field_asset` commands instead.
#[tauri::command]
pub fn storage_read_field_asset(
    workspace_id: String,
    asset_id: String,
) -> Result<Option<FieldAssetPayload>, String> {
    let dir = PathBuf::from(workspace_id);
    read_field_asset_from_project_dir(&dir, &asset_id)
}

/// Delete Project-scoped bytes only after TypeScript has durably migrated them.
/// Legacy metadata remains untouched until guarded Project metadata cleanup.
#[tauri::command]
pub fn storage_delete_field_asset(workspace_id: String, asset_id: String) -> Result<(), String> {
    let dir = PathBuf::from(workspace_id);
    delete_field_asset_from_project_dir(&dir, &asset_id)
}

fn read_field_asset_from_project_dir(
    project_dir: &Path,
    asset_id: &str,
) -> Result<Option<FieldAssetPayload>, String> {
    let asset_id = safe_asset_file_name(asset_id)?;
    let path = field_asset_path(project_dir, &asset_id);
    if !path.exists() {
        return Ok(None);
    }

    let metadata = read_field_asset_metadata(project_dir, &asset_id)?;
    Ok(Some(FieldAssetPayload {
        file_name: metadata.file_name.unwrap_or_else(|| asset_id.clone()),
        mime_type: metadata
            .mime_type
            .unwrap_or_else(|| mime_type_for_asset(&asset_id)),
        bytes: fs::read(path).map_err(error_string)?,
    }))
}

fn delete_field_asset_from_project_dir(project_dir: &Path, asset_id: &str) -> Result<(), String> {
    let asset_id = safe_asset_file_name(asset_id)?;
    for path in [
        field_assets_dir(project_dir).join(&asset_id),
        legacy_field_assets_dir(project_dir).join(&asset_id),
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(error_string)?;
        }
    }
    Ok(())
}

fn resolve_project_directory(
    app: &AppHandle,
    directory_locator: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(locator) = directory_locator {
        // Explicit locators target an operation, not desktop session ownership.
        // Opening/switching a Project remembers it through set_workspace_dir only
        // after the caller has completed any required initial write.
        return resolve_explicit_project_directory(locator);
    }

    require_current_project_dir(app)
}

fn resolve_explicit_project_directory(directory_locator: &str) -> Result<PathBuf, String> {
    if directory_locator.trim().is_empty() {
        return Err("Desktop project directory locator is empty".to_owned());
    }
    Ok(effective_project_dir(Path::new(directory_locator)))
}

fn read_project_text_file_set(project_dir: &Path) -> Result<ProjectTextFileSet, String> {
    if !project_dir.is_dir() {
        return Err(format!(
            "Desktop project directory does not exist: {}",
            project_dir.to_string_lossy()
        ));
    }

    recover_project_file_transaction(project_dir)?;
    recover_legacy_cleanup_transaction(project_dir, None)?;
    let files = read_managed_project_files(project_dir)?;
    let legacy_files = read_legacy_project_files(project_dir)?;
    Ok(ProjectTextFileSet {
        directory_locator: project_dir.to_string_lossy().to_string(),
        version: project_source_file_set_version(&files, &legacy_files),
        updated_at: project_source_file_set_updated_at(project_dir, &files, &legacy_files),
        files,
        legacy_files,
    })
}

fn write_project_text_file_set(
    project_dir: &Path,
    files: &[ProjectTextFile],
    expected: Option<&str>,
) -> Result<ProjectTextFileWriteResult, String> {
    if !project_dir.is_dir() {
        return Err(format!(
            "Desktop project directory does not exist: {}",
            project_dir.to_string_lossy()
        ));
    }

    let canonical_files = validate_complete_project_file_set(files)?;
    recover_project_file_transaction(project_dir)?;
    recover_legacy_cleanup_transaction(project_dir, None)?;

    let current_files = read_managed_project_files(project_dir)?;
    let current_legacy_files = read_legacy_project_files(project_dir)?;
    let actual_version = project_source_file_set_version(&current_files, &current_legacy_files);
    if let Some(expected) = expected {
        if expected != actual_version {
            return Err("storage-conflict: project file-set version mismatch".to_owned());
        }
    }

    let transaction_dir = project_dir.join(PROJECT_SAVE_TRANSACTION_DIR);
    let old_dir = transaction_dir.join("old");
    let new_dir = transaction_dir.join("new");
    fs::create_dir(&transaction_dir).map_err(error_string)?;

    let transaction_result = (|| {
        write_project_snapshot(&old_dir, &current_files)?;
        write_project_snapshot(&new_dir, &canonical_files)?;

        // Staging may take long enough for an external editor to save. Recheck just
        // before the prepared marker makes the replacement live so that such a save
        // is not silently overwritten by our older snapshot.
        let staged_against_version = project_source_file_set_version(
            &read_managed_project_files(project_dir)?,
            &read_legacy_project_files(project_dir)?,
        );
        if staged_against_version != actual_version {
            return Err("storage-conflict: project file set changed while saving".to_owned());
        }
        write_transaction_marker(&transaction_dir, PROJECT_SAVE_TRANSACTION_PREPARED)?;

        // The prepared marker only protects recovery once the transaction
        // directory entry itself is durable in its parent. Flush that entry before
        // installation removes any live Project files.
        sync_directory(project_dir)?;

        install_project_snapshot(project_dir, &new_dir)?;
        write_transaction_marker(&transaction_dir, PROJECT_SAVE_TRANSACTION_COMMITTED)?;
        retire_project_file_transaction(project_dir, &transaction_dir)?;
        Ok(())
    })();

    if let Err(error) = transaction_result {
        // Leave a prepared/committed transaction in place when installation began;
        // the next read or write deterministically restores one complete side.
        if !transaction_dir
            .join(PROJECT_SAVE_TRANSACTION_MARKER)
            .exists()
        {
            let _ = fs::remove_dir_all(&transaction_dir);
        }
        return Err(error);
    }

    let saved_files = read_managed_project_files(project_dir)?;
    let saved_legacy_files = read_legacy_project_files(project_dir)?;
    if saved_files != canonical_files {
        return Err("Project file-set verification failed after save".to_owned());
    }
    Ok(ProjectTextFileWriteResult {
        directory_locator: project_dir.to_string_lossy().to_string(),
        version: project_source_file_set_version(&saved_files, &saved_legacy_files),
        updated_at: project_source_file_set_updated_at(
            project_dir,
            &saved_files,
            &saved_legacy_files,
        ),
    })
}

fn delete_legacy_project_files(
    project_dir: &Path,
    expected: &str,
) -> Result<ProjectTextFileWriteResult, String> {
    if !project_dir.is_dir() {
        return Err(format!(
            "Desktop project directory does not exist: {}",
            project_dir.to_string_lossy()
        ));
    }
    if expected.trim().is_empty() {
        return Err("Legacy metadata cleanup requires an expected version".to_owned());
    }

    recover_project_file_transaction(project_dir)?;
    if recover_legacy_cleanup_transaction(project_dir, Some(expected))? {
        return legacy_cleanup_result(project_dir);
    }
    let canonical_files = read_managed_project_files(project_dir)?;
    validate_complete_project_file_set(&canonical_files).map_err(|_| {
        "Legacy metadata cleanup requires a complete canonical Project save".to_owned()
    })?;
    let legacy_files = read_legacy_project_files(project_dir)?;
    if project_source_file_set_version(&canonical_files, &legacy_files) != expected {
        return Err("storage-conflict: project file set changed before legacy cleanup".to_owned());
    }

    let transaction_dir = project_dir.join(LEGACY_CLEANUP_TRANSACTION_DIR);
    fs::create_dir(&transaction_dir).map_err(error_string)?;
    write_synced_text(
        &transaction_dir.join(LEGACY_CLEANUP_EXPECTED_VERSION),
        expected,
    )?;
    write_legacy_cleanup_manifest(&transaction_dir, &legacy_files)?;
    let staged_version = project_source_file_set_version(
        &read_managed_project_files(project_dir)?,
        &read_legacy_project_files(project_dir)?,
    );
    if staged_version != expected {
        let _ = fs::remove_dir_all(&transaction_dir);
        return Err("storage-conflict: project file set changed before legacy cleanup".to_owned());
    }
    write_transaction_marker(&transaction_dir, PROJECT_SAVE_TRANSACTION_PREPARED)?;
    sync_directory(&transaction_dir)?;
    sync_directory(project_dir)?;
    finish_legacy_cleanup_transaction(project_dir, &transaction_dir)?;
    legacy_cleanup_result(project_dir)
}

fn recover_legacy_cleanup_transaction(
    project_dir: &Path,
    expected: Option<&str>,
) -> Result<bool, String> {
    remove_legacy_cleanup_retire_dir(project_dir)?;
    let transaction_dir = project_dir.join(LEGACY_CLEANUP_TRANSACTION_DIR);
    if !transaction_dir.exists() {
        return Ok(false);
    }
    let marker = transaction_dir.join(PROJECT_SAVE_TRANSACTION_MARKER);
    if !marker.is_file() {
        retire_legacy_cleanup_transaction(project_dir, &transaction_dir)?;
        return Ok(false);
    }
    let prepared_expected =
        fs::read_to_string(transaction_dir.join(LEGACY_CLEANUP_EXPECTED_VERSION))
            .map_err(|_| "Legacy cleanup transaction is missing its expected version".to_owned())?;
    let state = fs::read_to_string(&marker).map_err(error_string)?;
    if state == PROJECT_SAVE_TRANSACTION_COMMITTED {
        retire_legacy_cleanup_transaction(project_dir, &transaction_dir)?;
    } else {
        finish_legacy_cleanup_transaction(project_dir, &transaction_dir)?;
    }
    Ok(expected.is_some_and(|value| value == prepared_expected))
}

fn finish_legacy_cleanup_transaction(
    project_dir: &Path,
    transaction_dir: &Path,
) -> Result<(), String> {
    let manifest = read_legacy_cleanup_manifest(transaction_dir)?;
    validate_legacy_cleanup_manifest(project_dir, &manifest)?;
    for relative_path in LEGACY_PROJECT_FILE_PATHS {
        let path = project_dir.join(relative_path);
        if path.is_file() {
            validate_legacy_cleanup_file(&path, relative_path, &manifest)?;
            fs::remove_file(path).map_err(error_string)?;
        }
    }

    let legacy_dir = project_dir.join(".bline-web");
    if legacy_dir.is_dir() {
        if fs::read_dir(&legacy_dir)
            .map_err(error_string)?
            .next()
            .is_none()
        {
            fs::remove_dir(&legacy_dir).map_err(error_string)?;
        } else {
            sync_directory(&legacy_dir)?;
        }
    }
    sync_directory(project_dir)?;
    if !read_legacy_project_files(project_dir)?.is_empty() {
        return Err("Legacy project metadata cleanup verification failed".to_owned());
    }
    write_transaction_marker(transaction_dir, PROJECT_SAVE_TRANSACTION_COMMITTED)?;
    retire_legacy_cleanup_transaction(project_dir, transaction_dir)
}

fn write_legacy_cleanup_manifest(
    transaction_dir: &Path,
    legacy_files: &[ProjectTextFile],
) -> Result<(), String> {
    let manifest = LegacyCleanupManifest {
        files: legacy_files
            .iter()
            .map(|file| LegacyCleanupManifestEntry {
                relative_path: file.relative_path.clone(),
                content_hash: project_source_file_set_version(std::slice::from_ref(file), &[]),
            })
            .collect(),
    };
    let contents = serde_json::to_string(&manifest).map_err(error_string)?;
    write_synced_text(
        &transaction_dir.join(LEGACY_CLEANUP_FILE_MANIFEST),
        &contents,
    )
}

fn read_legacy_cleanup_manifest(transaction_dir: &Path) -> Result<LegacyCleanupManifest, String> {
    let contents = fs::read_to_string(transaction_dir.join(LEGACY_CLEANUP_FILE_MANIFEST))
        .map_err(|_| "Legacy cleanup transaction is missing its file manifest".to_owned())?;
    let manifest: LegacyCleanupManifest = serde_json::from_str(&contents)
        .map_err(|_| "Legacy cleanup transaction file manifest is invalid".to_owned())?;
    let mut seen = std::collections::HashSet::new();
    if manifest.files.iter().any(|file| {
        !LEGACY_PROJECT_FILE_PATHS.contains(&file.relative_path.as_str())
            || !seen.insert(file.relative_path.as_str())
    }) {
        return Err("Legacy cleanup transaction file manifest is invalid".to_owned());
    }
    Ok(manifest)
}

fn validate_legacy_cleanup_manifest(
    project_dir: &Path,
    manifest: &LegacyCleanupManifest,
) -> Result<(), String> {
    for file in read_legacy_project_files(project_dir)? {
        validate_legacy_cleanup_contents(&file, manifest)?;
    }
    Ok(())
}

fn validate_legacy_cleanup_file(
    path: &Path,
    relative_path: &str,
    manifest: &LegacyCleanupManifest,
) -> Result<(), String> {
    let contents = fs::read_to_string(path).map_err(error_string)?;
    validate_legacy_cleanup_contents(
        &ProjectTextFile {
            relative_path: relative_path.to_owned(),
            contents,
        },
        manifest,
    )
}

fn validate_legacy_cleanup_contents(
    file: &ProjectTextFile,
    manifest: &LegacyCleanupManifest,
) -> Result<(), String> {
    let content_hash = project_source_file_set_version(std::slice::from_ref(file), &[]);
    if !manifest.files.iter().any(|prepared| {
        prepared.relative_path == file.relative_path && prepared.content_hash == content_hash
    }) {
        return Err(
            "storage-conflict: legacy metadata changed after cleanup was prepared".to_owned(),
        );
    }
    Ok(())
}

fn legacy_cleanup_result(project_dir: &Path) -> Result<ProjectTextFileWriteResult, String> {
    let canonical_files = read_managed_project_files(project_dir)?;
    let remaining_legacy_files = read_legacy_project_files(project_dir)?;
    if !remaining_legacy_files.is_empty() {
        return Err("Legacy project metadata cleanup verification failed".to_owned());
    }
    Ok(ProjectTextFileWriteResult {
        directory_locator: project_dir.to_string_lossy().to_string(),
        version: project_source_file_set_version(&canonical_files, &remaining_legacy_files),
        updated_at: project_source_file_set_updated_at(
            project_dir,
            &canonical_files,
            &remaining_legacy_files,
        ),
    })
}

fn retire_legacy_cleanup_transaction(
    project_dir: &Path,
    transaction_dir: &Path,
) -> Result<(), String> {
    let retired = project_dir.join(LEGACY_CLEANUP_RETIRE_DIR);
    if retired.exists() {
        fs::remove_dir_all(&retired).map_err(error_string)?;
    }
    fs::rename(transaction_dir, &retired).map_err(error_string)?;
    sync_directory(project_dir)?;
    let _ = fs::remove_dir_all(&retired);
    Ok(())
}

fn remove_legacy_cleanup_retire_dir(project_dir: &Path) -> Result<(), String> {
    let retired = project_dir.join(LEGACY_CLEANUP_RETIRE_DIR);
    if retired.exists() {
        fs::remove_dir_all(&retired).map_err(error_string)?;
        sync_directory(project_dir)?;
    }
    Ok(())
}

fn write_synced_text(path: &Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::File::create(path).map_err(error_string)?;
    file.write_all(contents.as_bytes()).map_err(error_string)?;
    file.sync_all().map_err(error_string)
}

fn validate_complete_project_file_set(
    files: &[ProjectTextFile],
) -> Result<Vec<ProjectTextFile>, String> {
    let mut validated = Vec::with_capacity(files.len());
    let mut seen = std::collections::HashSet::new();
    let mut has_config = false;
    let mut has_project = false;

    for file in files {
        validate_managed_project_relative_path(&file.relative_path)?;
        if !seen.insert(file.relative_path.clone()) {
            return Err(format!(
                "Duplicate project file in canonical set: {}",
                file.relative_path
            ));
        }
        has_config |= file.relative_path == "config.json";
        has_project |= file.relative_path == "project.json";
        validated.push(file.clone());
    }

    if !has_config || !has_project {
        return Err(
            "A complete project file set must include config.json and project.json".to_owned(),
        );
    }

    validated.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(validated)
}

fn validate_managed_project_relative_path(relative_path: &str) -> Result<(), String> {
    if matches!(relative_path, "config.json" | "project.json") {
        return Ok(());
    }

    let Some(file_name) = relative_path.strip_prefix("paths/") else {
        return Err(format!(
            "Unsupported canonical project file path: {relative_path}"
        ));
    };
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
        || !file_name.ends_with(".json")
    {
        return Err(format!(
            "Unsafe canonical project file path: {relative_path}"
        ));
    }
    Ok(())
}

fn read_managed_project_files(project_dir: &Path) -> Result<Vec<ProjectTextFile>, String> {
    let mut relative_paths = Vec::new();
    for relative_path in ["config.json", "project.json"] {
        if project_dir.join(relative_path).is_file() {
            relative_paths.push(relative_path.to_owned());
        }
    }

    let paths_dir = project_dir.join("paths");
    if paths_dir.is_dir() {
        for entry in fs::read_dir(&paths_dir).map_err(error_string)? {
            let entry = entry.map_err(error_string)?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let relative_path = format!("paths/{file_name}");
                validate_managed_project_relative_path(&relative_path)?;
                relative_paths.push(relative_path);
            }
        }
    }
    relative_paths.sort();

    relative_paths
        .into_iter()
        .map(|relative_path| {
            let bytes = fs::read(project_dir.join(&relative_path)).map_err(error_string)?;
            let contents = String::from_utf8(bytes).map_err(|_| {
                format!("Project file is not valid UTF-8 and was left untouched: {relative_path}")
            })?;
            Ok(ProjectTextFile {
                relative_path,
                contents,
            })
        })
        .collect()
}

fn read_legacy_project_files(project_dir: &Path) -> Result<Vec<ProjectTextFile>, String> {
    let mut files = Vec::new();
    for relative_path in LEGACY_PROJECT_FILE_PATHS {
        let path = project_dir.join(relative_path);
        if !path.is_file() {
            continue;
        }
        let bytes = fs::read(&path).map_err(error_string)?;
        let contents = String::from_utf8(bytes).map_err(|_| {
            format!(
                "Legacy project file is not valid UTF-8 and was left untouched: {relative_path}"
            )
        })?;
        files.push(ProjectTextFile {
            relative_path: relative_path.to_owned(),
            contents,
        });
    }
    Ok(files)
}

fn write_project_snapshot(snapshot_dir: &Path, files: &[ProjectTextFile]) -> Result<(), String> {
    fs::create_dir(snapshot_dir).map_err(error_string)?;
    let mut ordered_files = files.to_vec();
    ordered_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    for file in &ordered_files {
        let destination = snapshot_dir.join(&file.relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(error_string)?;
        }
        let handle = fs::File::create(&destination).map_err(error_string)?;
        use std::io::Write;
        let mut handle = handle;
        handle
            .write_all(file.contents.as_bytes())
            .map_err(error_string)?;
        handle.sync_all().map_err(error_string)?;
    }
    let paths_dir = snapshot_dir.join("paths");
    if paths_dir.is_dir() {
        sync_directory(&paths_dir)?;
    }
    let mut version =
        fs::File::create(snapshot_dir.join(PROJECT_SAVE_SNAPSHOT_VERSION)).map_err(error_string)?;
    use std::io::Write;
    version
        .write_all(project_source_file_set_version(&ordered_files, &[]).as_bytes())
        .map_err(error_string)?;
    version.sync_all().map_err(error_string)?;
    sync_directory(snapshot_dir)
}

fn write_transaction_marker(transaction_dir: &Path, state: &str) -> Result<(), String> {
    let marker = transaction_dir.join(PROJECT_SAVE_TRANSACTION_MARKER);
    let mut file = fs::File::create(marker).map_err(error_string)?;
    use std::io::Write;
    file.write_all(state.as_bytes()).map_err(error_string)?;
    file.sync_all().map_err(error_string)?;
    sync_directory(transaction_dir)
}

fn recover_project_file_transaction(project_dir: &Path) -> Result<(), String> {
    remove_project_file_transaction_cleanup(project_dir)?;
    let transaction_dir = project_dir.join(PROJECT_SAVE_TRANSACTION_DIR);
    if !transaction_dir.exists() {
        return Ok(());
    }

    let marker = transaction_dir.join(PROJECT_SAVE_TRANSACTION_MARKER);
    if !marker.is_file() {
        // No marker means installation never began, so the live directory is still
        // the complete old set and the incomplete staging area is disposable.
        return retire_project_file_transaction(project_dir, &transaction_dir);
    }

    let state = fs::read_to_string(&marker).map_err(error_string)?;
    let snapshot = if state == PROJECT_SAVE_TRANSACTION_COMMITTED {
        transaction_dir.join("new")
    } else {
        // A prepared or torn marker conservatively resolves to the old set.
        transaction_dir.join("old")
    };
    install_project_snapshot(project_dir, &snapshot)?;
    retire_project_file_transaction(project_dir, &transaction_dir)
}

fn install_project_snapshot(project_dir: &Path, snapshot_dir: &Path) -> Result<(), String> {
    // Read and verify the entire snapshot before touching live files. A torn or
    // partially cleaned snapshot can therefore never cause a complete live Project
    // to be deleted during recovery.
    let snapshot_files = read_validated_project_snapshot(snapshot_dir)?;
    remove_live_managed_project_files(project_dir)?;

    // Install the runtime files first. project.json is the commit point visible to
    // readers and is therefore always installed last.
    for file in snapshot_files
        .iter()
        .filter(|file| file.relative_path != "project.json")
    {
        install_snapshot_file(project_dir, file)?;
    }
    if let Some(project_file) = snapshot_files
        .iter()
        .find(|file| file.relative_path == "project.json")
    {
        install_snapshot_file(project_dir, project_file)?;
    }
    let paths_dir = project_dir.join("paths");
    if paths_dir.is_dir() {
        sync_directory(&paths_dir)?;
    }
    sync_directory(project_dir)
}

fn read_validated_project_snapshot(snapshot_dir: &Path) -> Result<Vec<ProjectTextFile>, String> {
    if !snapshot_dir.is_dir() {
        return Err("Project save transaction is missing its recovery snapshot".to_owned());
    }
    let expected = fs::read_to_string(snapshot_dir.join(PROJECT_SAVE_SNAPSHOT_VERSION))
        .map_err(|_| "Project save transaction snapshot is incomplete".to_owned())?;
    let files = read_managed_project_files(snapshot_dir)?;
    if project_source_file_set_version(&files, &[]) != expected {
        return Err("Project save transaction snapshot failed validation".to_owned());
    }
    Ok(files)
}

fn retire_project_file_transaction(
    project_dir: &Path,
    transaction_dir: &Path,
) -> Result<(), String> {
    let cleanup_dir = project_dir.join(PROJECT_SAVE_CLEANUP_DIR);
    if cleanup_dir.exists() {
        fs::remove_dir_all(&cleanup_dir).map_err(error_string)?;
    }
    fs::rename(transaction_dir, &cleanup_dir).map_err(error_string)?;
    // Once the atomic rename is durable, cleanup residue is ignored by recovery and
    // can never be mistaken for an authoritative old/new snapshot.
    sync_directory(project_dir)?;
    let _ = fs::remove_dir_all(&cleanup_dir);
    Ok(())
}

fn remove_project_file_transaction_cleanup(project_dir: &Path) -> Result<(), String> {
    let cleanup_dir = project_dir.join(PROJECT_SAVE_CLEANUP_DIR);
    if cleanup_dir.exists() {
        fs::remove_dir_all(cleanup_dir).map_err(error_string)?;
        sync_directory(project_dir)?;
    }
    Ok(())
}

fn install_snapshot_file(project_dir: &Path, file: &ProjectTextFile) -> Result<(), String> {
    let destination = project_dir.join(&file.relative_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(error_string)?;
    }
    let mut handle = fs::File::create(destination).map_err(error_string)?;
    use std::io::Write;
    handle
        .write_all(file.contents.as_bytes())
        .map_err(error_string)?;
    handle.sync_all().map_err(error_string)
}

fn remove_live_managed_project_files(project_dir: &Path) -> Result<(), String> {
    for path in [
        project_dir.join("config.json"),
        project_dir.join("project.json"),
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(error_string)?;
        }
    }

    let paths_dir = project_dir.join("paths");
    if paths_dir.is_dir() {
        for entry in fs::read_dir(&paths_dir).map_err(error_string)? {
            let entry = entry.map_err(error_string)?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                fs::remove_file(path).map_err(error_string)?;
            }
        }
    }
    Ok(())
}

fn project_source_file_set_version(
    files: &[ProjectTextFile],
    legacy_files: &[ProjectTextFile],
) -> String {
    // Stable FNV-1a over relative paths and exact UTF-8 bytes. The directory locator
    // is intentionally excluded: moving a Project does not change its content token.
    let mut hash = 0xcbf29ce484222325_u64;
    for file in files.iter().chain(legacy_files) {
        for byte in file
            .relative_path
            .as_bytes()
            .iter()
            .chain([0_u8].iter())
            .chain(file.contents.as_bytes())
            .chain([0xff_u8].iter())
        {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

fn project_source_file_set_updated_at(
    project_dir: &Path,
    files: &[ProjectTextFile],
    legacy_files: &[ProjectTextFile],
) -> String {
    files
        .iter()
        .chain(legacy_files)
        .filter_map(|file| {
            fs::metadata(project_dir.join(&file.relative_path))
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
        })
        .max()
        .unwrap_or(0)
        .to_string()
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        return fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(error_string);
    }

    #[cfg(not(windows))]
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(error_string)
}

fn pick_workspace_dir(title: &str) -> Option<PathBuf> {
    rfd::FileDialog::new().set_title(title).pick_folder()
}

fn set_workspace_dir(
    app: &AppHandle,
    selected_dir: PathBuf,
) -> Result<ProjectWorkspaceSummary, String> {
    let effective_dir = effective_project_dir(&selected_dir);
    let summary = workspace_summary(&effective_dir)?;
    remember_workspace_dir(app, &effective_dir)?;
    Ok(summary)
}

fn remember_workspace_dir(app: &AppHandle, effective_dir: &Path) -> Result<(), String> {
    if !effective_dir.is_dir() {
        return Err(format!(
            "Desktop project directory does not exist: {}",
            effective_dir.to_string_lossy()
        ));
    }

    let mut state = read_state(app)?;
    let dir_string = effective_dir.to_string_lossy().to_string();
    state.current_project_dir = Some(dir_string.clone());
    state
        .recent_project_dirs
        .retain(|entry| entry != &dir_string);
    state.recent_project_dirs.insert(0, dir_string);
    state.recent_project_dirs.truncate(10);
    write_state(app, &state)
}

fn effective_project_dir(selected_dir: &Path) -> PathBuf {
    let selected = absolutize(selected_dir);

    // Guard against opening the `paths` subfolder of an existing project as its own
    // project. Doing so used to create a nested paths/paths tree and a stray
    // config.json, and showed an empty path list ("my paths are gone"). If the picked
    // folder is the `paths` child of a real BLine project, open the project instead.
    if selected.file_name().and_then(|name| name.to_str()) == Some("paths") {
        if let Some(parent) = selected.parent() {
            if is_bline_project_dir(parent) {
                return parent.to_path_buf();
            }
        }
    }

    if selected.file_name().and_then(|name| name.to_str()) == Some("autos") {
        return selected;
    }

    let deploy_dir = selected.join("src").join("main").join("deploy");
    if deploy_dir.is_dir() {
        return deploy_dir.join("autos");
    }

    selected
}

fn validate_new_workspace_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_dir() {
        return Err(format!(
            "Desktop project directory does not exist: {}",
            dir.to_string_lossy()
        ));
    }
    if fs::read_dir(dir).map_err(error_string)?.next().is_some() {
        return Err(
            "Create Project requires an empty folder; use Open Project Folder for an existing project"
                .to_owned(),
        );
    }
    Ok(())
}

/// A directory looks like a BLine project when it holds a `config.json` alongside a
/// `paths` folder.
fn is_bline_project_dir(dir: &Path) -> bool {
    dir.join("config.json").is_file() && dir.join("paths").is_dir()
}

fn require_current_project_dir(app: &AppHandle) -> Result<PathBuf, String> {
    current_project_dir(app)?.ok_or_else(|| {
        "No desktop project folder is open. Use Project > Open Project Folder first.".to_owned()
    })
}

fn current_project_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    Ok(read_state(app)?
        .current_project_dir
        .map(PathBuf::from)
        .filter(|dir| dir.is_dir()))
}

fn workspace_summary(path: &Path) -> Result<ProjectWorkspaceSummary, String> {
    let display_name = workspace_display_name(path);
    let directory_path = path.to_string_lossy().to_string();
    let file_set = read_project_text_file_set(path)?;

    Ok(ProjectWorkspaceSummary {
        id: directory_path.clone(),
        display_name,
        directory_path,
        updated_at: file_set.updated_at,
        version: file_set.version,
    })
}

fn workspace_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("autos")
        .to_owned()
}

fn editor_state_file(project_dir: &Path) -> PathBuf {
    project_dir.join(".bline-web").join("state.json")
}

fn field_assets_dir(project_dir: &Path) -> PathBuf {
    project_dir.join(".bline-web").join("assets").join("fields")
}

fn legacy_field_assets_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("assets").join("fields")
}

fn field_asset_path(project_dir: &Path, asset_id: &str) -> PathBuf {
    let path = field_assets_dir(project_dir).join(asset_id);
    if path.exists() {
        path
    } else {
        legacy_field_assets_dir(project_dir).join(asset_id)
    }
}

fn field_asset_metadata_file(project_dir: &Path) -> PathBuf {
    project_dir.join(".bline-web").join("field-assets.json")
}

fn read_field_asset_metadata_file(project_dir: &Path) -> Result<FieldAssetMetadataFile, String> {
    let mut metadata = read_legacy_field_asset_metadata_file(project_dir)?;
    let state_path = editor_state_file(project_dir);
    if state_path.is_file() {
        let raw = fs::read_to_string(state_path).map_err(error_string)?;
        let state: LegacyEditorStateFile = serde_json::from_str(&raw).map_err(error_string)?;
        metadata.assets.extend(state.field_assets);
    }
    Ok(metadata)
}

fn read_legacy_field_asset_metadata_file(
    project_dir: &Path,
) -> Result<FieldAssetMetadataFile, String> {
    let path = field_asset_metadata_file(project_dir);
    if !path.is_file() {
        return Ok(FieldAssetMetadataFile::default());
    }

    let raw = fs::read_to_string(path).map_err(error_string)?;
    serde_json::from_str(&raw).map_err(error_string)
}

fn read_field_asset_metadata(
    project_dir: &Path,
    asset_id: &str,
) -> Result<FieldAssetMetadata, String> {
    Ok(read_field_asset_metadata_file(project_dir)?
        .assets
        .remove(asset_id)
        .unwrap_or_default())
}

fn safe_asset_file_name(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err(format!("Invalid field asset file name: {input}"));
    }

    Ok(trimmed.to_owned())
}

fn mime_type_for_asset(file_name: &str) -> String {
    match Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    }
    .to_owned()
}

fn read_state(app: &AppHandle) -> Result<DesktopStorageState, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(DesktopStorageState::default());
    }

    let raw = fs::read_to_string(path).map_err(error_string)?;
    serde_json::from_str(&raw).map_err(error_string)
}

fn write_state(app: &AppHandle, state: &DesktopStorageState) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(error_string)?;
    }

    let encoded = serde_json::to_string_pretty(state).map_err(error_string)?;
    fs::write(path, encoded).map_err(error_string)
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(error_string)?
        .join("desktop-storage.json"))
}

fn user_data_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(error_string)?
        .join("user-data.json"))
}

fn user_field_asset_path(app: &AppHandle, entry_id: &str) -> Result<PathBuf, String> {
    let safe_id = safe_asset_file_name(entry_id)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(error_string)?
        .join("field-backgrounds")
        .join(safe_id))
}

fn read_recoverable_json(path: &Path) -> Result<Option<Value>, String> {
    let Some(raw) = read_recoverable_bytes(path)? else {
        return Ok(None);
    };
    match serde_json::from_slice(&raw) {
        Ok(value) => Ok(Some(value)),
        Err(primary_error) => {
            let backup = sibling_path(path, ".bak");
            if !backup.exists() {
                return Err(error_string(primary_error));
            }
            let backup_raw = fs::read(&backup).map_err(error_string)?;
            let recovered = serde_json::from_slice(&backup_raw).map_err(
                |backup_error| {
                    format!(
                        "User Data primary and backup are invalid: primary={primary_error}; backup={backup_error}"
                    )
                },
            )?;
            restore_valid_backup_over_corrupt_primary(path, &backup)?;
            Ok(Some(recovered))
        }
    }
}

fn write_recoverable_json(path: &Path, value: &Value) -> Result<(), String> {
    let encoded = serde_json::to_string_pretty(value).map_err(error_string)?;
    write_recoverable_bytes(path, encoded.as_bytes())
}

fn read_recoverable_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let backup = sibling_path(path, ".bak");
    if !path.exists() && backup.exists() {
        fs::rename(&backup, path).map_err(error_string)?;
        if let Some(parent) = path.parent() {
            sync_directory(parent)?;
        }
    }
    if !path.exists() {
        return Ok(None);
    }
    fs::read(path).map(Some).map_err(error_string)
}

fn write_recoverable_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Recoverable file has no parent: {}", path.display()))?;
    let parent_existed = parent.exists();
    fs::create_dir_all(parent).map_err(error_string)?;
    if !parent_existed {
        if let Some(grandparent) = parent.parent() {
            sync_directory(grandparent)?;
        }
    }
    let temporary = sibling_path(path, ".tmp");
    let backup = sibling_path(path, ".bak");
    let mut temporary_file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(error_string)?;
    temporary_file.write_all(bytes).map_err(error_string)?;
    temporary_file.sync_all().map_err(error_string)?;
    drop(temporary_file);

    if !path.exists() {
        fs::rename(&temporary, path).map_err(error_string)?;
        return sync_directory(parent);
    }

    rotate_recoverable_primary(path, &backup, parent)?;
    match fs::rename(&temporary, path) {
        Ok(()) => {
            sync_directory(parent)?;
            fs::remove_file(backup).map_err(error_string)?;
            sync_directory(parent)
        }
        Err(error) => {
            let _ = fs::rename(&backup, path);
            let _ = sync_directory(parent);
            Err(error_string(error))
        }
    }
}

fn rotate_recoverable_primary(path: &Path, backup: &Path, parent: &Path) -> Result<(), String> {
    if backup.exists() {
        fs::remove_file(backup).map_err(error_string)?;
        sync_directory(parent)?;
    }
    fs::rename(path, backup).map_err(error_string)?;
    sync_directory(parent)
}

fn restore_valid_backup_over_corrupt_primary(path: &Path, backup: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Recoverable file has no parent: {}", path.display()))?;
    let evidence = available_corrupt_sibling(path);
    fs::rename(path, &evidence).map_err(error_string)?;
    sync_directory(parent)?;
    match fs::rename(backup, path) {
        Ok(()) => sync_directory(parent),
        Err(error) => {
            let _ = fs::rename(&evidence, path);
            let _ = sync_directory(parent);
            Err(error_string(error))
        }
    }
}

fn available_corrupt_sibling(path: &Path) -> PathBuf {
    let first = sibling_path(path, ".corrupt");
    if !first.exists() {
        return first;
    }
    for index in 1.. {
        let candidate = sibling_path(path, &format!(".corrupt.{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn absolutize(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
}

fn error_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn opening_runtime_only_project_is_byte_preserving_and_read_only() {
        let dir = temp_project_dir("raw-read");
        let config = "{\n  \"unusual spacing\" : true\n}\n";
        let path = "{ \"path_elements\" : [ ] }\n";
        let legacy = "{ \"schema_version\": 1, trailing }\n";
        fs::write(dir.join("config.json"), config).unwrap();
        fs::create_dir(dir.join("paths")).unwrap();
        fs::write(dir.join("paths/auto.json"), path).unwrap();
        fs::create_dir(dir.join(".bline-web")).unwrap();
        fs::write(dir.join(".bline-web/state.json"), legacy).unwrap();

        let result = read_project_text_file_set(&dir).unwrap();

        assert_eq!(
            result.files,
            vec![
                project_file("config.json", config),
                project_file("paths/auto.json", path),
            ]
        );
        assert_eq!(
            result.legacy_files,
            vec![project_file(".bline-web/state.json", legacy)]
        );
        assert!(!dir.join("project.json").exists());
        assert!(!dir.join(PROJECT_SAVE_TRANSACTION_DIR).exists());
    }

    #[test]
    fn invalid_utf8_is_reported_without_rewriting_source() {
        let dir = temp_project_dir("invalid-utf8");
        let bytes = [0xff_u8, 0xfe, 0xfd];
        fs::write(dir.join("config.json"), bytes).unwrap();

        let error = read_project_text_file_set(&dir).unwrap_err();

        assert!(error.contains("left untouched"));
        assert_eq!(fs::read(dir.join("config.json")).unwrap(), bytes);
        assert!(!dir.join("project.json").exists());
    }

    #[test]
    fn canonical_save_is_version_guarded_and_removes_obsolete_paths() {
        let dir = temp_project_dir("canonical-save");
        fs::create_dir(dir.join("paths")).unwrap();
        fs::write(dir.join("config.json"), "old config").unwrap();
        fs::write(dir.join("paths/obsolete.json"), "old path").unwrap();
        let before = read_project_text_file_set(&dir).unwrap();
        let canonical = vec![
            project_file("config.json", "new config"),
            project_file("paths/kept.json", "new path"),
            project_file("project.json", "new metadata"),
        ];

        let saved = write_project_text_file_set(&dir, &canonical, Some(&before.version)).unwrap();

        assert_eq!(read_managed_project_files(&dir).unwrap(), canonical);
        assert!(!dir.join("paths/obsolete.json").exists());
        assert!(!dir.join(PROJECT_SAVE_TRANSACTION_DIR).exists());
        assert_eq!(
            saved.version,
            read_project_text_file_set(&dir).unwrap().version
        );
        assert_eq!(
            write_project_text_file_set(&dir, &canonical, Some(&before.version)).unwrap_err(),
            "storage-conflict: project file-set version mismatch"
        );
    }

    #[test]
    fn legacy_cleanup_is_guarded_and_preserves_field_assets() {
        let dir = temp_project_dir("legacy-cleanup");
        install_files(
            &dir,
            &[
                project_file("config.json", "config"),
                project_file("project.json", "metadata"),
            ],
        );
        fs::create_dir_all(dir.join(".bline-web/assets/fields")).unwrap();
        fs::write(dir.join(".bline-web/assets/fields/field.png"), [1, 2, 3]).unwrap();
        fs::write(dir.join(".bline-web/state.json"), "state").unwrap();
        fs::write(dir.join(".bline-web/field-assets.json"), "assets").unwrap();
        fs::write(dir.join("pathgroups.json"), "groups").unwrap();
        let stale = read_project_text_file_set(&dir).unwrap().version;
        fs::write(dir.join("pathgroups.json"), "changed").unwrap();

        assert_eq!(
            delete_legacy_project_files(&dir, &stale).unwrap_err(),
            "storage-conflict: project file set changed before legacy cleanup"
        );
        let current = read_project_text_file_set(&dir).unwrap().version;
        delete_legacy_project_files(&dir, &current).unwrap();

        assert!(!dir.join(".bline-web/state.json").exists());
        assert!(!dir.join(".bline-web/field-assets.json").exists());
        assert!(!dir.join("pathgroups.json").exists());
        assert_eq!(
            fs::read(dir.join(".bline-web/assets/fields/field.png")).unwrap(),
            [1, 2, 3]
        );
    }

    #[test]
    fn legacy_cleanup_retry_finishes_a_partially_applied_transaction() {
        let dir = temp_project_dir("legacy-cleanup-retry");
        install_files(
            &dir,
            &[
                project_file("config.json", "config"),
                project_file("project.json", "metadata"),
            ],
        );
        fs::create_dir_all(dir.join(".bline-web")).unwrap();
        fs::write(dir.join(".bline-web/state.json"), "state").unwrap();
        fs::write(dir.join(".bline-web/field-assets.json"), "assets").unwrap();
        fs::write(dir.join("pathgroups.json"), "groups").unwrap();
        let expected = read_project_text_file_set(&dir).unwrap().version;
        stage_legacy_cleanup_transaction(&dir, &expected);
        fs::remove_file(dir.join(".bline-web/state.json")).unwrap();

        let cleaned = delete_legacy_project_files(&dir, &expected).unwrap();

        assert!(read_legacy_project_files(&dir).unwrap().is_empty());
        assert!(!dir.join(LEGACY_CLEANUP_TRANSACTION_DIR).exists());
        assert_eq!(
            cleaned.version,
            read_project_text_file_set(&dir).unwrap().version
        );
    }

    #[test]
    fn legacy_cleanup_recovery_rejects_changed_metadata_after_prepare() {
        let dir = temp_project_dir("legacy-cleanup-changed-after-prepare");
        install_files(
            &dir,
            &[
                project_file("config.json", "config"),
                project_file("project.json", "metadata"),
            ],
        );
        fs::create_dir_all(dir.join(".bline-web")).unwrap();
        fs::write(dir.join(".bline-web/state.json"), "prepared state").unwrap();
        fs::write(dir.join("pathgroups.json"), "prepared groups").unwrap();
        let expected = read_project_text_file_set(&dir).unwrap().version;
        stage_legacy_cleanup_transaction(&dir, &expected);
        fs::write(dir.join(".bline-web/state.json"), "new state").unwrap();

        let error = delete_legacy_project_files(&dir, &expected).unwrap_err();

        assert_eq!(
            error,
            "storage-conflict: legacy metadata changed after cleanup was prepared"
        );
        assert_eq!(
            fs::read_to_string(dir.join(".bline-web/state.json")).unwrap(),
            "new state"
        );
        assert_eq!(
            fs::read_to_string(dir.join("pathgroups.json")).unwrap(),
            "prepared groups"
        );
        assert!(dir.join(LEGACY_CLEANUP_TRANSACTION_DIR).exists());
    }

    #[test]
    fn legacy_cleanup_recovery_rejects_added_metadata_after_prepare() {
        let dir = temp_project_dir("legacy-cleanup-added-after-prepare");
        install_files(
            &dir,
            &[
                project_file("config.json", "config"),
                project_file("project.json", "metadata"),
            ],
        );
        fs::create_dir_all(dir.join(".bline-web")).unwrap();
        fs::write(dir.join(".bline-web/state.json"), "prepared state").unwrap();
        let expected = read_project_text_file_set(&dir).unwrap().version;
        stage_legacy_cleanup_transaction(&dir, &expected);
        fs::write(
            dir.join(".bline-web/path-metadata.json"),
            "new path metadata",
        )
        .unwrap();

        let error = delete_legacy_project_files(&dir, &expected).unwrap_err();

        assert_eq!(
            error,
            "storage-conflict: legacy metadata changed after cleanup was prepared"
        );
        assert_eq!(
            fs::read_to_string(dir.join(".bline-web/path-metadata.json")).unwrap(),
            "new path metadata"
        );
        assert_eq!(
            fs::read_to_string(dir.join(".bline-web/state.json")).unwrap(),
            "prepared state"
        );
        assert!(dir.join(LEGACY_CLEANUP_TRANSACTION_DIR).exists());
    }

    #[test]
    fn prepared_transaction_restores_old_complete_set() {
        let dir = temp_project_dir("prepared-recovery");
        let old = vec![
            project_file("config.json", "old config"),
            project_file("paths/old.json", "old path"),
            project_file("project.json", "old metadata"),
        ];
        let new = vec![
            project_file("config.json", "new config"),
            project_file("paths/new.json", "new path"),
            project_file("project.json", "new metadata"),
        ];
        install_files(&dir, &old);
        stage_transaction(&dir, &old, &new, PROJECT_SAVE_TRANSACTION_PREPARED);
        remove_live_managed_project_files(&dir).unwrap();
        install_snapshot_file(&dir, &new[0]).unwrap();

        recover_project_file_transaction(&dir).unwrap();

        assert_eq!(read_managed_project_files(&dir).unwrap(), old);
        assert!(!dir.join(PROJECT_SAVE_TRANSACTION_DIR).exists());
    }

    #[test]
    fn committed_transaction_completes_new_set() {
        let dir = temp_project_dir("committed-recovery");
        let old = vec![
            project_file("config.json", "old config"),
            project_file("paths/old.json", "old path"),
            project_file("project.json", "old metadata"),
        ];
        let new = vec![
            project_file("config.json", "new config"),
            project_file("paths/new.json", "new path"),
            project_file("project.json", "new metadata"),
        ];
        install_files(&dir, &old);
        stage_transaction(&dir, &old, &new, PROJECT_SAVE_TRANSACTION_COMMITTED);

        recover_project_file_transaction(&dir).unwrap();

        assert_eq!(read_managed_project_files(&dir).unwrap(), new);
        assert!(!dir.join(PROJECT_SAVE_TRANSACTION_DIR).exists());
    }

    #[test]
    fn partial_cleanup_residue_is_ignored_without_touching_live_project() {
        let dir = temp_project_dir("cleanup-residue");
        let live = vec![
            project_file("config.json", "live config"),
            project_file("paths/live.json", "live path"),
            project_file("project.json", "live metadata"),
        ];
        install_files(&dir, &live);
        let cleanup_dir = dir.join(PROJECT_SAVE_CLEANUP_DIR);
        fs::create_dir_all(cleanup_dir.join("new/paths")).unwrap();
        fs::write(
            cleanup_dir.join(PROJECT_SAVE_TRANSACTION_MARKER),
            PROJECT_SAVE_TRANSACTION_COMMITTED,
        )
        .unwrap();
        // This deliberately resembles a committed snapshot interrupted halfway
        // through deletion. Its contents are never considered for recovery.
        fs::write(cleanup_dir.join("new/config.json"), "partial").unwrap();
        fs::write(cleanup_dir.join("new/paths/partial.json"), "partial").unwrap();

        recover_project_file_transaction(&dir).unwrap();

        assert_eq!(read_managed_project_files(&dir).unwrap(), live);
        assert!(!cleanup_dir.exists());
    }

    #[test]
    fn incomplete_committed_snapshot_cannot_delete_complete_live_project() {
        let dir = temp_project_dir("incomplete-snapshot");
        let live = vec![
            project_file("config.json", "live config"),
            project_file("paths/live.json", "live path"),
            project_file("project.json", "live metadata"),
        ];
        let replacement = vec![
            project_file("config.json", "replacement config"),
            project_file("paths/replacement.json", "replacement path"),
            project_file("project.json", "replacement metadata"),
        ];
        install_files(&dir, &live);
        stage_transaction(
            &dir,
            &live,
            &replacement,
            PROJECT_SAVE_TRANSACTION_COMMITTED,
        );
        fs::remove_file(
            dir.join(PROJECT_SAVE_TRANSACTION_DIR)
                .join("new/project.json"),
        )
        .unwrap();

        let error = recover_project_file_transaction(&dir).unwrap_err();

        assert!(error.contains("failed validation"));
        assert_eq!(read_managed_project_files(&dir).unwrap(), live);
        assert!(dir.join(PROJECT_SAVE_TRANSACTION_DIR).exists());
    }

    #[test]
    fn invalid_snapshot_stamp_cannot_delete_complete_live_project() {
        let dir = temp_project_dir("invalid-snapshot-stamp");
        let live = vec![
            project_file("config.json", "live config"),
            project_file("paths/live.json", "live path"),
            project_file("project.json", "live metadata"),
        ];
        install_files(&dir, &live);
        stage_transaction(&dir, &live, &live, PROJECT_SAVE_TRANSACTION_PREPARED);
        fs::write(
            dir.join(PROJECT_SAVE_TRANSACTION_DIR)
                .join("old")
                .join(PROJECT_SAVE_SNAPSHOT_VERSION),
            "invalid",
        )
        .unwrap();

        let error = recover_project_file_transaction(&dir).unwrap_err();

        assert!(error.contains("failed validation"));
        assert_eq!(read_managed_project_files(&dir).unwrap(), live);
    }

    #[test]
    fn version_tracks_content_not_directory_locator() {
        let first = temp_project_dir("version-first");
        let second = temp_project_dir("version-second");
        let files = vec![
            project_file("config.json", "config"),
            project_file("paths/auto.json", "path"),
            project_file("project.json", "metadata"),
        ];
        install_files(&first, &files);
        install_files(&second, &files);

        assert_eq!(
            read_project_text_file_set(&first).unwrap().version,
            read_project_text_file_set(&second).unwrap().version
        );
        fs::create_dir(first.join(".bline-web")).unwrap();
        fs::write(first.join(".bline-web/state.json"), "legacy").unwrap();
        assert_ne!(
            read_project_text_file_set(&first).unwrap().version,
            read_project_text_file_set(&second).unwrap().version
        );
    }

    #[test]
    fn canonical_set_rejects_unsafe_and_duplicate_paths() {
        assert!(validate_complete_project_file_set(&[
            project_file("config.json", "config"),
            project_file("project.json", "metadata"),
            project_file("paths/../outside.json", "bad"),
        ])
        .is_err());
        assert!(validate_complete_project_file_set(&[
            project_file("config.json", "first"),
            project_file("config.json", "second"),
            project_file("project.json", "metadata"),
        ])
        .is_err());
    }

    #[test]
    fn legacy_field_assets_are_read_and_deleted_without_sidecar_writes() {
        let dir = temp_project_dir("legacy-field");
        fs::create_dir_all(dir.join(".bline-web/assets/fields")).unwrap();
        fs::write(dir.join(".bline-web/assets/fields/asset.png"), [4, 5, 6]).unwrap();
        fs::write(
            dir.join(".bline-web/state.json"),
            serde_json::to_string(&json!({
                "field_assets": {
                    "asset.png": {
                        "file_name": "practice.png",
                        "mime_type": "image/png"
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let payload = read_field_asset_from_project_dir(&dir, "asset.png")
            .unwrap()
            .unwrap();
        assert_eq!(payload.file_name, "practice.png");
        assert_eq!(payload.bytes, [4, 5, 6]);

        delete_field_asset_from_project_dir(&dir, "asset.png").unwrap();
        assert!(!dir.join(".bline-web/assets/fields/asset.png").exists());
        assert!(dir.join(".bline-web/state.json").exists());
    }

    #[test]
    fn user_data_and_assets_replace_atomically_and_recover_backups() {
        let dir = temp_project_dir("user-data");
        let data_path = dir.join("user-data.json");
        write_recoverable_json(&data_path, &json!({ "value": "old" })).unwrap();
        write_recoverable_json(&data_path, &json!({ "value": "new" })).unwrap();
        assert_eq!(
            read_recoverable_json(&data_path).unwrap(),
            Some(json!({ "value": "new" }))
        );
        fs::rename(&data_path, sibling_path(&data_path, ".bak")).unwrap();
        assert_eq!(
            read_recoverable_json(&data_path).unwrap(),
            Some(json!({ "value": "new" }))
        );

        let asset_path = dir.join("field-backgrounds/asset");
        write_recoverable_bytes(&asset_path, b"old").unwrap();
        write_recoverable_bytes(&asset_path, b"new").unwrap();
        assert_eq!(
            read_recoverable_bytes(&asset_path).unwrap(),
            Some(b"new".to_vec())
        );
    }

    #[test]
    fn corrupt_user_data_primary_restores_valid_backup_and_preserves_evidence() {
        let dir = temp_project_dir("user-data-corrupt-primary");
        let data_path = dir.join("user-data.json");
        let backup_path = sibling_path(&data_path, ".bak");
        fs::write(&data_path, b"{ truncated").unwrap();
        fs::write(&backup_path, br#"{"value":"recoverable"}"#).unwrap();

        assert_eq!(
            read_recoverable_json(&data_path).unwrap(),
            Some(json!({ "value": "recoverable" }))
        );
        assert_eq!(
            fs::read_to_string(&data_path).unwrap(),
            r#"{"value":"recoverable"}"#
        );
        assert_eq!(
            fs::read(sibling_path(&data_path, ".corrupt")).unwrap(),
            b"{ truncated"
        );
        assert!(!backup_path.exists());
    }

    #[test]
    fn stale_backup_is_replaced_with_current_primary_before_the_next_commit() {
        let dir = temp_project_dir("user-data-stale-backup");
        let data_path = dir.join("user-data.json");
        let backup_path = sibling_path(&data_path, ".bak");
        fs::write(&data_path, b"current").unwrap();
        fs::write(&backup_path, b"stale").unwrap();

        rotate_recoverable_primary(&data_path, &backup_path, &dir).unwrap();

        assert!(!data_path.exists());
        assert_eq!(fs::read(&backup_path).unwrap(), b"current");
        assert_eq!(
            read_recoverable_bytes(&data_path).unwrap(),
            Some(b"current".to_vec())
        );
    }

    #[test]
    fn selecting_paths_subfolder_resolves_to_project_without_writing() {
        let dir = temp_project_dir("nested-paths");
        fs::create_dir(dir.join("paths")).unwrap();
        fs::write(dir.join("config.json"), "config").unwrap();

        assert_eq!(effective_project_dir(&dir.join("paths")), absolutize(&dir));
        assert!(!dir.join("project.json").exists());
    }

    #[test]
    fn creating_a_project_requires_an_empty_target() {
        let empty = temp_project_dir("new-project-empty");
        validate_new_workspace_dir(&empty).unwrap();

        let existing = temp_project_dir("new-project-existing");
        fs::write(existing.join("project.json"), "existing metadata").unwrap();
        let error = validate_new_workspace_dir(&existing).unwrap_err();

        assert!(error.contains("requires an empty folder"));
        assert_eq!(
            fs::read_to_string(existing.join("project.json")).unwrap(),
            "existing metadata"
        );
    }

    fn project_file(relative_path: &str, contents: &str) -> ProjectTextFile {
        ProjectTextFile {
            relative_path: relative_path.to_owned(),
            contents: contents.to_owned(),
        }
    }

    fn install_files(dir: &Path, files: &[ProjectTextFile]) {
        for file in files {
            install_snapshot_file(dir, file).unwrap();
        }
    }

    fn stage_transaction(
        dir: &Path,
        old: &[ProjectTextFile],
        new: &[ProjectTextFile],
        state: &str,
    ) {
        let transaction_dir = dir.join(PROJECT_SAVE_TRANSACTION_DIR);
        fs::create_dir(&transaction_dir).unwrap();
        write_project_snapshot(&transaction_dir.join("old"), old).unwrap();
        write_project_snapshot(&transaction_dir.join("new"), new).unwrap();
        write_transaction_marker(&transaction_dir, state).unwrap();
    }

    fn stage_legacy_cleanup_transaction(dir: &Path, expected: &str) {
        let transaction_dir = dir.join(LEGACY_CLEANUP_TRANSACTION_DIR);
        fs::create_dir(&transaction_dir).unwrap();
        write_synced_text(
            &transaction_dir.join(LEGACY_CLEANUP_EXPECTED_VERSION),
            expected,
        )
        .unwrap();
        write_legacy_cleanup_manifest(&transaction_dir, &read_legacy_project_files(dir).unwrap())
            .unwrap();
        write_transaction_marker(&transaction_dir, PROJECT_SAVE_TRANSACTION_PREPARED).unwrap();
    }

    fn temp_project_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bline-web-{label}-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
