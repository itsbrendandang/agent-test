mod engine;
mod keys;

use std::sync::Mutex;
use sysinfo::System;
use tauri::Manager;

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

// Every command the window can call. Each one must also be listed in build.rs and granted in
// capabilities/default.json, or the window is refused.
fn commands<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
  tauri::generate_handler![
    system_usage,
    keys::keys_status,
    keys::key_save,
    keys::key_delete,
    keys::key_test
  ]
}

// The configuration, capabilities and interface files, built in at compile time. The macro may appear only once.
fn context<R: tauri::Runtime>() -> tauri::Context<R> {
  tauri::generate_context!()
}

// The main window is declared in tauri.conf.json with `create: false` and opened here, after the engine answers.
fn open_window(app: &tauri::App, engine: Option<&engine::Engine>) -> tauri::Result<()> {
  let config = app.config().app.windows.first().expect("no window in tauri.conf.json").clone();
  let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
  if let Some(engine) = engine {
    builder = builder.initialization_script(engine.init_script());
  }
  // Never open larger than the screen: a 1280x820 window does not fit a small laptop display.
  let screen = app.primary_monitor().ok().flatten().map(|m| {
    let size = m.size().to_logical::<f64>(m.scale_factor());
    (size.width, size.height)
  });
  let (width, height, min_width, min_height) =
    fit_window(config.width, config.height, config.min_width.unwrap_or(0.0), config.min_height.unwrap_or(0.0), screen);
  builder = builder.inner_size(width, height).min_inner_size(min_width, min_height).center();
  builder.build()?;
  Ok(())
}

/// Room kept free for the menu bar, the Dock and the window's own title bar, in points.
const SCREEN_MARGIN: (f64, f64) = (32.0, 140.0);

/// The window size and smallest size to use on a screen of the given size (in points): the configured ones,
/// made smaller when the screen is smaller. With no screen known, the configured ones.
fn fit_window(width: f64, height: f64, min_width: f64, min_height: f64, screen: Option<(f64, f64)>) -> (f64, f64, f64, f64) {
  let Some((screen_width, screen_height)) = screen else { return (width, height, min_width, min_height) };
  let width = width.min((screen_width - SCREEN_MARGIN.0).max(320.0));
  let height = height.min((screen_height - SCREEN_MARGIN.1).max(320.0));
  (width, height, min_width.min(width), min_height.min(height))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(Mutex::new(System::new()))
    .invoke_handler(commands())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if engine::expected(app.handle()) {
        match engine::Engine::start(app.handle()) {
          Ok(engine) => {
            open_window(app, Some(&engine))?;
            app.manage(engine);
          }
          Err(engine::Failure::AlreadyRunning) => {
            eprintln!("AI Scientist Bot is already running; leaving the first copy to answer.");
            std::process::exit(0);
          }
          Err(engine::Failure::Broken(message)) => {
            engine::tell(&message);
            std::process::exit(1);
          }
        }
      } else {
        open_window(app, None)?; // no engine inside: the window expects one on 127.0.0.1:8787
      }
      Ok(())
    })
    .build(context())
    .expect("error while building tauri application");
  app.run(|handle, event| {
    if let tauri::RunEvent::Exit = event {
      if let Some(engine) = handle.try_state::<engine::Engine>() {
        engine.stop();
      }
    }
  });
}

#[cfg(test)]
mod tests {
  use std::sync::Mutex;
  use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
  use tauri::webview::InvokeRequest;

  #[test]
  fn the_window_never_opens_larger_than_the_screen() {
    // A large screen keeps the configured size.
    assert_eq!(super::fit_window(1280.0, 820.0, 720.0, 520.0, Some((1920.0, 1080.0))), (1280.0, 820.0, 720.0, 520.0));
    // A 13-inch laptop (1280x800 points): smaller than the configured window, so it is made to fit.
    let (w, h, min_w, min_h) = super::fit_window(1280.0, 820.0, 720.0, 520.0, Some((1280.0, 800.0)));
    assert!(w <= 1280.0 - 32.0 && h <= 800.0 - 140.0, "window {w}x{h} does not fit 1280x800");
    assert!(min_w <= w && min_h <= h);
    // A very small screen: the smallest size shrinks with it, so the window can still be shown whole.
    let (w, h, min_w, min_h) = super::fit_window(1280.0, 820.0, 720.0, 520.0, Some((640.0, 480.0)));
    assert!(w <= 640.0 && h <= 480.0 && min_w <= w && min_h <= h);
    // No screen known: the configured size.
    assert_eq!(super::fit_window(1280.0, 820.0, 720.0, 520.0, None), (1280.0, 820.0, 720.0, 520.0));
  }

  #[test]
  #[cfg(target_os = "macos")]
  fn gpu_usage_is_a_percentage() {
    let v = super::gpu_usage().expect("no GPU reading");
    assert!((0.0..=100.0).contains(&v));
  }

  // The real configuration and capability file, on a runtime that opens no window.
  fn app() -> tauri::App<MockRuntime> {
    mock_builder()
      .manage(Mutex::new(sysinfo::System::new()))
      .invoke_handler(super::commands())
      .build(super::context())
      .expect("app did not build")
  }

  fn window(app: &tauri::App<MockRuntime>, label: &str) -> tauri::WebviewWindow<MockRuntime> {
    tauri::WebviewWindowBuilder::new(app, label, Default::default()).build().expect("window did not build")
  }

  fn call(w: &tauri::WebviewWindow<MockRuntime>, cmd: &str, from: &str) -> Result<serde_json::Value, serde_json::Value> {
    let request = InvokeRequest {
      cmd: cmd.into(),
      callback: tauri::ipc::CallbackFn(0),
      error: tauri::ipc::CallbackFn(1),
      url: from.parse().unwrap(),
      body: tauri::ipc::InvokeBody::default(),
      headers: Default::default(),
      invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(w, request).map(|body| body.deserialize().unwrap())
  }

  const LOCAL: &str = "tauri://localhost";

  #[test]
  fn the_main_window_may_call_an_app_command() {
    let app = app();
    let usage = call(&window(&app, "main"), "system_usage", LOCAL).expect("refused");
    assert!(usage.get("cpu").is_some(), "{usage}");
  }

  #[test]
  fn the_main_window_may_not_call_built_in_apis() {
    let app = app();
    let main = window(&app, "main");
    for cmd in ["plugin:window|close", "plugin:event|listen", "plugin:path|resolve_directory", "plugin:webview|create_webview_window", "plugin:log|log"] {
      assert!(call(&main, cmd, LOCAL).is_err(), "{cmd} was allowed");
    }
  }

  #[test]
  fn other_windows_and_other_origins_are_refused() {
    let app = app();
    assert!(call(&window(&app, "other"), "system_usage", LOCAL).is_err(), "a second window was allowed");
    assert!(call(&window(&app, "main"), "system_usage", "https://example.com").is_err(), "a remote page was allowed");
  }
}
