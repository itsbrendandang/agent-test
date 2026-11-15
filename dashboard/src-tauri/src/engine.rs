// The engine inside the app. A downloaded app has no checkout and no Node on the machine, so the bundle carries
// a Node runtime and the engine (Resources/engine-app, staged by scripts/desktop/build.sh). On launch the app
//   1. takes a lock, so a second copy of the app cannot start a second engine on the same data,
//   2. lays out a working folder under ~/Library/Application Support/<bundle id>/ (the bundle is read-only),
//   3. starts the engine on a free port of 127.0.0.1 with a clean environment and paid calls off,
//   4. waits until it answers, and only then opens the window (lib.rs),
//   5. stops it on quit. If the app dies without quitting, the engine notices (watchdog.mjs) and stops itself.
// Nothing here runs in a dev build or in a build without the bundled engine: the window then talks to an engine
// that someone started by hand on 127.0.0.1:8787, as before.
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::os::unix::{fs::symlink, process::CommandExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime};

/// The address the dashboard was built to call (VITE_ENGINE_URL in scripts/desktop/build.sh). The window rewrites
/// it to the engine's real port before the request leaves the page (see `init_script`).
pub const PLACEHOLDER_ORIGIN: &str = "http://engine.localhost";

pub struct Engine {
  child: Mutex<Option<Child>>,
  pub port: u16,
  _lock: File, // held until the app exits
}

/// Why the app cannot open, in words for the person who double-clicked it.
pub enum Failure {
  /// Another copy of the app already holds the lock. Nothing to show: macOS brings that copy forward.
  AlreadyRunning,
  Broken(String),
}

fn bundled(app: &AppHandle<impl Runtime>) -> Option<PathBuf> {
  let dir = app.path().resource_dir().ok()?.join("engine-app");
  dir.join("node").is_file().then_some(dir)
}

/// True when this build carries an engine, so the app must start it and wait for it. scripts/desktop/build.sh sets
/// ASB_BUNDLED_ENGINE=1 for the build: a build that should have an engine but cannot find it says so, instead
/// of opening a window that talks to nothing.
pub fn expected(app: &AppHandle<impl Runtime>) -> bool {
  option_env!("ASB_BUNDLED_ENGINE") == Some("1") || bundled(app).is_some()
}

fn data_dir(app: &AppHandle<impl Runtime>) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| format!("no data folder: {e}"))?;
  fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
  Ok(dir)
}

/// (Re)make `link` point at `target`. A link left by an older copy of the app (moved, updated) is replaced;
/// a real file or folder in the way is an error: it may be someone's data.
fn point(link: &Path, target: &Path) -> Result<(), String> {
  match fs::symlink_metadata(link) {
    Ok(m) if m.file_type().is_symlink() => {
      if fs::read_link(link).map(|t| t == target).unwrap_or(false) {
        return Ok(());
      }
      fs::remove_file(link).map_err(|e| format!("{}: {e}", link.display()))?;
    }
    Ok(_) => return Err(format!("{} exists and is not a link; move it away", link.display())),
    Err(_) => {}
  }
  symlink(target, link).map_err(|e| format!("{}: {e}", link.display()))
}

/// The folder the engine treats as the repository root. Read-only material is linked in from the bundle; the
/// four places the engine writes (board runs, the board's expertise notes, GLHF runs, GLHF memory) are real
/// folders here, so they survive an update of the app and never touch the signed bundle.
fn prepare_root(root: &Path, res: &Path) -> Result<(), String> {
  let mk = |p: PathBuf| fs::create_dir_all(&p).map_err(|e| format!("{}: {e}", p.display()));
  for sub in ["board/runs", "board/expertise", "glhf/runs", "glhf/memory", ".agents"] {
    mk(root.join(sub))?;
  }
  point(&root.join("engine"), &res.join("engine"))?;
  for name in ["config.yaml", "agents", "context", "briefs"] {
    point(&root.join("board").join(name), &res.join("board").join(name))?;
  }
  point(&root.join("glhf/specialists"), &res.join("glhf/specialists"))?;
  point(&root.join(".agents/skills"), &res.join("skills"))?;
  Ok(())
}

fn free_port() -> Result<u16, String> {
  let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| format!("no free port: {e}"))?;
  l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Ask the engine for /api/status. True only for a 200 that looks like ours.
