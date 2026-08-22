use serde::{Deserialize, Serialize};
use serde_json::{json, Number, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub display_name: String,
    pub updated_at: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceSummary {
    pub id: String,
    pub display_name: String,
    pub directory_path: String,
    pub updated_at: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
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
struct AutosEditorStateFile {
    schema_version: u64,
    editor_config: Option<Value>,
    active_path_file_name: Option<String>,
    active_path_group_id: Option<String>,
    path_groups: Vec<Value>,
    linked_targets: Vec<Value>,
    paths: std::collections::HashMap<String, AutosEditorPathState>,
    field_assets: std::collections::HashMap<String, FieldAssetMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
struct AutosEditorPathState {
    display_name: Option<String>,
    editor_metadata: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct DesktopStorageState {
    current_project_dir: Option<String>,
    recent_project_dirs: Vec<String>,
    active_path_by_project_dir: std::collections::HashMap<String, String>,
}

const DEFAULT_CONFIG_JSON: &str = r#"{
  "kinematic_constraints": {
    "default_max_velocity_meters_per_sec": 4.5,
    "default_max_acceleration_meters_per_sec2": 12,
    "default_max_velocity_deg_per_sec": 720,
    "default_max_acceleration_deg_per_sec2": 1500,
    "default_end_translation_tolerance_meters": 0.03,
    "default_end_rotation_tolerance_deg": 2,
    "default_intermediate_handoff_radius_meters": 0.45
  }
}"#;

const AUTOS_EDITOR_STATE_SCHEMA_VERSION: u64 = 1;

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
pub fn storage_open_workspace_dialog(
    app: AppHandle,
) -> Result<Option<ProjectWorkspaceSummary>, String> {
    let Some(selected) = pick_workspace_dir("Open BLine Project") else {
        return Ok(None);
    };

    set_workspace_dir(&app, selected).map(Some)
}

#[tauri::command]
pub fn storage_create_workspace_dialog(
    app: AppHandle,
) -> Result<Option<ProjectWorkspaceSummary>, String> {
    let Some(selected) = pick_workspace_dir("Create or Select BLine Project") else {
        return Ok(None);
    };

    set_workspace_dir(&app, selected).map(Some)
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

#[tauri::command]
pub fn storage_read_workspace(app: AppHandle, id: Option<String>) -> Result<Value, String> {
    if let Some(id) = id {
        if !id.trim().is_empty() {
            set_workspace_dir(&app, PathBuf::from(id))?;
        }
    }

    let dir = require_current_project_dir(&app)?;
    let state = read_state(&app)?;
    let dir_string = dir.to_string_lossy().to_string();
    let stored_active = state.active_path_by_project_dir.get(&dir_string).cloned();

    read_workspace_from_project_dir(&dir, stored_active)
}

#[tauri::command]
pub fn storage_write_workspace(
    app: AppHandle,
    workspace: Value,
    expected: Option<String>,
) -> Result<WriteResult, String> {
    let dir = require_current_project_dir(&app)?;
    let write_result = write_workspace_to_project_dir(&dir, &workspace, expected.as_deref())?;

    let mut state = read_state(&app)?;
    let dir_string = dir.to_string_lossy().to_string();
    if let Some(active_path_id) = write_result.active_path_file_name {
        state
            .active_path_by_project_dir
            .insert(dir_string, safe_path_file_name(&active_path_id)?);
    }
    write_state(&app, &state)?;

    Ok(write_result.result)
}

#[tauri::command]
pub fn storage_get_active_path(
    app: AppHandle,
    project_id: String,
) -> Result<Option<String>, String> {
    let state = read_state(&app)?;
    Ok(state.active_path_by_project_dir.get(&project_id).cloned())
}

#[tauri::command]
pub fn storage_set_active_path(
    app: AppHandle,
    project_id: String,
    path_id: Option<String>,
) -> Result<(), String> {
    let mut state = read_state(&app)?;
    if let Some(path_id) = path_id {
        state
            .active_path_by_project_dir
            .insert(project_id, safe_path_file_name(&path_id)?);
    } else {
        state.active_path_by_project_dir.remove(&project_id);
    }
    write_state(&app, &state)
}

#[tauri::command]
pub fn storage_list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let Some(dir) = current_project_dir(&app)? else {
        return Ok(Vec::new());
    };

    ensure_project_structure(&dir)?;
    let paths_dir = dir.join("paths");
    let mut summaries = Vec::new();

    for entry in fs::read_dir(paths_dir).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        let updated_at = file_updated_at(&path);
        summaries.push(ProjectSummary {
            id: file_name.to_owned(),
            display_name: display_name_from_file_name(file_name),
            version: file_version(&path),
            updated_at,
        });
    }

    summaries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.display_name.cmp(&b.display_name))
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(summaries)
}

#[tauri::command]
pub fn storage_read_project(app: AppHandle, id: String) -> Result<Value, String> {
    let dir = require_current_project_dir(&app)?;
    ensure_project_structure(&dir)?;

    let file_name = safe_path_file_name(&id)?;
    let path_file = dir.join("paths").join(&file_name);
    let path_json = read_json_file(&path_file)?;
    let path_payload = path_json
        .get("path")
        .cloned()
        .unwrap_or_else(|| path_json.clone());
    let runtime_config = read_config_or_default(&dir)?;
    let editor_state = read_editor_state_file(&dir)?;
    let config = workspace_config_value(runtime_config, editor_state.as_ref());

    Ok(json!({
        "schema_version": 1,
        "project_id": file_name,
        "display_name": display_name_from_file_name(&file_name),
        "path_file_name": file_name,
        "path": path_payload,
        "config": config
    }))
}

#[tauri::command]
pub fn storage_write_project(
    app: AppHandle,
    project: Value,
    expected: Option<String>,
) -> Result<WriteResult, String> {
    let dir = require_current_project_dir(&app)?;
    ensure_project_structure(&dir)?;

    let file_name = project_path_file_name(&project)?;
    let path_file = dir.join("paths").join(&file_name);

    if let Some(expected) = expected.as_deref() {
        let actual = path_file.exists().then(|| file_version(&path_file));
        if actual.as_deref() != Some(expected) {
            return Err("storage-conflict: project version mismatch".to_owned());
        }
    }

    if let Some(config) = project.get("config") {
        write_json_file(&dir.join("config.json"), &runtime_config_value(config))?;
    }

    let path_json = project
        .get("path")
        .ok_or_else(|| "Project document is missing path".to_owned())?;
    write_json_file(&path_file, path_json)?;

    let updated_at = unix_millis();
    Ok(WriteResult {
        version: file_version(&path_file),
        updated_at,
    })
}

#[tauri::command]
pub fn storage_delete_project(
    app: AppHandle,
    id: String,
    expected: Option<String>,
) -> Result<(), String> {
    let dir = require_current_project_dir(&app)?;
    let file_name = safe_path_file_name(&id)?;
    let path_file = dir.join("paths").join(file_name);

    if !path_file.exists() {
        if expected.is_some() {
            return Err("storage-conflict: project version mismatch".to_owned());
        }
        return Ok(());
    }

    if let Some(expected) = expected.as_deref() {
        let actual = file_version(&path_file);
        if actual != expected {
            return Err("storage-conflict: project version mismatch".to_owned());
        }
    }

    fs::remove_file(path_file).map_err(error_string)
}

#[tauri::command]
pub fn storage_write_field_asset(
    app: AppHandle,
    asset_id: String,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let dir = require_current_project_dir(&app)?;
    write_field_asset_to_project_dir(&dir, &asset_id, &file_name, &mime_type, bytes)
}

#[tauri::command]
pub fn storage_read_field_asset(
    app: AppHandle,
    asset_id: String,
) -> Result<Option<FieldAssetPayload>, String> {
    let dir = require_current_project_dir(&app)?;
    read_field_asset_from_project_dir(&dir, &asset_id)
}

#[tauri::command]
pub fn storage_delete_field_asset(app: AppHandle, asset_id: String) -> Result<(), String> {
    let dir = require_current_project_dir(&app)?;
    delete_field_asset_from_project_dir(&dir, &asset_id)
}

fn write_field_asset_to_project_dir(
    project_dir: &Path,
    asset_id: &str,
    file_name: &str,
    mime_type: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    ensure_project_structure(project_dir)?;
    let asset_id = safe_asset_file_name(asset_id)?;
    let file_name = safe_asset_file_name(file_name)?;
    let assets_dir = field_assets_dir(project_dir);
    fs::create_dir_all(&assets_dir).map_err(error_string)?;
    fs::write(assets_dir.join(&asset_id), bytes).map_err(error_string)?;
    write_field_asset_metadata(project_dir, &asset_id, &file_name, mime_type)
}

fn read_field_asset_from_project_dir(
    project_dir: &Path,
    asset_id: &str,
) -> Result<Option<FieldAssetPayload>, String> {
    ensure_project_structure(project_dir)?;
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
    remove_field_asset_metadata(project_dir, &asset_id)
}

fn pick_workspace_dir(title: &str) -> Option<PathBuf> {
    rfd::FileDialog::new().set_title(title).pick_folder()
}

fn set_workspace_dir(
    app: &AppHandle,
    selected_dir: PathBuf,
) -> Result<ProjectWorkspaceSummary, String> {
    let effective_dir = effective_project_dir(&selected_dir);
    ensure_project_structure(&effective_dir)?;

    let mut state = read_state(app)?;
    let dir_string = effective_dir.to_string_lossy().to_string();
    state.current_project_dir = Some(dir_string.clone());
    state
        .recent_project_dirs
        .retain(|entry| entry != &dir_string);
    state.recent_project_dirs.insert(0, dir_string);
    state.recent_project_dirs.truncate(10);
    write_state(app, &state)?;

    workspace_summary(&effective_dir)
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

/// A directory looks like a BLine project when it holds a `config.json` alongside a
/// `paths` folder — the structure `ensure_project_structure` lays down.
fn is_bline_project_dir(dir: &Path) -> bool {
    dir.join("config.json").is_file() && dir.join("paths").is_dir()
}

fn ensure_project_structure(project_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(project_dir).map_err(error_string)?;
    fs::create_dir_all(project_dir.join("paths")).map_err(error_string)?;

    let config_path = project_dir.join("config.json");
    if !config_path.exists() {
        let config = default_config_value()?;
        write_json_file(&config_path, &config)?;
    }

    Ok(())
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

    Ok(ProjectWorkspaceSummary {
        id: directory_path.clone(),
        display_name,
        directory_path,
        updated_at: file_updated_at(path),
        version: workspace_version(path)?,
    })
}

fn workspace_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("autos")
        .to_owned()
}

fn read_config_or_default(project_dir: &Path) -> Result<Value, String> {
    let config_path = project_dir.join("config.json");
    if config_path.exists() {
        read_json_file(&config_path)
    } else {
        default_config_value()
    }
}

#[derive(Debug)]
struct ProjectDirWriteResult {
    result: WriteResult,
    active_path_file_name: Option<String>,
}

fn read_workspace_from_project_dir(
    project_dir: &Path,
    stored_active_path_id: Option<String>,
) -> Result<Value, String> {
    ensure_project_structure(project_dir)?;

    let runtime_config = read_config_or_default(project_dir)?;
    let editor_state = read_editor_state_file(project_dir)?;
    let config = workspace_config_value(runtime_config, editor_state.as_ref());
    let metadata_by_file = read_path_metadata(project_dir, editor_state.as_ref())?;
    let paths_dir = project_dir.join("paths");
    let mut paths = Vec::new();

    for entry in fs::read_dir(&paths_dir).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        let path_json = read_json_file(&path)?;
        let path_payload = path_json
            .get("path")
            .cloned()
            .unwrap_or_else(|| path_json.clone());

        let mut path_entry = json!({
            "path_id": file_name,
            "display_name": display_name_for_path(file_name, editor_state.as_ref()),
            "file_name": file_name,
            "path": path_payload
        });

        if let Some(editor_metadata) = metadata_by_file.get(file_name) {
            if let Some(object) = path_entry.as_object_mut() {
                object.insert("editor_metadata".to_owned(), editor_metadata.clone());
            }
        }

        paths.push(path_entry);
    }

    paths.sort_by(|a, b| {
        let a_name = a
            .get("file_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let b_name = b
            .get("file_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        a_name.cmp(b_name)
    });

    let path_groups = read_path_groups(project_dir, &paths, editor_state.as_ref())?;
    let sidecar_active = active_path_id_from_state(editor_state.as_ref(), &paths);
    let active_path_id = sidecar_active
        .or(stored_active_path_id)
        .filter(|active| {
            paths.iter().any(|path| {
                path.get("path_id")
                    .and_then(Value::as_str)
                    .is_some_and(|candidate| candidate == active)
            })
        })
        .or_else(|| {
            paths
                .first()
                .and_then(|path| path.get("path_id"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    Ok(json!({
        "schema_version": 1,
        "project_id": project_dir.to_string_lossy().to_string(),
        "display_name": workspace_display_name(project_dir),
        "config": config,
        "paths": paths,
        "active_path_id": active_path_id,
        "path_groups": path_groups,
        "active_path_group_id": active_path_group_id_from_state(editor_state.as_ref()),
        "linked_targets": editor_state
            .as_ref()
            .map(|state| state.linked_targets.clone())
            .unwrap_or_default()
    }))
}

fn write_workspace_to_project_dir(
    project_dir: &Path,
    workspace: &Value,
    expected: Option<&str>,
) -> Result<ProjectDirWriteResult, String> {
    ensure_project_structure(project_dir)?;

    if let Some(expected) = expected {
        let actual = workspace_version(project_dir)?;
        if actual != expected {
            return Err("storage-conflict: workspace version mismatch".to_owned());
        }
    }

    if let Some(config) = workspace.get("config") {
        write_json_file(
            &project_dir.join("config.json"),
            &runtime_config_value(config),
        )?;
    }

    let paths = workspace
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace document is missing paths".to_owned())?;
    let paths_dir = project_dir.join("paths");
    fs::create_dir_all(&paths_dir).map_err(error_string)?;
    let mut retained_files = std::collections::HashSet::new();

    for path_entry in paths {
        let file_name = path_entry
            .get("file_name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace path is missing file_name".to_owned())
            .and_then(safe_path_file_name)?;
        let path_json = path_entry
            .get("path")
            .ok_or_else(|| "Workspace path is missing path".to_owned())?;

        retained_files.insert(file_name.clone());
        write_json_file(&paths_dir.join(&file_name), path_json)?;
    }

    write_editor_state_from_workspace(project_dir, workspace, paths)?;
    remove_legacy_editor_files(project_dir)?;

    for entry in fs::read_dir(&paths_dir).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !retained_files.contains(file_name) {
            fs::remove_file(path).map_err(error_string)?;
        }
    }

    let active_path_file_name = active_path_file_name_from_workspace(workspace, paths);
    let updated_at = unix_millis();
    Ok(ProjectDirWriteResult {
        result: WriteResult {
            version: workspace_version(project_dir)?,
            updated_at,
        },
        active_path_file_name,
    })
}

fn read_path_metadata(
    project_dir: &Path,
    editor_state: Option<&AutosEditorStateFile>,
) -> Result<serde_json::Map<String, Value>, String> {
    let mut metadata = read_legacy_path_metadata(project_dir)?;
    if let Some(state) = editor_state {
        for (file_name, path_state) in &state.paths {
            if let Some(editor_metadata) = &path_state.editor_metadata {
                metadata.insert(safe_path_file_name(file_name)?, editor_metadata.clone());
            }
        }
    }

    Ok(metadata)
}

fn read_legacy_path_metadata(project_dir: &Path) -> Result<serde_json::Map<String, Value>, String> {
    let path = path_metadata_file(project_dir);
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }

    let parsed = read_json_file(&path)?;
    let mut metadata = serde_json::Map::new();
    let Some(paths) = parsed.get("paths").and_then(Value::as_object) else {
        return Ok(metadata);
    };

    for (file_name, entry) in paths {
        if let Some(editor_metadata) = entry.get("editor_metadata") {
            metadata.insert(file_name.clone(), editor_metadata.clone());
        }
    }

    Ok(metadata)
}

fn path_metadata_file(project_dir: &Path) -> PathBuf {
    project_dir.join(".bline-web").join("path-metadata.json")
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

fn read_editor_state_file(project_dir: &Path) -> Result<Option<AutosEditorStateFile>, String> {
    let path = editor_state_file(project_dir);
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(error_string)?;
    let mut state: AutosEditorStateFile = serde_json::from_str(&raw).map_err(error_string)?;
    if state.schema_version == 0 {
        state.schema_version = AUTOS_EDITOR_STATE_SCHEMA_VERSION;
    }
    Ok(Some(state))
}

fn read_editor_state_or_default(project_dir: &Path) -> Result<AutosEditorStateFile, String> {
    Ok(
        read_editor_state_file(project_dir)?.unwrap_or(AutosEditorStateFile {
            schema_version: AUTOS_EDITOR_STATE_SCHEMA_VERSION,
            ..AutosEditorStateFile::default()
        }),
    )
}

fn write_editor_state_file(project_dir: &Path, state: &AutosEditorStateFile) -> Result<(), String> {
    let path = editor_state_file(project_dir);
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid editor state path".to_owned())?;
    fs::create_dir_all(parent).map_err(error_string)?;
    let value = serde_json::to_value(state).map_err(error_string)?;
    write_json_file(&path, &value)
}

fn write_editor_state_from_workspace(
    project_dir: &Path,
    workspace: &Value,
    paths: &[Value],
) -> Result<(), String> {
    let mut field_assets = read_field_asset_metadata_file(project_dir)?.assets;
    if let Some(config) = workspace.get("config") {
        for (asset_id, metadata) in field_assets_from_workspace_config(config) {
            field_assets.insert(asset_id, metadata);
        }
    }
    migrate_legacy_field_assets(project_dir)?;

    let mut path_states = std::collections::HashMap::new();
    for path in paths {
        let file_name = path
            .get("file_name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace path is missing file_name".to_owned())
            .and_then(safe_path_file_name)?;
        path_states.insert(
            file_name,
            AutosEditorPathState {
                display_name: path
                    .get("display_name")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_owned),
                editor_metadata: path.get("editor_metadata").cloned(),
            },
        );
    }

    let state = AutosEditorStateFile {
        schema_version: AUTOS_EDITOR_STATE_SCHEMA_VERSION,
        editor_config: workspace.get("config").map(editor_config_value),
        active_path_file_name: active_path_file_name_from_workspace(workspace, paths),
        active_path_group_id: workspace
            .get("active_path_group_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned),
        path_groups: serialize_path_groups_for_state(workspace.get("path_groups"), paths)?,
        linked_targets: workspace
            .get("linked_targets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        paths: path_states,
        field_assets,
    };

    write_editor_state_file(project_dir, &state)
}

fn workspace_config_value(
    runtime_config: Value,
    editor_state: Option<&AutosEditorStateFile>,
) -> Value {
    let Some(editor_config) = editor_state.and_then(|state| state.editor_config.as_ref()) else {
        return runtime_config;
    };

    let mut config = runtime_config
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    if let Some(gui) = editor_config.get("gui") {
        config.insert("gui".to_owned(), gui.clone());
    }

    let mut constraints = editor_config
        .get("kinematic_constraints")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    if let Some(runtime_constraints) = runtime_config
        .get("kinematic_constraints")
        .and_then(Value::as_object)
    {
        for (key, value) in runtime_constraints {
            constraints.insert(key.clone(), value.clone());
        }
    }
    config.insert(
        "kinematic_constraints".to_owned(),
        Value::Object(constraints),
    );

    Value::Object(config)
}

fn runtime_config_value(config: &Value) -> Value {
    let defaults = default_config_value().unwrap_or_else(|_| json!({}));
    let config_constraints = config
        .get("kinematic_constraints")
        .and_then(Value::as_object);
    let default_constraints = defaults
        .get("kinematic_constraints")
        .and_then(Value::as_object);
    let mut constraints = serde_json::Map::new();

    for key in RUNTIME_CONSTRAINT_KEYS {
        if let Some(value) = config_constraints.and_then(|values| values.get(key)) {
            constraints.insert(key.to_owned(), value.clone());
        } else if let Some(value) = default_constraints.and_then(|values| values.get(key)) {
            constraints.insert(key.to_owned(), value.clone());
        }
    }

    json!({ "kinematic_constraints": constraints })
}

fn editor_config_value(config: &Value) -> Value {
    let mut editor_config = serde_json::Map::new();
    if let Some(gui) = config.get("gui") {
        editor_config.insert("gui".to_owned(), gui.clone());
    }

    let mut constraints = serde_json::Map::new();
    if let Some(config_constraints) = config
        .get("kinematic_constraints")
        .and_then(Value::as_object)
    {
        for key in EDITOR_CONSTRAINT_KEYS {
            if let Some(value) = config_constraints.get(key) {
                constraints.insert(key.to_owned(), value.clone());
            }
        }
    }
    editor_config.insert(
        "kinematic_constraints".to_owned(),
        Value::Object(constraints),
    );

    Value::Object(editor_config)
}

const RUNTIME_CONSTRAINT_KEYS: [&str; 7] = [
    "default_max_velocity_meters_per_sec",
    "default_max_acceleration_meters_per_sec2",
    "default_max_velocity_deg_per_sec",
    "default_max_acceleration_deg_per_sec2",
    "default_end_translation_tolerance_meters",
    "default_end_rotation_tolerance_deg",
    "default_intermediate_handoff_radius_meters",
];

const EDITOR_CONSTRAINT_KEYS: [&str; 3] = [
    "default_auto_velocity_velocity_safety_factor",
    "default_auto_velocity_acceleration_safety_factor",
    "default_auto_velocity_merge_tolerance_meters_per_sec",
];

fn read_field_asset_metadata_file(project_dir: &Path) -> Result<FieldAssetMetadataFile, String> {
    let mut metadata = read_legacy_field_asset_metadata_file(project_dir)?;
    if let Some(state) = read_editor_state_file(project_dir)? {
        for (asset_id, asset_metadata) in state.field_assets {
            metadata.assets.insert(asset_id, asset_metadata);
        }
    }

    Ok(metadata)
}

fn read_legacy_field_asset_metadata_file(
    project_dir: &Path,
) -> Result<FieldAssetMetadataFile, String> {
    let path = field_asset_metadata_file(project_dir);
    if !path.exists() {
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

fn write_field_asset_metadata(
    project_dir: &Path,
    asset_id: &str,
    file_name: &str,
    mime_type: &str,
) -> Result<(), String> {
    let mut metadata = read_field_asset_metadata_file(project_dir)?;
    metadata.assets.insert(
        asset_id.to_owned(),
        FieldAssetMetadata {
            file_name: Some(file_name.to_owned()),
            mime_type: Some(mime_type.to_owned()),
        },
    );
    write_field_asset_metadata_file(project_dir, &metadata)
}

fn remove_field_asset_metadata(project_dir: &Path, asset_id: &str) -> Result<(), String> {
    let mut metadata = read_field_asset_metadata_file(project_dir)?;
    metadata.assets.remove(asset_id);
    write_field_asset_metadata_file(project_dir, &metadata)
}

fn write_field_asset_metadata_file(
    project_dir: &Path,
    metadata: &FieldAssetMetadataFile,
) -> Result<(), String> {
    let mut state = read_editor_state_or_default(project_dir)?;
    state.field_assets = metadata.assets.clone();
    write_editor_state_file(project_dir, &state)?;

    let legacy_path = field_asset_metadata_file(project_dir);
    if legacy_path.exists() {
        fs::remove_file(legacy_path).map_err(error_string)?;
    }
    Ok(())
}

fn field_assets_from_workspace_config(
    config: &Value,
) -> std::collections::HashMap<String, FieldAssetMetadata> {
    let mut assets = std::collections::HashMap::new();
    let Some(custom_fields) = config
        .get("gui")
        .and_then(|gui| gui.get("field"))
        .and_then(|field| field.get("custom_fields"))
        .and_then(Value::as_array)
    else {
        return assets;
    };

    for field in custom_fields {
        let Some(asset_id) = field.get("asset_id").and_then(Value::as_str) else {
            continue;
        };
        assets.insert(
            asset_id.to_owned(),
            FieldAssetMetadata {
                file_name: field
                    .get("file_name")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                mime_type: field
                    .get("mime_type")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            },
        );
    }

    assets
}

fn read_path_groups(
    project_dir: &Path,
    paths: &[Value],
    editor_state: Option<&AutosEditorStateFile>,
) -> Result<Vec<Value>, String> {
    if let Some(state) = editor_state.filter(|state| !state.path_groups.is_empty()) {
        return normalize_path_groups(&state.path_groups, paths);
    }

    let path = path_groups_file(project_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let parsed = read_json_file(&path)?;
    let groups = parsed
        .get("groups")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    normalize_path_groups(&groups, paths)
}

fn normalize_path_groups(groups: &[Value], paths: &[Value]) -> Result<Vec<Value>, String> {
    let path_ids = path_id_lookup(paths);
    let file_names = file_name_lookup(paths);
    let mut normalized_groups = Vec::new();

    for (index, group) in groups.iter().enumerate() {
        let group_id = group
            .get("group_id")
            .or_else(|| group.get("id"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("group-{}", index + 1));
        let display_name = group
            .get("display_name")
            .or_else(|| group.get("name"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Path Group {}", index + 1));
        let refs = read_path_group_refs(group);
        let mut seen = std::collections::HashSet::new();
        let path_ids_for_group: Vec<Value> = refs
            .into_iter()
            .filter_map(|path_ref| {
                let by_id = path_ids.get(&path_ref).cloned();
                let by_file_name = safe_path_file_name(&path_ref)
                    .ok()
                    .and_then(|file_name| file_names.get(&file_name).cloned());
                let path_id = by_id.or(by_file_name)?;
                if seen.insert(path_id.clone()) {
                    Some(Value::String(path_id))
                } else {
                    None
                }
            })
            .collect();

        normalized_groups.push(json!({
            "group_id": group_id,
            "display_name": display_name,
            "path_ids": path_ids_for_group
        }));
    }

    Ok(normalized_groups)
}

fn serialize_path_groups_for_state(
    groups: Option<&Value>,
    paths: &[Value],
) -> Result<Vec<Value>, String> {
    let file_name_by_path_id: std::collections::HashMap<String, String> = paths
        .iter()
        .filter_map(|path| {
            Some((
                path.get("path_id")?.as_str()?.to_owned(),
                safe_path_file_name(path.get("file_name")?.as_str()?).ok()?,
            ))
        })
        .collect();
    let file_name_by_file_name = file_names_by_name(paths);
    let mut serialized_groups = Vec::new();

    for (index, group) in groups
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let group_id = group
            .get("group_id")
            .or_else(|| group.get("id"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("group-{}", index + 1));
        let display_name = group
            .get("display_name")
            .or_else(|| group.get("name"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Path Group {}", index + 1));
        let mut seen = std::collections::HashSet::new();
        let path_file_names: Vec<Value> = read_path_group_refs(group)
            .into_iter()
            .filter_map(|path_ref| {
                file_name_by_path_id.get(&path_ref).cloned().or_else(|| {
                    let file_name = safe_path_file_name(&path_ref).ok()?;
                    file_name_by_file_name.get(&file_name).cloned()
                })
            })
            .filter(|file_name| seen.insert(file_name.clone()))
            .map(Value::String)
            .collect();

        serialized_groups.push(json!({
            "group_id": group_id,
            "display_name": display_name,
            "path_file_names": path_file_names
        }));
    }

    Ok(serialized_groups)
}

fn file_names_by_name(paths: &[Value]) -> std::collections::HashMap<String, String> {
    paths
        .iter()
        .filter_map(|path| {
            let file_name = safe_path_file_name(path.get("file_name")?.as_str()?).ok()?;
            Some((file_name.clone(), file_name))
        })
        .collect()
}

fn read_path_group_refs(group: &Value) -> Vec<String> {
    ["path_ids", "path_file_names", "path_files", "paths"]
        .into_iter()
        .find_map(|key| {
            group.get(key).and_then(Value::as_array).map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_owned)
                    .collect()
            })
        })
        .unwrap_or_default()
}

fn path_id_lookup(paths: &[Value]) -> std::collections::HashMap<String, String> {
    paths
        .iter()
        .filter_map(|path| {
            let path_id = path.get("path_id")?.as_str()?.to_owned();
            Some((path_id.clone(), path_id))
        })
        .collect()
}

fn file_name_lookup(paths: &[Value]) -> std::collections::HashMap<String, String> {
    paths
        .iter()
        .filter_map(|path| {
            let path_id = path.get("path_id")?.as_str()?.to_owned();
            let file_name = safe_path_file_name(path.get("file_name")?.as_str()?).ok()?;
            Some((file_name, path_id))
        })
        .collect()
}

fn path_groups_file(project_dir: &Path) -> PathBuf {
    project_dir.join("pathgroups.json")
}

fn active_path_id_from_state(
    editor_state: Option<&AutosEditorStateFile>,
    paths: &[Value],
) -> Option<String> {
    let active_file_name =
        safe_path_file_name(editor_state?.active_path_file_name.as_deref()?).ok()?;
    paths.iter().find_map(|path| {
        let file_name = path.get("file_name").and_then(Value::as_str)?;
        if safe_path_file_name(file_name).ok()? == active_file_name {
            path.get("path_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        } else {
            None
        }
    })
}

fn active_path_group_id_from_state(editor_state: Option<&AutosEditorStateFile>) -> Option<String> {
    editor_state?
        .active_path_group_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn active_path_file_name_from_workspace(workspace: &Value, paths: &[Value]) -> Option<String> {
    workspace
        .get("active_path_id")
        .and_then(Value::as_str)
        .and_then(|active_id| {
            paths.iter().find_map(|path| {
                let path_id = path.get("path_id").and_then(Value::as_str);
                let file_name = path.get("file_name").and_then(Value::as_str);
                if path_id == Some(active_id) {
                    file_name.and_then(|value| safe_path_file_name(value).ok())
                } else {
                    None
                }
            })
        })
}

fn display_name_for_path(file_name: &str, editor_state: Option<&AutosEditorStateFile>) -> String {
    let state_display_name = safe_path_file_name(file_name).ok().and_then(|normalized| {
        editor_state?
            .paths
            .get(&normalized)?
            .display_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
    });

    state_display_name.unwrap_or_else(|| display_name_from_file_name(file_name))
}

fn migrate_legacy_field_assets(project_dir: &Path) -> Result<(), String> {
    let legacy_dir = legacy_field_assets_dir(project_dir);
    if !legacy_dir.is_dir() {
        return Ok(());
    }

    let next_dir = field_assets_dir(project_dir);
    fs::create_dir_all(&next_dir).map_err(error_string)?;
    for entry in fs::read_dir(&legacy_dir).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let safe_name = safe_asset_file_name(file_name)?;
        let next_path = next_dir.join(&safe_name);
        if !next_path.exists() {
            fs::copy(&path, &next_path).map_err(error_string)?;
        }
        fs::remove_file(path).map_err(error_string)?;
    }

    let _ = fs::remove_dir(&legacy_dir);
    if let Some(parent) = legacy_dir.parent() {
        let _ = fs::remove_dir(parent);
    }
    Ok(())
}

fn remove_legacy_editor_files(project_dir: &Path) -> Result<(), String> {
    for path in [
        path_metadata_file(project_dir),
        field_asset_metadata_file(project_dir),
        path_groups_file(project_dir),
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(error_string)?;
        }
    }

    Ok(())
}

fn default_config_value() -> Result<Value, String> {
    serde_json::from_str(DEFAULT_CONFIG_JSON).map_err(error_string)
}

fn project_path_file_name(project: &Value) -> Result<String, String> {
    if let Some(path_file_name) = project.get("path_file_name").and_then(Value::as_str) {
        return safe_path_file_name(path_file_name);
    }

    if let Some(project_id) = project.get("project_id").and_then(Value::as_str) {
        return safe_path_file_name(project_id);
    }

    Err("Project document is missing path_file_name".to_owned())
}

fn safe_path_file_name(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err(format!("Invalid path file name: {input}"));
    }

    let file_name = if trimmed.to_lowercase().ends_with(".json") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}.json")
    };

    Ok(file_name)
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

fn display_name_from_file_name(file_name: &str) -> String {
    file_name
        .strip_suffix(".json")
        .unwrap_or(file_name)
        .replace(['_', '-'], " ")
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(error_string)?;
    serde_json::from_str(&raw).map_err(error_string)
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    let encoded = encode_bline_json(value)?;
    fs::write(path, encoded).map_err(error_string)
}

fn encode_bline_json(value: &Value) -> Result<String, String> {
    let mut encoded = String::new();
    write_bline_json_value(&mut encoded, value, 0, None)?;
    Ok(encoded)
}

fn write_bline_json_value(
    output: &mut String,
    value: &Value,
    depth: usize,
    key: Option<&str>,
) -> Result<(), String> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => write_bline_json_number(output, value, key),
        Value::String(value) => {
            output.push_str(&serde_json::to_string(value).map_err(error_string)?)
        }
        Value::Array(values) => {
            if values.is_empty() {
                output.push_str("[]");
                return Ok(());
            }

            output.push_str("[\n");
            for (index, item) in values.iter().enumerate() {
                if index > 0 {
                    output.push_str(",\n");
                }
                write_indent(output, depth + 1);
                write_bline_json_value(output, item, depth + 1, None)?;
            }
            output.push('\n');
            write_indent(output, depth);
            output.push(']');
        }
        Value::Object(values) => {
            if values.is_empty() {
                output.push_str("{}");
                return Ok(());
            }

            output.push_str("{\n");
            for (index, (entry_key, item)) in values.iter().enumerate() {
                if index > 0 {
                    output.push_str(",\n");
                }
                write_indent(output, depth + 1);
                output.push_str(&serde_json::to_string(entry_key).map_err(error_string)?);
                output.push_str(": ");
                write_bline_json_value(output, item, depth + 1, Some(entry_key))?;
            }
            output.push('\n');
            write_indent(output, depth);
            output.push('}');
        }
    }

    Ok(())
}

fn write_bline_json_number(output: &mut String, value: &Number, key: Option<&str>) {
    if should_format_number_as_float(key) {
        if let Some(value) = value.as_f64() {
            output.push_str(&format_bline_float(value));
            return;
        }
    }

    let mut encoded = value.to_string();
    if should_format_number_as_float(key)
        && !encoded.contains('.')
        && !encoded.contains('e')
        && !encoded.contains('E')
    {
        encoded.push_str(".0");
    }
    output.push_str(&encoded);
}

fn format_bline_float(value: f64) -> String {
    let sign = if value.is_sign_negative() { -1.0 } else { 1.0 };
    let rounded_abs = (value.abs() * BLINE_FLOAT_SCALE).round() / BLINE_FLOAT_SCALE;
    let rounded = if rounded_abs == 0.0 {
        0.0
    } else {
        rounded_abs * sign
    };
    let mut encoded = format!("{rounded:.BLINE_DECIMAL_PLACES$}");

    while encoded.contains('.') && encoded.ends_with('0') {
        encoded.pop();
    }
    if encoded.ends_with('.') {
        encoded.push('0');
    }

    encoded
}

fn should_format_number_as_float(key: Option<&str>) -> bool {
    matches!(
        key,
        Some(key)
            if !matches!(
                key,
                "schema_version"
                    | "project_schema_version"
                    | "bline_project_schema_version"
                    | "bundle_schema_version"
                    | "start_ordinal"
                    | "end_ordinal"
            )
    )
}

fn write_indent(output: &mut String, depth: usize) {
    for _ in 0..depth {
        output.push_str("  ");
    }
}

const BLINE_DECIMAL_PLACES: usize = 5;
const BLINE_FLOAT_SCALE: f64 = 100_000.0;

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

fn absolutize(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
}

fn file_version(path: &Path) -> String {
    // Derive the change-detection token from file *content*, not modification time.
    // Robot deploy directories are touched constantly by git, GradleRIO, editors and
    // cloud sync; keying on mtime made those byte-identical rewrites look like a
    // concurrent edit and produced spurious "storage-conflict" save failures. Hashing
    // the bytes means only a genuine content change bumps the version. Falls back to
    // the mtime when the file cannot be read so a transient error still invalidates.
    let digest = match fs::read(path) {
        Ok(bytes) => {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            bytes.hash(&mut hasher);
            hasher.finish()
        }
        Err(_) => file_modified_millis(path) as u64,
    };
    format!("{digest:016x}:{}", path.to_string_lossy())
}

fn workspace_version(path: &Path) -> Result<String, String> {
    let mut parts = vec![file_version(&path.join("config.json"))];
    let paths_dir = path.join("paths");
    let editor_state_file = editor_state_file(path);
    let metadata_file = path_metadata_file(path);
    let field_asset_metadata_file = field_asset_metadata_file(path);
    let field_assets_dir = field_assets_dir(path);
    let legacy_field_assets_dir = legacy_field_assets_dir(path);
    let path_groups_file = path_groups_file(path);

    if editor_state_file.exists() {
        parts.push(file_version(&editor_state_file));
    }
    if metadata_file.exists() {
        parts.push(file_version(&metadata_file));
    }
    if field_asset_metadata_file.exists() {
        parts.push(file_version(&field_asset_metadata_file));
    }
    if path_groups_file.exists() {
        parts.push(file_version(&path_groups_file));
    }

    if paths_dir.is_dir() {
        for entry in fs::read_dir(paths_dir).map_err(error_string)? {
            let entry = entry.map_err(error_string)?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                parts.push(file_version(&path));
            }
        }
    }
    for assets_dir in [field_assets_dir, legacy_field_assets_dir] {
        if !assets_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(assets_dir).map_err(error_string)? {
            let entry = entry.map_err(error_string)?;
            let path = entry.path();
            if path.is_file() {
                parts.push(file_version(&path));
            }
        }
    }

    parts.sort();
    Ok(parts.join("|"))
}

fn file_updated_at(path: &Path) -> String {
    file_modified_millis(path).to_string()
}

fn file_modified_millis(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        })
}

fn unix_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn error_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        thread::sleep,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn pretty_json_preserves_bline_key_order() {
        let value = json!({
            "path_elements": [
                {
                    "type": "waypoint",
                    "translation_target": {
                        "x_meters": 6.830235379219491,
                        "y_meters": 0.22000000000000003,
                        "intermediate_handoff_radius_meters": 0.15000000000000002
                    },
                    "rotation_target": {
                        "rotation_radians": std::f64::consts::PI,
                        "profiled_rotation": true
                    }
                },
                {
                    "type": "event_trigger",
                    "t_ratio": 0.303547298130239,
                    "lib_key": "shoot"
                }
            ],
            "constraints": {
                "max_velocity_meters_per_sec": 4.5,
                "max_acceleration_meters_per_sec2": 12.0000004,
                "end_translation_tolerance_meters": 0.03,
                "max_velocity_deg_per_sec": [
                    {
                        "value": 90.0000049,
                        "start_ordinal": 0,
                        "end_ordinal": 1
                    }
                ]
            }
        });
        let encoded = encode_bline_json(&value).expect("JSON should encode");

        assert_order(
            &encoded,
            &[
                "\"path_elements\"",
                "\"type\": \"waypoint\"",
                "\"translation_target\"",
                "\"x_meters\": 6.83024",
                "\"y_meters\": 0.22",
                "\"intermediate_handoff_radius_meters\": 0.15",
                "\"rotation_target\"",
                "\"rotation_radians\": 3.14159",
                "\"profiled_rotation\"",
                "\"type\": \"event_trigger\"",
                "\"t_ratio\": 0.30355",
                "\"lib_key\"",
                "\"constraints\"",
                "\"max_velocity_meters_per_sec\": 4.5",
                "\"max_acceleration_meters_per_sec2\": 12.0",
                "\"end_translation_tolerance_meters\": 0.03",
                "\"max_velocity_deg_per_sec\"",
                "\"value\": 90.0",
                "\"start_ordinal\": 0",
                "\"end_ordinal\": 1",
            ],
        );
    }

    #[test]
    fn runtime_config_value_keeps_only_bline_lib_keys() {
        let runtime = runtime_config_value(&json!({
            "gui": {
                "robot": {
                    "length_meters": 0.7,
                    "width_meters": 0.9
                }
            },
            "kinematic_constraints": {
                "default_max_velocity_meters_per_sec": 5.1,
                "default_max_acceleration_meters_per_sec2": 10.5,
                "default_intermediate_handoff_radius_meters": 0.28,
                "default_max_velocity_deg_per_sec": 650,
                "default_max_acceleration_deg_per_sec2": 1700,
                "default_end_translation_tolerance_meters": 0.04,
                "default_end_rotation_tolerance_deg": 3,
                "default_auto_velocity_velocity_safety_factor": 0.72
            }
        }));

        assert_eq!(
            runtime,
            json!({
                "kinematic_constraints": {
                    "default_max_velocity_meters_per_sec": 5.1,
                    "default_max_acceleration_meters_per_sec2": 10.5,
                    "default_max_velocity_deg_per_sec": 650,
                    "default_max_acceleration_deg_per_sec2": 1700,
                    "default_end_translation_tolerance_meters": 0.04,
                    "default_end_rotation_tolerance_deg": 3,
                    "default_intermediate_handoff_radius_meters": 0.28
                }
            })
        );
    }

    #[test]
    fn write_workspace_helpers_emit_sidecar_and_remove_legacy_files() {
        let dir = temp_autos_dir("write-clean-storage");
        fs::create_dir_all(dir.join("paths")).expect("paths dir");
        fs::create_dir_all(dir.join(".bline-web")).expect("state dir");
        fs::create_dir_all(dir.join("assets").join("fields")).expect("legacy assets dir");
        fs::write(dir.join("pathgroups.json"), "{}").expect("legacy pathgroups");
        fs::write(dir.join(".bline-web").join("path-metadata.json"), "{}")
            .expect("legacy path metadata");
        fs::write(
            dir.join(".bline-web").join("field-assets.json"),
            r#"{"assets":{}}"#,
        )
        .expect("legacy field metadata");
        fs::write(
            dir.join("assets").join("fields").join("field-test.png"),
            [1_u8, 2, 3],
        )
        .expect("legacy field asset");

        let workspace = json!({
            "config": {
                "gui": {
                    "robot": {
                        "length_meters": 0.7,
                        "width_meters": 0.9
                    },
                    "field": {
                        "selected_field_id": "custom:field-test.png",
                        "custom_fields": [
                            {
                                "id": "custom:field-test.png",
                                "name": "Test Field",
                                "asset_id": "field-test.png",
                                "file_name": "field-test.png",
                                "mime_type": "image/png",
                                "size_bytes": 3,
                                "created_at": "2026-06-22T00:00:00.000Z",
                                "geometry": {
                                    "length_meters": 16,
                                    "width_meters": 8,
                                    "coordinate_offset_meters": 0
                                }
                            }
                        ]
                    }
                },
                "kinematic_constraints": {
                    "default_max_velocity_meters_per_sec": 5.1,
                    "default_max_acceleration_meters_per_sec2": 10.5,
                    "default_intermediate_handoff_radius_meters": 0.28,
                    "default_max_velocity_deg_per_sec": 650,
                    "default_max_acceleration_deg_per_sec2": 1700,
                    "default_end_translation_tolerance_meters": 0.04,
                    "default_end_rotation_tolerance_deg": 3,
                    "default_auto_velocity_velocity_safety_factor": 0.72
                }
            },
            "paths": [
                {
                    "path_id": "auto",
                    "display_name": "Auto",
                    "file_name": "auto.json",
                    "path": {
                        "path_elements": []
                    },
                    "editor_metadata": {
                        "ranged_constraints": [
                            {
                                "key": "max_velocity_meters_per_sec",
                                "value": 2.2,
                                "start_ordinal": 1,
                                "end_ordinal": 2,
                                "source": "auto_velocity"
                            }
                        ]
                    }
                }
            ],
            "active_path_id": "auto",
            "path_groups": [
                {
                    "group_id": "score",
                    "display_name": "Score Autos",
                    "path_ids": ["auto"]
                }
            ],
            "active_path_group_id": "score"
        });
        let paths = workspace
            .get("paths")
            .and_then(Value::as_array)
            .expect("workspace paths");

        write_json_file(
            &dir.join("config.json"),
            &runtime_config_value(workspace.get("config").expect("config")),
        )
        .expect("runtime config write");
        write_editor_state_from_workspace(&dir, &workspace, paths).expect("sidecar write");
        remove_legacy_editor_files(&dir).expect("legacy cleanup");

        let config = read_json_file(&dir.join("config.json")).expect("config");
        assert!(config.get("gui").is_none());
        assert_eq!(
            config
                .get("kinematic_constraints")
                .and_then(Value::as_object)
                .expect("constraints")
                .len(),
            7
        );

        let state = read_json_file(&editor_state_file(&dir)).expect("state");
        assert_eq!(state.get("schema_version"), Some(&json!(1)));
        assert_eq!(
            state.pointer("/editor_config/gui/robot/length_meters"),
            Some(&json!(0.7))
        );
        assert_eq!(
            state.get("active_path_file_name"),
            Some(&json!("auto.json"))
        );
        assert_eq!(
            state.pointer("/path_groups/0/path_file_names/0"),
            Some(&json!("auto.json"))
        );
        assert_eq!(
            state.pointer("/paths/auto.json/editor_metadata/ranged_constraints/0/source"),
            Some(&json!("auto_velocity"))
        );
        assert_eq!(
            state.pointer("/field_assets/field-test.png/mime_type"),
            Some(&json!("image/png"))
        );
        assert!(!path_groups_file(&dir).exists());
        assert!(!path_metadata_file(&dir).exists());
        assert!(!field_asset_metadata_file(&dir).exists());
        assert!(!legacy_field_assets_dir(&dir)
            .join("field-test.png")
            .exists());
        assert!(field_assets_dir(&dir).join("field-test.png").exists());

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn legacy_desktop_sidecar_inputs_remain_readable() {
        let dir = temp_autos_dir("read-legacy-storage");
        fs::create_dir_all(dir.join(".bline-web")).expect("state dir");
        fs::create_dir_all(dir.join("assets").join("fields")).expect("legacy assets dir");
        fs::write(
            path_groups_file(&dir),
            r#"{"schema_version":1,"groups":[{"group_id":"legacy","display_name":"Legacy","path_file_names":["auto.json"]}]}"#,
        )
        .expect("legacy pathgroups");
        fs::write(
            path_metadata_file(&dir),
            r#"{"paths":{"auto.json":{"editor_metadata":{"ranged_constraints":[{"key":"max_velocity_meters_per_sec","value":2.2,"start_ordinal":1,"end_ordinal":2,"source":"auto_velocity"}]}}}}"#,
        )
        .expect("legacy path metadata");
        fs::write(
            field_asset_metadata_file(&dir),
            r#"{"assets":{"field-test.png":{"file_name":"practice.png","mime_type":"image/png"}}}"#,
        )
        .expect("legacy field metadata");
        fs::write(
            legacy_field_assets_dir(&dir).join("field-test.png"),
            [1_u8, 2, 3],
        )
        .expect("legacy asset");
        let paths = vec![json!({
            "path_id": "auto.json",
            "display_name": "Auto",
            "file_name": "auto.json",
            "path": {
                "path_elements": []
            }
        })];

        let groups = read_path_groups(&dir, &paths, None).expect("path groups");
        let metadata = read_path_metadata(&dir, None).expect("path metadata");
        let asset_metadata =
            read_field_asset_metadata(&dir, "field-test.png").expect("field metadata");

        assert_eq!(groups[0].get("group_id"), Some(&json!("legacy")));
        assert_eq!(groups[0].pointer("/path_ids/0"), Some(&json!("auto.json")));
        assert_eq!(
            metadata
                .get("auto.json")
                .and_then(|value| value.pointer("/ranged_constraints/0/source")),
            Some(&json!("auto_velocity"))
        );
        assert_eq!(asset_metadata.file_name.as_deref(), Some("practice.png"));
        assert_eq!(
            field_asset_path(&dir, "field-test.png"),
            legacy_field_assets_dir(&dir).join("field-test.png")
        );

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_user_migrates_legacy_autos_folder_on_save_and_reopen() {
        let dir = temp_autos_dir("desktop-legacy-migration");
        write_legacy_autos_fixture(&dir);

        let workspace = read_workspace_from_project_dir(&dir, Some("b_native.json".to_owned()))
            .expect("legacy workspace should open");

        assert_eq!(
            workspace.get("active_path_id"),
            Some(&json!("b_native.json"))
        );
        assert_eq!(
            workspace.pointer("/config/gui/robot/length_meters"),
            Some(&json!(0.71))
        );
        assert_eq!(
            workspace.pointer("/config/kinematic_constraints/default_max_velocity_meters_per_sec"),
            Some(&json!(5.1))
        );
        assert_eq!(
            workspace
                .get("paths")
                .and_then(Value::as_array)
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(|path| path.get("file_name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                }),
            Some(vec!["a_wrapped.json", "b_native.json", "stale.json"])
        );
        assert!(
            workspace
                .get("paths")
                .and_then(Value::as_array)
                .and_then(|paths| paths.first())
                .and_then(|path| path.get("path"))
                .and_then(|path| path.get("path"))
                .is_none(),
            "wrapped legacy path files should be unwrapped before entering the workspace model",
        );
        assert_eq!(
            workspace.pointer("/path_groups/0/path_ids"),
            Some(&json!(["b_native.json", "a_wrapped.json"]))
        );
        assert_eq!(
            workspace.pointer("/paths/0/editor_metadata/ranged_constraints/0/source"),
            Some(&json!("auto_velocity"))
        );
        let legacy_asset =
            read_field_asset_from_project_dir(&dir, "field-old.png").expect("legacy asset read");
        assert_eq!(legacy_asset.expect("legacy asset").bytes, vec![1, 2, 3]);

        let initial_version = workspace_version(&dir).expect("initial version");
        let mut edited = workspace.clone();
        let paths = edited
            .get_mut("paths")
            .and_then(Value::as_array_mut)
            .expect("workspace paths");
        paths.retain(|path| path.get("file_name").and_then(Value::as_str) != Some("stale.json"));
        for path in paths {
            if path.get("file_name").and_then(Value::as_str) == Some("a_wrapped.json") {
                path.as_object_mut()
                    .expect("path object")
                    .insert("display_name".to_owned(), json!("Wrapped Auto"));
            }
        }
        edited
            .as_object_mut()
            .expect("workspace object")
            .insert("active_path_id".to_owned(), json!("a_wrapped.json"));

        let write_result = write_workspace_to_project_dir(&dir, &edited, Some(&initial_version))
            .expect("save migrated workspace");
        assert_eq!(
            write_result.active_path_file_name.as_deref(),
            Some("a_wrapped.json")
        );

        let config = read_json_file(&dir.join("config.json")).expect("runtime config");
        assert!(config.get("gui").is_none());
        assert_eq!(
            config
                .get("kinematic_constraints")
                .and_then(Value::as_object)
                .expect("constraints")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            RUNTIME_CONSTRAINT_KEYS
                .iter()
                .map(|key| key.to_string())
                .collect::<Vec<_>>()
        );
        assert!(
            config
                .pointer("/kinematic_constraints/default_auto_velocity_velocity_safety_factor")
                .is_none(),
            "auto velocity editor defaults must stay out of config.json",
        );

        let wrapped_path =
            read_json_file(&dir.join("paths").join("a_wrapped.json")).expect("path file");
        assert!(wrapped_path.get("path").is_none());
        assert!(wrapped_path.get("path_elements").is_some());
        assert!(!dir.join("paths").join("stale.json").exists());

        let state = read_json_file(&editor_state_file(&dir)).expect("sidecar state");
        assert_eq!(
            state.get("active_path_file_name"),
            Some(&json!("a_wrapped.json"))
        );
        assert_eq!(
            state.pointer("/editor_config/gui/robot/length_meters"),
            Some(&json!(0.71))
        );
        assert_eq!(
            state.pointer(
                "/editor_config/kinematic_constraints/default_auto_velocity_velocity_safety_factor"
            ),
            Some(&json!(0.72))
        );
        assert_eq!(
            state.pointer("/path_groups/0/path_file_names"),
            Some(&json!(["b_native.json", "a_wrapped.json"]))
        );
        assert_eq!(
            state.pointer("/paths/a_wrapped.json/display_name"),
            Some(&json!("Wrapped Auto"))
        );
        assert_eq!(
            state.pointer("/paths/a_wrapped.json/editor_metadata/ranged_constraints/0/source"),
            Some(&json!("auto_velocity"))
        );
        assert_eq!(
            state.pointer("/field_assets/field-old.png/file_name"),
            Some(&json!("practice-field.png"))
        );
        assert!(!path_groups_file(&dir).exists());
        assert!(!path_metadata_file(&dir).exists());
        assert!(!field_asset_metadata_file(&dir).exists());
        assert!(!legacy_field_assets_dir(&dir).join("field-old.png").exists());
        assert!(field_assets_dir(&dir).join("field-old.png").exists());

        let reopened =
            read_workspace_from_project_dir(&dir, None).expect("clean workspace should reopen");
        assert_eq!(
            reopened.get("active_path_id"),
            Some(&json!("a_wrapped.json"))
        );
        assert_eq!(
            reopened.pointer("/paths/0/display_name"),
            Some(&json!("Wrapped Auto"))
        );
        assert_eq!(
            reopened.pointer("/config/gui/robot/length_meters"),
            Some(&json!(0.71))
        );
        let moved_asset =
            read_field_asset_from_project_dir(&dir, "field-old.png").expect("moved asset read");
        assert_eq!(moved_asset.expect("moved asset").bytes, vec![1, 2, 3]);

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_user_linked_targets_survive_save_and_reopen() {
        let dir = temp_autos_dir("desktop-linked-targets");
        let workspace = json!({
            "schema_version": 1,
            "project_id": dir.to_string_lossy(),
            "display_name": "autos",
            "config": {},
            "paths": [
                {
                    "path_id": "auto.json",
                    "display_name": "Auto",
                    "file_name": "auto.json",
                    "path": {
                        "path_elements": [
                            { "type": "translation", "x_meters": 1, "y_meters": 2 }
                        ]
                    },
                    "editor_metadata": {
                        "linked_targets": [
                            { "element_index": 0, "target_id": "note-a" }
                        ]
                    }
                }
            ],
            "active_path_id": "auto.json",
            "path_groups": [],
            "linked_targets": [
                {
                    "target_id": "note-a",
                    "display_name": "Note A",
                    "kind": "translation",
                    "x_meters": 1,
                    "y_meters": 2
                }
            ]
        });

        write_workspace_to_project_dir(&dir, &workspace, None).expect("workspace save");

        let state = read_json_file(&editor_state_file(&dir)).expect("sidecar state");
        assert_eq!(
            state.pointer("/linked_targets/0/target_id"),
            Some(&json!("note-a"))
        );

        let reopened =
            read_workspace_from_project_dir(&dir, None).expect("workspace should reopen");
        assert_eq!(
            reopened.pointer("/linked_targets/0/target_id"),
            Some(&json!("note-a"))
        );
        assert_eq!(
            reopened.pointer("/paths/0/editor_metadata/linked_targets/0/target_id"),
            Some(&json!("note-a"))
        );

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_user_opens_new_clean_autos_folder_with_sidecar_state() {
        let dir = temp_autos_dir("desktop-clean-sidecar");
        fs::create_dir_all(dir.join("paths")).expect("paths dir");
        fs::create_dir_all(dir.join(".bline-web")).expect("sidecar dir");
        write_fixture_json(
            &dir.join("config.json"),
            &json!({
                "kinematic_constraints": {
                    "default_max_velocity_meters_per_sec": 6.2,
                    "default_max_acceleration_meters_per_sec2": 13.1,
                    "default_max_velocity_deg_per_sec": 700,
                    "default_max_acceleration_deg_per_sec2": 1800,
                    "default_end_translation_tolerance_meters": 0.05,
                    "default_end_rotation_tolerance_deg": 2.5,
                    "default_intermediate_handoff_radius_meters": 0.33
                }
            }),
        );
        write_fixture_json(
            &dir.join("paths").join("alpha.json"),
            &json!({
                "path_elements": [
                    { "type": "translation", "x_meters": 1, "y_meters": 2 }
                ]
            }),
        );
        write_fixture_json(
            &dir.join("paths").join("beta.json"),
            &json!({
                "path_elements": [
                    { "type": "translation", "x_meters": 3, "y_meters": 4 }
                ]
            }),
        );
        write_fixture_json(
            &editor_state_file(&dir),
            &json!({
                "schema_version": 1,
                "editor_config": {
                    "gui": {
                        "robot": {
                            "length_meters": 0.81,
                            "width_meters": 0.93
                        },
                        "protrusions": {
                            "enabled": true,
                            "distance_meters": 0.2,
                            "side": "front",
                            "default_state": "hidden",
                            "show_on_event_keys": ["intake"],
                            "hide_on_event_keys": ["stow"]
                        }
                    },
                    "kinematic_constraints": {
                        "default_auto_velocity_velocity_safety_factor": 0.66,
                        "default_auto_velocity_acceleration_safety_factor": 0.55,
                        "default_auto_velocity_merge_tolerance_meters_per_sec": 0.22
                    }
                },
                "active_path_file_name": "beta.json",
                "active_path_group_id": "group-clean",
                "path_groups": [
                    {
                        "group_id": "group-clean",
                        "display_name": "Clean Group",
                        "path_file_names": ["beta.json", "alpha.json"]
                    }
                ],
                "paths": {
                    "alpha.json": {
                        "display_name": "Alpha Auto"
                    },
                    "beta.json": {
                        "display_name": "Beta Auto",
                        "editor_metadata": {
                            "ranged_constraints": [
                                {
                                    "key": "max_velocity_meters_per_sec",
                                    "value": 2.4,
                                    "start_ordinal": 1,
                                    "end_ordinal": 1,
                                    "source": "auto_velocity"
                                }
                            ]
                        }
                    }
                },
                "field_assets": {}
            }),
        );

        let workspace = read_workspace_from_project_dir(&dir, Some("alpha.json".to_owned()))
            .expect("clean workspace should open");

        assert_eq!(workspace.get("active_path_id"), Some(&json!("beta.json")));
        assert_eq!(
            workspace.pointer("/active_path_group_id"),
            Some(&json!("group-clean"))
        );
        assert_eq!(
            workspace.pointer("/config/gui/protrusions/show_on_event_keys/0"),
            Some(&json!("intake"))
        );
        assert_eq!(
            workspace.pointer(
                "/config/kinematic_constraints/default_auto_velocity_velocity_safety_factor"
            ),
            Some(&json!(0.66))
        );
        assert_eq!(
            workspace.pointer("/paths/0/display_name"),
            Some(&json!("Alpha Auto"))
        );
        assert_eq!(
            workspace.pointer("/paths/1/editor_metadata/ranged_constraints/0/source"),
            Some(&json!("auto_velocity"))
        );
        assert_eq!(
            workspace.pointer("/path_groups/0/path_ids"),
            Some(&json!(["beta.json", "alpha.json"]))
        );

        let before = workspace_version(&dir).expect("clean version");
        write_workspace_to_project_dir(&dir, &workspace, Some(&before))
            .expect("clean workspace resave");
        let config = read_json_file(&dir.join("config.json")).expect("runtime config");
        assert!(config.get("gui").is_none());
        assert!(!path_groups_file(&dir).exists());
        assert!(!path_metadata_file(&dir).exists());
        assert!(!field_asset_metadata_file(&dir).exists());

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_user_field_asset_lifecycle_uses_sidecar_assets() {
        let dir = temp_autos_dir("desktop-field-assets");

        write_field_asset_to_project_dir(
            &dir,
            "field-new.png",
            "practice-field.png",
            "image/png",
            vec![9, 8, 7],
        )
        .expect("field asset upload");

        let payload = read_field_asset_from_project_dir(&dir, "field-new.png")
            .expect("field asset read")
            .expect("field asset payload");
        assert_eq!(payload.file_name, "practice-field.png");
        assert_eq!(payload.mime_type, "image/png");
        assert_eq!(payload.bytes, vec![9, 8, 7]);
        assert!(field_assets_dir(&dir).join("field-new.png").exists());
        assert_eq!(
            read_json_file(&editor_state_file(&dir))
                .expect("state")
                .pointer("/field_assets/field-new.png/mime_type"),
            Some(&json!("image/png"))
        );

        fs::create_dir_all(legacy_field_assets_dir(&dir)).expect("legacy assets dir");
        fs::write(
            legacy_field_assets_dir(&dir).join("field-new.png"),
            [1_u8, 1, 1],
        )
        .expect("legacy duplicate");
        delete_field_asset_from_project_dir(&dir, "field-new.png").expect("delete asset");

        assert!(!field_assets_dir(&dir).join("field-new.png").exists());
        assert!(!legacy_field_assets_dir(&dir).join("field-new.png").exists());
        assert!(read_json_file(&editor_state_file(&dir))
            .expect("state")
            .pointer("/field_assets/field-new.png")
            .is_none());
        assert!(read_field_asset_from_project_dir(&dir, "field-new.png")
            .expect("read deleted asset")
            .is_none());

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_workspace_version_tracks_sidecar_and_legacy_asset_conflicts() {
        let dir = temp_autos_dir("desktop-version-conflicts");
        fs::create_dir_all(dir.join("paths")).expect("paths dir");
        write_fixture_json(
            &dir.join("paths").join("auto.json"),
            &json!({ "path_elements": [] }),
        );
        let workspace = read_workspace_from_project_dir(&dir, None).expect("workspace should open");
        let before = workspace_version(&dir).expect("version before");

        sleep(Duration::from_millis(10));
        write_fixture_json(
            &editor_state_file(&dir),
            &json!({
                "schema_version": 1,
                "active_path_file_name": "auto.json",
                "paths": {
                    "auto.json": {
                        "display_name": "Externally Edited"
                    }
                }
            }),
        );
        let after_sidecar = workspace_version(&dir).expect("version after sidecar");
        assert_ne!(before, after_sidecar);
        assert!(
            write_workspace_to_project_dir(&dir, &workspace, Some(&before))
                .expect_err("stale version should conflict")
                .contains("storage-conflict")
        );

        sleep(Duration::from_millis(10));
        fs::create_dir_all(legacy_field_assets_dir(&dir)).expect("legacy assets dir");
        fs::write(
            legacy_field_assets_dir(&dir).join("legacy-field.png"),
            [4_u8, 5, 6],
        )
        .expect("legacy asset");
        let after_legacy_asset = workspace_version(&dir).expect("version after legacy asset");
        assert_ne!(after_sidecar, after_legacy_asset);

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn desktop_no_op_external_touch_does_not_conflict() {
        // Reproduces the reported "Save failed: storage-conflict" bug: an external
        // tool (git checkout / gradle deploy / cloud sync) rewrites a path file with
        // byte-identical content, changing only its mtime. That must NOT invalidate
        // the workspace version or block the next save.
        let dir = temp_autos_dir("desktop-no-op-touch");
        let path_file = dir.join("paths").join("auto.json");
        write_fixture_json(&path_file, &json!({ "path_elements": [] }));

        let workspace = read_workspace_from_project_dir(&dir, None).expect("workspace should open");
        let before = workspace_version(&dir).expect("version before");

        // External process rewrites identical bytes a moment later.
        sleep(Duration::from_millis(10));
        write_fixture_json(&path_file, &json!({ "path_elements": [] }));

        let after = workspace_version(&dir).expect("version after touch");
        assert_eq!(
            before, after,
            "a byte-identical rewrite must not change the workspace version"
        );
        write_workspace_to_project_dir(&dir, &workspace, Some(&before))
            .expect("a no-op external touch must not produce a save conflict");

        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn opening_paths_subfolder_redirects_to_parent_project() {
        // Reproduces the nested "paths/paths" bug: selecting the paths subfolder of an
        // existing BLine project must resolve to the project itself, not treat the
        // subfolder as a new project (which would create paths/paths + a stray config).
        let project = temp_autos_dir("nested-paths-guard");
        ensure_project_structure(&project).expect("project structure");
        let paths_subdir = project.join("paths");
        assert!(paths_subdir.is_dir(), "paths subdir should exist");

        let effective = effective_project_dir(&paths_subdir);
        assert_eq!(
            effective,
            absolutize(&project),
            "selecting the paths subfolder should open the parent project"
        );

        fs::remove_dir_all(project).expect("cleanup");
    }

    fn assert_order(haystack: &str, needles: &[&str]) {
        let mut cursor = 0;
        for needle in needles {
            let offset = haystack[cursor..]
                .find(needle)
                .unwrap_or_else(|| panic!("missing {needle} after byte {cursor}"));
            cursor += offset + needle.len();
        }
    }

    fn write_legacy_autos_fixture(dir: &Path) {
        fs::create_dir_all(dir.join("paths")).expect("paths dir");
        fs::create_dir_all(dir.join(".bline-web")).expect("legacy metadata dir");
        fs::create_dir_all(legacy_field_assets_dir(dir)).expect("legacy assets dir");

        write_fixture_json(
            &dir.join("config.json"),
            &json!({
                "gui": {
                    "robot": {
                        "length_meters": 0.71,
                        "width_meters": 0.92
                    },
                    "protrusions": {
                        "enabled": true,
                        "distance_meters": 0.25,
                        "side": "front",
                        "default_state": "hidden",
                        "show_on_event_keys": ["intake"],
                        "hide_on_event_keys": ["stow"]
                    },
                    "field": {
                        "selected_field_id": "custom:field-old.png",
                        "custom_fields": [
                            {
                                "id": "custom:field-old.png",
                                "name": "Practice Field",
                                "asset_id": "field-old.png",
                                "file_name": "practice-field.png",
                                "mime_type": "image/png",
                                "size_bytes": 3,
                                "created_at": "2026-06-22T00:00:00.000Z",
                                "geometry": {
                                    "length_meters": 16,
                                    "width_meters": 8,
                                    "coordinate_offset_meters": 0
                                }
                            }
                        ]
                    }
                },
                "kinematic_constraints": {
                    "default_max_velocity_meters_per_sec": 5.1,
                    "default_max_acceleration_meters_per_sec2": 10.5,
                    "default_intermediate_handoff_radius_meters": 0.28,
                    "default_max_velocity_deg_per_sec": 650,
                    "default_max_acceleration_deg_per_sec2": 1700,
                    "default_end_translation_tolerance_meters": 0.04,
                    "default_end_rotation_tolerance_deg": 3,
                    "default_auto_velocity_velocity_safety_factor": 0.72,
                    "default_auto_velocity_acceleration_safety_factor": 0.63,
                    "default_auto_velocity_merge_tolerance_meters_per_sec": 0.21
                }
            }),
        );
        write_fixture_json(
            &path_groups_file(dir),
            &json!({
                "schema_version": 1,
                "groups": [
                    {
                        "group_id": "score",
                        "display_name": "Score Autos",
                        "path_file_names": ["b_native.json", "a_wrapped.json", "missing.json"]
                    }
                ]
            }),
        );
        write_fixture_json(
            &path_metadata_file(dir),
            &json!({
                "paths": {
                    "a_wrapped.json": {
                        "editor_metadata": {
                            "ranged_constraints": [
                                {
                                    "key": "max_velocity_meters_per_sec",
                                    "value": 2.2,
                                    "start_ordinal": 1,
                                    "end_ordinal": 2,
                                    "source": "auto_velocity",
                                    "auto_velocity": {
                                        "velocity_safety_factor": 0.7,
                                        "acceleration_safety_factor": 0.6,
                                        "merge_tolerance_meters_per_sec": 0.2
                                    }
                                }
                            ]
                        }
                    },
                    "b_native.json": {
                        "editor_metadata": {
                            "ranged_constraints": [
                                {
                                    "key": "max_acceleration_meters_per_sec2",
                                    "value": 3.3,
                                    "start_ordinal": 1,
                                    "end_ordinal": 1,
                                    "source": "auto_velocity"
                                }
                            ]
                        }
                    }
                }
            }),
        );
        write_fixture_json(
            &field_asset_metadata_file(dir),
            &json!({
                "assets": {
                    "field-old.png": {
                        "file_name": "practice-field.png",
                        "mime_type": "image/png"
                    }
                }
            }),
        );
        fs::write(
            legacy_field_assets_dir(dir).join("field-old.png"),
            [1_u8, 2, 3],
        )
        .expect("legacy field asset");
        write_fixture_json(
            &dir.join("paths").join("a_wrapped.json"),
            &json!({
                "path": {
                    "path_elements": [
                        { "type": "translation", "x_meters": 1, "y_meters": 2 },
                        { "type": "translation", "x_meters": 3, "y_meters": 4 }
                    ],
                    "constraints": {
                        "max_velocity_meters_per_sec": [
                            { "value": 2.2, "start_ordinal": 0, "end_ordinal": 1 }
                        ]
                    }
                }
            }),
        );
        write_fixture_json(
            &dir.join("paths").join("b_native.json"),
            &json!({
                "path_elements": [
                    { "type": "translation", "x_meters": 5, "y_meters": 6 }
                ]
            }),
        );
        write_fixture_json(
            &dir.join("paths").join("stale.json"),
            &json!({
                "path_elements": [
                    { "type": "translation", "x_meters": 9, "y_meters": 9 }
                ]
            }),
        );
    }

    fn write_fixture_json(path: &Path, value: &Value) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("fixture parent dir");
        }
        fs::write(
            path,
            serde_json::to_string_pretty(value).expect("fixture JSON"),
        )
        .expect("fixture write");
    }

    fn temp_autos_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bline-web-{label}-{stamp}"));
        fs::create_dir_all(&dir).expect("temp autos dir");
        dir
    }
}
