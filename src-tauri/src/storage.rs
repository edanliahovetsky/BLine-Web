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

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct DesktopStorageState {
    current_project_dir: Option<String>,
    recent_project_dirs: Vec<String>,
    active_path_by_project_dir: std::collections::HashMap<String, String>,
}

const DEFAULT_CONFIG_JSON: &str = r#"{
  "gui": {
    "robot": {
      "length_meters": 0.5,
      "width_meters": 0.5
    },
    "protrusions": {
      "enabled": false,
      "distance_meters": 0,
      "side": "none",
      "default_state": "",
      "show_on_event_keys": [],
      "hide_on_event_keys": []
    }
  },
  "kinematic_constraints": {
    "default_max_velocity_meters_per_sec": 4.5,
    "default_max_acceleration_meters_per_sec2": 7,
    "default_intermediate_handoff_radius_meters": 0.2,
    "default_max_velocity_deg_per_sec": 720,
    "default_max_acceleration_deg_per_sec2": 1500,
    "default_end_translation_tolerance_meters": 0.03,
    "default_end_rotation_tolerance_deg": 2
  }
}"#;

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
    ensure_project_structure(&dir)?;

    let config = read_config_or_default(&dir)?;
    let metadata_by_file = read_path_metadata(&dir)?;
    let paths_dir = dir.join("paths");
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
            "display_name": display_name_from_file_name(file_name),
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

    let state = read_state(&app)?;
    let dir_string = dir.to_string_lossy().to_string();
    let stored_active = state
        .active_path_by_project_dir
        .get(&dir_string)
        .cloned();
    let active_path_id = stored_active
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
        "project_id": dir_string,
        "display_name": workspace_display_name(&dir),
        "config": config,
        "paths": paths,
        "active_path_id": active_path_id
    }))
}

#[tauri::command]
pub fn storage_write_workspace(
    app: AppHandle,
    workspace: Value,
    expected: Option<String>,
) -> Result<WriteResult, String> {
    let dir = require_current_project_dir(&app)?;
    ensure_project_structure(&dir)?;

    if let Some(expected) = expected.as_deref() {
        let actual = workspace_version(&dir)?;
        if actual != expected {
            return Err("storage-conflict: workspace version mismatch".to_owned());
        }
    }

    if let Some(config) = workspace.get("config") {
        write_json_file(&dir.join("config.json"), config)?;
    }

    let paths = workspace
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workspace document is missing paths".to_owned())?;
    let paths_dir = dir.join("paths");
    fs::create_dir_all(&paths_dir).map_err(error_string)?;
    let mut retained_files = std::collections::HashSet::new();
    let mut metadata_by_file = serde_json::Map::new();

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

        if let Some(editor_metadata) = path_entry.get("editor_metadata") {
            metadata_by_file.insert(file_name.clone(), editor_metadata.clone());
        }
    }

    write_path_metadata(&dir, &metadata_by_file)?;

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

    let active_path_id = workspace
        .get("active_path_id")
        .and_then(Value::as_str)
        .and_then(|active_id| {
            paths.iter().find_map(|path| {
                let path_id = path.get("path_id").and_then(Value::as_str);
                let file_name = path.get("file_name").and_then(Value::as_str);
                if path_id == Some(active_id) {
                    file_name.map(str::to_owned)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            paths
                .first()
                .and_then(|path| path.get("file_name"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        });

    let mut state = read_state(&app)?;
    let dir_string = dir.to_string_lossy().to_string();
    if let Some(active_path_id) = active_path_id {
        state
            .active_path_by_project_dir
            .insert(dir_string, safe_path_file_name(&active_path_id)?);
    }
    write_state(&app, &state)?;

    let updated_at = unix_millis();
    Ok(WriteResult {
        version: workspace_version(&dir)?,
        updated_at,
    })
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
    let config = read_config_or_default(&dir)?;

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
        write_json_file(&dir.join("config.json"), config)?;
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
    state.recent_project_dirs.retain(|entry| entry != &dir_string);
    state.recent_project_dirs.insert(0, dir_string);
    state.recent_project_dirs.truncate(10);
    write_state(app, &state)?;

    workspace_summary(&effective_dir)
}

fn effective_project_dir(selected_dir: &Path) -> PathBuf {
    let selected = absolutize(selected_dir);
    if selected.file_name().and_then(|name| name.to_str()) == Some("autos") {
        return selected;
    }

    let deploy_dir = selected.join("src").join("main").join("deploy");
    if deploy_dir.is_dir() {
        return deploy_dir.join("autos");
    }

    selected
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

fn read_path_metadata(project_dir: &Path) -> Result<serde_json::Map<String, Value>, String> {
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

fn write_path_metadata(
    project_dir: &Path,
    metadata_by_file: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    let metadata_file = path_metadata_file(project_dir);
    if metadata_by_file.is_empty() {
        if metadata_file.exists() {
            fs::remove_file(metadata_file).map_err(error_string)?;
        }
        return Ok(());
    }

    let metadata_dir = metadata_file
        .parent()
        .ok_or_else(|| "Invalid metadata path".to_owned())?;
    fs::create_dir_all(metadata_dir).map_err(error_string)?;

    let mut paths = serde_json::Map::new();
    for (file_name, editor_metadata) in metadata_by_file {
        paths.insert(
            file_name.clone(),
            json!({ "editor_metadata": editor_metadata })
        );
    }

    write_json_file(&metadata_file, &json!({ "paths": paths }))
}

fn path_metadata_file(project_dir: &Path) -> PathBuf {
    project_dir.join(".bline-web").join("path-metadata.json")
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
    format!("{}:{}", file_modified_millis(path), path.to_string_lossy())
}

fn workspace_version(path: &Path) -> Result<String, String> {
    let mut parts = vec![file_version(&path.join("config.json"))];
    let paths_dir = path.join("paths");
    let metadata_file = path_metadata_file(path);

    if metadata_file.exists() {
        parts.push(file_version(&metadata_file));
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
    use super::encode_bline_json;
    use serde_json::json;

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
                        "rotation_radians": 3.141592653589793,
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

    fn assert_order(haystack: &str, needles: &[&str]) {
        let mut cursor = 0;
        for needle in needles {
            let offset = haystack[cursor..]
                .find(needle)
                .unwrap_or_else(|| panic!("missing {needle} after byte {cursor}"));
            cursor += offset + needle.len();
        }
    }
}
