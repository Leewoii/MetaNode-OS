#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const API_PORT: u16 = 4310;
const WEB_PORT: u16 = 5173;
const OLLAMA_PORT: u16 = 11434;
const FALLBACK_GATE_URL: &str = "https://metanode-access-gate-frost.leeroi-c25.workers.dev";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherStatus {
  online: bool,
  approved: bool,
  core_installed: bool,
  ollama_available: bool,
  user_id: String,
  message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeviceState {
  user_id: String,
  device_id: String,
  last_grant: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AccessResponse {
  status: String,
  grant: Option<String>,
  message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DownloadTokenResponse {
  token: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseResponse {
  assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
  id: String,
  name: String,
}

#[tauri::command]
fn launcher_status(app: AppHandle) -> Result<LauncherStatus, String> {
  Ok(status(&app, "Ready. Click Start to launch MetaNode OS."))
}

#[tauri::command]
fn set_user_id(app: AppHandle, user_id: String) -> Result<LauncherStatus, String> {
  let clean = clean_user_id(&user_id)?;
  let mut device = load_or_create_device(&app)?;
  if device.user_id != clean {
    device.user_id = clean;
    device.last_grant = None;
    save_device(&app, &device)?;
  }
  Ok(status(&app, "User/license ID saved."))
}

#[tauri::command]
fn start_core(app: AppHandle) -> Result<LauncherStatus, String> {
  ensure_ports_available()?;
  ensure_docker_available()?;
  let mut device = load_or_create_device(&app)?;
  let grant = check_access(&device)?;
  device.last_grant = Some(grant.clone());
  save_device(&app, &device)?;
  ensure_core_bundle(&app, &grant)?;
  load_docker_images(&app)?;
  let ollama_available = ensure_ollama();
  start_compose(&app, &grant, &device.device_id)?;
  Ok(LauncherStatus {
    online: true,
    approved: true,
    core_installed: core_dir(&app).join("docker-compose.core.yml").exists(),
    ollama_available,
    user_id: device.user_id,
    message: if ollama_available {
      "MetaNode OS is online.".to_string()
    } else {
      "MetaNode OS is online. Ollama was not available, so local models are disabled.".to_string()
    },
  })
}

#[tauri::command]
fn stop_core(app: AppHandle) -> Result<LauncherStatus, String> {
  let _ = compose(&app, &["down"]);
  Ok(status(&app, "MetaNode OS stopped."))
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      build_tray(app.handle())?;
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .invoke_handler(tauri::generate_handler![launcher_status, set_user_id, start_core, stop_core])
    .run(tauri::generate_context!())
    .expect("error while running MetaNode OS launcher");
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
  let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "End App", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show, &quit])?;
  TrayIconBuilder::new()
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => show_window(app),
      "quit" => {
        let _ = compose(app, &["down"]);
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_window(tray.app_handle());
      }
    })
    .build(app)?;
  Ok(())
}

fn show_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn status(app: &AppHandle, message: &str) -> LauncherStatus {
  let device = load_or_create_device(app).ok();
  LauncherStatus {
    online: is_http_online(&format!("http://127.0.0.1:{WEB_PORT}")),
    approved: device.as_ref().and_then(|d| d.last_grant.as_ref()).is_some(),
    core_installed: core_dir(app).join("docker-compose.core.yml").exists(),
    ollama_available: is_http_online(&format!("http://127.0.0.1:{OLLAMA_PORT}/api/tags")),
    user_id: device.map(|d| d.user_id).unwrap_or_default(),
    message: message.to_string(),
  }
}

