// The commands the window may call are listed here so that Tauri's access control applies to them too:
// a command reaches the window only if capabilities/default.json grants its `allow-...` permission.
// Add a new command in three places: here, the invoke_handler in src/lib.rs, and the capability file.
const COMMANDS: &[&str] = &["system_usage", "keys_status", "key_save", "key_delete", "key_test"];

fn main() {
  println!("cargo:rerun-if-env-changed=ASB_BUNDLED_ENGINE");
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
  )
  .expect("failed to run the Tauri build script")
}