fn answers(port: u16) -> bool {
  let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
  let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else { return false };
  let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
  let _ = s.set_write_timeout(Some(Duration::from_millis(1500)));
  let req = format!("GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
  if s.write_all(req.as_bytes()).is_err() {
    return false;
  }
  let mut text = String::new();
  let _ = s.read_to_string(&mut text);
  text.starts_with("HTTP/1.1 200") && text.contains("\"paidCalls\"")
}

/// Keep the last log as engine.log.1 and start a fresh one when it passes 5 MB.
fn open_log(dir: &Path) -> Result<File, String> {
  let logs = dir.join("logs");
  fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
  let file = logs.join("engine.log");
  if fs::metadata(&file).map(|m| m.len() > 5 << 20).unwrap_or(false) {
    let _ = fs::rename(&file, logs.join("engine.log.1"));
  }
  OpenOptions::new().create(true).append(true).open(&file).map_err(|e| format!("{}: {e}", file.display()))
}

fn spawn(res: &Path, data: &Path, port: u16, log: &File) -> Result<Child, String> {
  let root = data.join("engine-root");
  let runs = root.join("glhf/runs");
  let out = log.try_clone().map_err(|e| e.to_string())?;
  let err = log.try_clone().map_err(|e| e.to_string())?;
  let home = std::env::var("HOME").unwrap_or_default();
  let mut cmd = Command::new(res.join("node"));
  cmd.env_clear()
    // The engine path goes through the links made in prepare_root, so --preserve-symlinks-main keeps it:
    // the engine then finds its "repository root" in the data folder, not in the signed bundle.
    // A heap cap: the engine idles far below it; it only keeps a runaway from taking the machine's memory.
    .args(["--max-old-space-size=512", "--preserve-symlinks", "--preserve-symlinks-main", "--import"])
    .arg(res.join("watchdog.mjs"))
    .arg(root.join("engine/src/server.ts"))
    .current_dir(&root)
    .env("HOME", home)
    .env("USER", std::env::var("USER").unwrap_or_default())
    .env("TMPDIR", std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into()))
    .env("LANG", "en_US.UTF-8")
    // Usual places for docker, uv and claude: a Finder launch has only /usr/bin:/bin:/usr/sbin:/sbin.
    .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin")
    // Paid calls are off in the shipped app. No key is passed in, and none is in the bundle.
    .env("NO_PAID_CALLS", "1")
    .env("HOST", "127.0.0.1")
    .env("DRUG_BOARD_PORT", port.to_string())
    // The app's own origin, by configuration. It is already a built-in default; naming it here keeps the app
    // working if that default is ever narrowed, and adds nothing else.
    .env("DASHBOARD_ORIGINS", "tauri://localhost")
    .env("GLHF_RUNS_DIR", &runs)
    .env("ASB_PARENT_PID", std::process::id().to_string())
    .stdin(Stdio::null())
    .stdout(out)
    .stderr(err)
    .process_group(0); // its own group: stop() ends the engine and anything it started in one call
  cmd.spawn().map_err(|e| format!("cannot start {}: {e}", res.join("node").display()))
}

impl Engine {
  /// Start the engine and wait for it. Tries three ports (a port can be taken between choosing and binding).
  pub fn start(app: &AppHandle<impl Runtime>) -> Result<Engine, Failure> {
    let res = bundled(app).ok_or_else(|| Failure::Broken(
      "The engine files are missing from the app. If you opened it through a shortcut or a symbolic link, open the app from its real folder (for example Applications). Otherwise download it again.".into()))?;
    let broken = Failure::Broken;
    let data = data_dir(app).map_err(broken)?;

    let lock = OpenOptions::new().create(true).write(true).truncate(false).open(data.join("app.lock"))
      .map_err(|e| Failure::Broken(format!("cannot open the lock file: {e}")))?;
    match lock.try_lock() {
      Ok(()) => {}
      Err(TryLockError::WouldBlock) => return Err(Failure::AlreadyRunning),
      Err(TryLockError::Error(e)) => return Err(Failure::Broken(format!("cannot lock the data folder: {e}"))),
    }

    prepare_root(&data.join("engine-root"), &res).map_err(Failure::Broken)?;
    let log = open_log(&data).map_err(Failure::Broken)?;
    let _ = writeln!(&log, "--- app start {:?} ---", std::time::SystemTime::now());

    let mut last = String::from("the engine did not answer");
    for _ in 0..3 {
      let port = free_port().map_err(Failure::Broken)?;
      let mut child = spawn(&res, &data, port, &log).map_err(Failure::Broken)?;
      let deadline = Instant::now() + Duration::from_secs(25);
      loop {
        if answers(port) {
          return Ok(Engine { child: Mutex::new(Some(child)), port, _lock: lock });
        }
        if let Ok(Some(status)) = child.try_wait() {
          last = format!("the engine stopped at start ({status})");
          break;
        }
        if Instant::now() > deadline {
          stop_child(&mut child);
          last = "the engine did not answer within 25 seconds".into();
          break;
        }
        std::thread::sleep(Duration::from_millis(100));
      }
    }
    Err(Failure::Broken(format!("{last}. Its log is {}", data.join("logs/engine.log").display())))
  }

  /// Stop the engine: SIGTERM to its group (it releases its run locks), SIGKILL after five seconds.
  pub fn stop(&self) {
    if let Some(mut child) = self.child.lock().ok().and_then(|mut c| c.take()) {
      stop_child(&mut child);
    }
  }