fn check_access(device: &DeviceState) -> Result<String, String> {
  let gate_url = env_or_default("METANODE_GATE_URL", default_gate_url());
  let client = reqwest::blocking::Client::new();
  let response = client
    .post(format!("{gate_url}/v1/access/check"))
    .json(&serde_json::json!({
      "userId": device.user_id,
      "deviceId": device.device_id,
      "platform": std::env::consts::OS,
      "arch": std::env::consts::ARCH,
      "appVersion": env!("CARGO_PKG_VERSION")
    }))
    .send()
    .map_err(|error| format!("Access gate is unreachable: {error}"))?;
  let body: AccessResponse = response.json().map_err(|error| format!("Access gate returned invalid JSON: {error}"))?;
  match body.status.as_str() {
    "approved" => body.grant.ok_or_else(|| "Access gate approved without a grant.".to_string()),
    "pending" => Err(body.message.unwrap_or_else(|| "Access request sent. Try again later once accepted.".to_string())),
    "denied" => Err("Access denied.".to_string()),
    _ => Err("Access gate returned an unknown status.".to_string()),
  }
}

fn ensure_core_bundle(app: &AppHandle, grant: &str) -> Result<(), String> {
  let dir = core_dir(app);
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  if dir.join("docker-compose.core.yml").exists() {
    return Ok(());
  }
  let gate_url = env_or_default("METANODE_GATE_URL", default_gate_url());
  let distribution_url = required_distribution_url()?;
  let client = reqwest::blocking::Client::new();
  let token: DownloadTokenResponse = client
    .post(format!("{gate_url}/v1/core/download-token"))
    .bearer_auth(grant)
    .send()
    .map_err(|error| format!("Core download token request failed: {error}"))?
    .json()
    .map_err(|error| format!("Core download token response was invalid: {error}"))?;
  let release: ReleaseResponse = client
    .get(format!("{distribution_url}/v1/core/releases/latest"))
    .bearer_auth(&token.token)
    .send()
    .map_err(|error| format!("Core release lookup failed: {error}"))?
    .json()
    .map_err(|error| format!("Core release response was invalid: {error}"))?;
  for asset in release.assets {
    if !(asset.name.ends_with(".tar") || asset.name == "docker-compose.core.yml" || asset.name.starts_with("core-manifest")) {
      continue;
    }
    let mut response = client
      .get(format!("{distribution_url}/v1/core/assets/{}", asset.id))
      .bearer_auth(&token.token)
      .send()
      .map_err(|error| format!("Core asset download failed: {error}"))?;
    if !response.status().is_success() {
      return Err("Core asset download was rejected.".to_string());
    }
    let mut file = fs::File::create(dir.join(&asset.name)).map_err(|error| error.to_string())?;
    response.copy_to(&mut file).map_err(|error| format!("Core asset write failed: {error}"))?;
  }
  verify_manifest_hashes(&dir)?;
  Ok(())
}

fn verify_manifest_hashes(dir: &Path) -> Result<(), String> {
  let manifest_path = dir.join("core-manifest.json");
  let manifest_bytes = fs::read(&manifest_path).map_err(|_| "Nice try".to_string())?;
  verify_manifest_signature(dir, &manifest_bytes)?;
  let manifest_text = String::from_utf8(manifest_bytes).map_err(|_| "Nice try".to_string())?;
  let manifest: serde_json::Value = serde_json::from_str(&manifest_text).map_err(|_| "Nice try".to_string())?;
  let assets = manifest.get("assets").and_then(|value| value.as_array()).ok_or_else(|| "Nice try".to_string())?;
  for asset in assets {
    let name = asset.get("name").and_then(|value| value.as_str()).ok_or_else(|| "Nice try".to_string())?;
    let expected = asset.get("sha256").and_then(|value| value.as_str()).ok_or_else(|| "Nice try".to_string())?;
    let bytes = fs::read(dir.join(name)).map_err(|_| "Nice try".to_string())?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected {
      return Err("Nice try".to_string());
    }
  }
  Ok(())
}

