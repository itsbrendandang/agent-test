mod keys;

use std::sync::Mutex;
use sysinfo::System;

#[derive(serde::Serialize)]
struct Usage {
  cpu: f32,         // percent of all cores, 0 to 100
  gpu: Option<f32>, // percent, or None when it cannot be read on this machine
}

// GPU load on macOS, read from the graphics driver's public statistics. No admin rights needed.
#[cfg(target_os = "macos")]
fn gpu_usage() -> Option<f32> {
  let out = std::process::Command::new("/usr/sbin/ioreg")
    .args(["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"])
    .output()
    .ok()?;
  let text = String::from_utf8_lossy(&out.stdout);
  let key = "\"Device Utilization %\"=";
  let values: Vec<f32> = text
    .match_indices(key)
    .filter_map(|(i, _)| {
      let rest = &text[i + key.len()..];
      let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
      rest[..end].parse().ok()
    })
    .collect();
  values.into_iter().reduce(f32::max)
}

#[cfg(not(target_os = "macos"))]
fn gpu_usage() -> Option<f32> {
  None
}

#[tauri::command]
async fn system_usage(sys: tauri::State<'_, Mutex<System>>) -> Result<Usage, ()> {
  let cpu = {
    let mut s = sys.lock().map_err(|_| ())?;
    s.refresh_cpu_usage(); // measured since the previous call
    s.global_cpu_usage()
  };
  Ok(Usage { cpu, gpu: gpu_usage() })
}

#[cfg(test)]
mod tests {
  #[test]
  #[cfg(target_os = "macos")]
  fn gpu_usage_is_a_percentage() {
    let v = super::gpu_usage().expect("no GPU reading");
    assert!((0.0..=100.0).contains(&v));
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(Mutex::new(System::new()))
    .invoke_handler(tauri::generate_handler![
      system_usage,
      keys::keys_status,
      keys::key_save,
      keys::key_delete,
      keys::key_test
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