  /// The script that points the dashboard at the engine's real port. It runs in every page of the window,
  /// before the page's own code. Only addresses that start with the placeholder origin are changed.
  pub fn init_script(&self) -> String {
    // For measuring and support: ASB_START_VIEW=Graph opens the app on that view (letters only, as the address hash).
    let start = std::env::var("ASB_START_VIEW").ok().filter(|v| !v.is_empty() && v.len() < 20 && v.chars().all(|c| c.is_ascii_alphabetic()));
    let start = start.map(|v| format!("if (!location.hash) location.hash = \"#{v}\";\n  ")).unwrap_or_default();
    format!(
      r#"(() => {{
  {start}  const FROM = "{PLACEHOLDER_ORIGINS}", TO = "http://127.0.0.1:{port}";
  const fix = (u) => {{ const s = typeof u === "string" ? u : u instanceof URL ? u.href : null; return s !== null && (s === FROM || s.startsWith(FROM + "/")) ? TO + s.slice(FROM.length) : u; }};
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => input instanceof Request ? nativeFetch(new Request(fix(input.url), input), init) : nativeFetch(fix(input), init);
  const NativeES = window.EventSource;
  window.EventSource = class extends NativeES {{ constructor(url, options) {{ super(fix(url), options); }} }};
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {{ return open.call(this, method, fix(url), ...rest); }};
}})();"#,
      PLACEHOLDER_ORIGINS = PLACEHOLDER_ORIGIN,
      port = self.port,
      start = start
    )
  }
}

impl Drop for Engine {
  fn drop(&mut self) {
    self.stop();
  }
}

fn stop_child(child: &mut Child) {
  let pid = child.id() as i32;
  // SAFETY: kill(2) with a pid group we created (process_group(0)); no memory is touched.
  unsafe { libc::kill(-pid, libc::SIGTERM) };
  let deadline = Instant::now() + Duration::from_secs(5);
  while Instant::now() < deadline {
    if matches!(child.try_wait(), Ok(Some(_))) {
      break;
    }
    std::thread::sleep(Duration::from_millis(50));
  }
  // Whatever is left in the group, including a hung engine.
  unsafe { libc::kill(-pid, libc::SIGKILL) };
  let _ = child.wait();
}

/// A plain message for a failed start. A dialog from osascript needs no extra permission.
pub fn tell(message: &str) {
  eprintln!("AI Scientist Bot: {message}");
  let text = format!("AI Scientist Bot could not start its engine.\n\n{message}").replace('\\', "\\\\").replace('"', "\\\"");
  let _ = Command::new("/usr/bin/osascript")
    .args(["-e", &format!("display dialog \"{text}\" with title \"AI Scientist Bot\" buttons {{\"OK\"}} default button 1 with icon stop")])
    .output();
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("asb-engine-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn fake_resources(dir: &Path) -> PathBuf {
    let res = dir.join("res");
    for sub in ["engine", "board/agents", "board/context", "board/briefs", "glhf/specialists", "skills"] {
      fs::create_dir_all(res.join(sub)).unwrap();
    }
    fs::write(res.join("board/config.yaml"), "x").unwrap();
    res
  }

  #[test]
  fn the_root_links_read_only_files_and_keeps_the_writable_folders_real() {
    let dir = temp("root");
    let (res, root) = (fake_resources(&dir), dir.join("root"));
    prepare_root(&root, &res).unwrap();
    assert!(fs::symlink_metadata(root.join("engine")).unwrap().file_type().is_symlink());
    assert!(fs::symlink_metadata(root.join("board/config.yaml")).unwrap().file_type().is_symlink());
    for writable in ["board/runs", "board/expertise", "glhf/runs", "glhf/memory"] {
      let m = fs::symlink_metadata(root.join(writable)).unwrap();
      assert!(m.is_dir() && !m.file_type().is_symlink(), "{writable} must be a real folder outside the bundle");
    }
    prepare_root(&root, &res).unwrap(); // a second launch changes nothing
  }

  #[test]
  fn a_link_from_an_older_copy_of_the_app_is_repointed() {
    let dir = temp("moved");
    let (old, root) = (fake_resources(&dir), dir.join("root"));
    prepare_root(&root, &old).unwrap();
    let moved = dir.join("moved");
    fs::rename(&old, &moved).unwrap();
    prepare_root(&root, &moved).unwrap();
    assert_eq!(fs::read_link(root.join("engine")).unwrap(), moved.join("engine"));
  }

  #[test]
  fn a_real_folder_where_a_link_belongs_is_left_alone() {
    let dir = temp("clash");
    let (res, root) = (fake_resources(&dir), dir.join("root"));
    fs::create_dir_all(root.join("engine")).unwrap();
    fs::write(root.join("engine/mine.txt"), "data").unwrap();
    assert!(prepare_root(&root, &res).is_err());
    assert!(root.join("engine/mine.txt").exists());
  }

  #[test]
  fn a_port_that_nothing_serves_does_not_answer() {
    let port = free_port().unwrap();
    assert!(!answers(port));
  }
}