fn verify_manifest_signature(dir: &Path, manifest_bytes: &[u8]) -> Result<(), String> {
  let public_key_b64 = std::env::var("METANODE_RELEASE_PUBLIC_KEY_BASE64")
    .ok()
    .or_else(|| option_env!("METANODE_RELEASE_PUBLIC_KEY_BASE64").map(|value| value.to_string()))
    .unwrap_or_default();
  if public_key_b64.trim().is_empty() {
    return Err("Nice try".to_string());
  }
  let public_bytes = base64::engine::general_purpose::STANDARD
    .decode(public_key_b64.trim())
    .map_err(|_| "Nice try".to_string())?;
  let public_array: [u8; 32] = public_bytes.try_into().map_err(|_| "Nice try".to_string())?;
  let signature_text = fs::read_to_string(dir.join("core-manifest.sig")).map_err(|_| "Nice try".to_string())?;
  let signature_bytes = base64::engine::general_purpose::STANDARD
    .decode(signature_text.trim())
    .map_err(|_| "Nice try".to_string())?;
  let signature_array: [u8; 64] = signature_bytes.try_into().map_err(|_| "Nice try".to_string())?;
  let key = VerifyingKey::from_bytes(&public_array).map_err(|_| "Nice try".to_string())?;
  let signature = Signature::from_bytes(&signature_array);
  key.verify(manifest_bytes, &signature).map_err(|_| "Nice try".to_string())
}

fn load_docker_images(app: &AppHandle) -> Result<(), String> {
  for entry in fs::read_dir(core_dir(app)).map_err(|error| error.to_string())? {
    let path = entry.map_err(|error| error.to_string())?.path();
    if path.extension().and_then(|ext| ext.to_str()) == Some("tar") {
      run("docker", &["load", "-i", path.to_string_lossy().as_ref()])?;
    }
  }
  Ok(())
}

fn start_compose(app: &AppHandle, grant: &str, device_id: &str) -> Result<(), String> {
  let gate_url = env_or_default("METANODE_GATE_URL", default_gate_url());
  let verify_url = format!("{gate_url}/v1/access/verify");
  let compose_file = core_dir(app).join("docker-compose.core.yml");
  let grant_env = format!("METANODE_RUNTIME_GRANT={grant}");
  let device_env = format!("METANODE_RUNTIME_DEVICE_ID={device_id}");
  let verify_env = format!("METANODE_GATE_VERIFY_URL={verify_url}");
  run_with_env(
    "docker",
    &["compose", "-f", compose_file.to_string_lossy().as_ref(), "-p", "metanode-os", "up", "-d"],
    &[grant_env.as_str(), device_env.as_str(), verify_env.as_str()],
  )
}

fn compose(app: &AppHandle, args: &[&str]) -> Result<(), String> {
  let compose_file = core_dir(app).join("docker-compose.core.yml");
  if !compose_file.exists() {
    return Ok(());
  }
  let compose_path = compose_file.to_string_lossy().to_string();
  let mut full_args = vec!["compose", "-f", compose_path.as_str(), "-p", "metanode-os"];
  full_args.extend_from_slice(args);
  run("docker", &full_args)
}

fn ensure_ollama() -> bool {
  if is_http_online(&format!("http://127.0.0.1:{OLLAMA_PORT}/api/tags")) {
    return true;
  }
  let _ = Command::new("docker").args(["start", "metanode-ollama"]).status();
  if is_http_online(&format!("http://127.0.0.1:{OLLAMA_PORT}/api/tags")) {
    return true;
  }
  let _ = Command::new("docker")
    .args(["run", "-d", "--name", "metanode-ollama", "-p", "11434:11434", "ollama/ollama"])
    .status();
  is_http_online(&format!("http://127.0.0.1:{OLLAMA_PORT}/api/tags"))
}

fn ensure_ports_available() -> Result<(), String> {
  for port in [API_PORT, WEB_PORT] {
    if is_http_online(&format!("http://127.0.0.1:{port}")) {
      return Err(format!("Port {port} is already in use. Stop the existing service before starting MetaNode OS."));
    }
  }
  Ok(())
}

