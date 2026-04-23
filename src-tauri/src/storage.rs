use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
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
pub struct WriteResult {
    pub version: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProjectRecord {
    document: Value,
    version: String,
    updated_at: String,
}

#[tauri::command]
pub fn storage_list_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let dir = projects_dir(&app)?;
    let mut summaries = Vec::new();

    for entry in fs::read_dir(dir).map_err(error_string)? {
        let entry = entry.map_err(error_string)?;
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let record = read_record_from_path(&entry.path())?;
        summaries.push(summary_from_record(&record)?);
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
    let path = project_path(&app, &id)?;
    Ok(read_record_from_path(&path)?.document)
}

#[tauri::command]
pub fn storage_write_project(
    app: AppHandle,
    project: Value,
    expected: Option<String>,
) -> Result<WriteResult, String> {
    let id = project_id(&project)?;
    let path = project_path(&app, &id)?;

    if path.exists() {
        let existing = read_record_from_path(&path)?;
        assert_expected_version(Some(&existing), expected.as_deref())?;
    } else {
        assert_expected_version(None, expected.as_deref())?;
    }

    let updated_at = unix_millis();
    let version = format!("{updated_at}:{id}");
    let record = StoredProjectRecord {
        document: project,
        version: version.clone(),
        updated_at: updated_at.clone(),
    };

    let encoded = serde_json::to_string_pretty(&record).map_err(error_string)?;
    fs::write(path, encoded).map_err(error_string)?;

    Ok(WriteResult {
        version,
        updated_at,
    })
}

#[tauri::command]
pub fn storage_delete_project(
    app: AppHandle,
    id: String,
    expected: Option<String>,
) -> Result<(), String> {
    let path = project_path(&app, &id)?;

    if !path.exists() {
        assert_expected_version(None, expected.as_deref())?;
        return Ok(());
    }

    let existing = read_record_from_path(&path)?;
    assert_expected_version(Some(&existing), expected.as_deref())?;
    fs::remove_file(path).map_err(error_string)
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(error_string)?
        .join("projects");
    fs::create_dir_all(&dir).map_err(error_string)?;
    Ok(dir)
}

fn project_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(projects_dir(app)?.join(format!("{}.json", safe_project_id(id)?)))
}

fn safe_project_id(id: &str) -> Result<String, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid project id: {id}"));
    }

    Ok(id.to_owned())
}

fn read_record_from_path(path: &PathBuf) -> Result<StoredProjectRecord, String> {
    let raw = fs::read_to_string(path).map_err(error_string)?;
    serde_json::from_str(&raw).map_err(error_string)
}

fn summary_from_record(record: &StoredProjectRecord) -> Result<ProjectSummary, String> {
    Ok(ProjectSummary {
        id: project_id(&record.document)?,
        display_name: project_display_name(&record.document)?,
        updated_at: record.updated_at.clone(),
        version: record.version.clone(),
    })
}

fn project_id(project: &Value) -> Result<String, String> {
    project
        .get("project_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Project document is missing project_id".to_owned())
}

fn project_display_name(project: &Value) -> Result<String, String> {
    project
        .get("display_name")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Project document is missing display_name".to_owned())
}

fn assert_expected_version(
    existing: Option<&StoredProjectRecord>,
    expected: Option<&str>,
) -> Result<(), String> {
    if let Some(expected) = expected {
        if existing.map(|record| record.version.as_str()) != Some(expected) {
            return Err("storage-conflict: project version mismatch".to_owned());
        }
    }

    Ok(())
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