fn ensure_docker_available() -> Result<(), String> {
  match Command::new("docker").args(["version", "--format", "{{.Server.Version}}"]).output() {
    Ok(output) if output.status.success() => Ok(()),
    Ok(output) => {
      let message = command_output_message(&output);
      let lower = message.to_lowercase();
      if lower.contains("dockerdesktoplinuxengine")
        || lower.contains("daemon")
        || lower.contains("pipe/docker")
        || lower.contains("cannot connect")
      {
        return Err(
          "Docker Desktop is not running. Start Docker Desktop, wait until the Linux engine is ready, then click Start again."
            .to_string(),
        );
      }
      Err(format!("Docker is not ready: {message}"))
    }
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(
      "Docker was not found. Install Docker Desktop, enable Linux containers, then click Start again.".to_string(),
    ),
    Err(error) => Err(format!("Docker failed to start: {error}")),
  }
}

fn is_http_online(url: &str) -> bool {
  reqwest::blocking::Client::new()
    .get(url)
    .timeout(std::time::Duration::from_secs(2))
    .send()
    .map(|response| response.status().is_success() || response.status().is_redirection() || response.status().is_client_error())
    .unwrap_or(false)
}

fn load_or_create_device(app: &AppHandle) -> Result<DeviceState, String> {
  let path = device_path(app)?;
  if path.exists() {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    return serde_json::from_str(&text).map_err(|error| error.to_string());
  }
  let state = DeviceState {
    user_id: std::env::var("METANODE_USER_ID").unwrap_or_else(|_| "local-user".to_string()),
    device_id: format!("device-{}", uuid::Uuid::new_v4()),
    last_grant: None,
  };
  save_device(app, &state)?;
  Ok(state)
}

fn clean_user_id(value: &str) -> Result<String, String> {
  let clean: String = value
    .trim()
    .chars()
    .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
    .take(128)
    .collect();
  if clean.len() < 3 {
    return Err("User/license ID must be at least 3 characters.".to_string());
  }
  Ok(clean)
}

fn save_device(app: &AppHandle, state: &DeviceState) -> Result<(), String> {
  let path = device_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
  fs::write(path, text).map_err(|error| error.to_string())
}

fn device_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(core_dir(app).join("device.json"))
}

fn core_dir(_app: &AppHandle) -> PathBuf {
  dirs::data_local_dir()
    .unwrap_or_else(std::env::temp_dir)
    .join("MetaNode OS")
    .join("core-runtime")
}

fn env_or_default(key: &str, default: &str) -> String {
  std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn default_gate_url() -> &'static str {
  option_env!("METANODE_GATE_URL").unwrap_or(FALLBACK_GATE_URL)
}

fn required_distribution_url() -> Result<String, String> {
  let url = std::env::var("METANODE_DISTRIBUTION_URL")
    .ok()
    .or_else(|| option_env!("METANODE_DISTRIBUTION_URL").map(|value| value.to_string()))
    .unwrap_or_default();
  let clean = url.trim().trim_end_matches('/').to_string();
  if clean.is_empty() {
    return Err("Core distribution URL is not configured. Set METANODE_DISTRIBUTION_URL when building the launcher.".to_string());
  }
  Ok(clean)
}

fn run(command: &str, args: &[&str]) -> Result<(), String> {
  let output = Command::new(command).args(args).output().map_err(|error| format!("{command} failed to start: {error}"))?;
  if output.status.success() {
    return Ok(());
  }
  Err(command_output_message(&output))
}

fn run_with_env(command: &str, args: &[&str], envs: &[&str]) -> Result<(), String> {
  let mut cmd = Command::new(command);
  cmd.args(args);
  for pair in envs {
    if let Some((key, value)) = pair.split_once('=') {
      cmd.env(key, value);
    }
  }
  let output = cmd.output().map_err(|error| format!("{command} failed to start: {error}"))?;
  if output.status.success() {
    return Ok(());
  }
  Err(command_output_message(&output))
}

fn command_output_message(output: &std::process::Output) -> String {
  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  if !stderr.is_empty() {
    return stderr;
  }
  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if !stdout.is_empty() {
    return stdout;
  }
  "command failed without output".to_string()
}
