// API keys for AI model providers. Keys live in the system keychain and are never sent back to the window:
// the interface can only save, delete, test, and ask whether one is saved.
use std::time::Duration;

// Kept at the pre-rename value so keys already saved in the keychain still resolve.
const SERVICE: &str = "com.brendandang.drugboard";

struct Provider {
  id: &'static str,
  url: &'static str, // an endpoint that lists models: cheap, and fails cleanly on a bad key
  header: &'static str,
  bearer: bool,
  extra: Option<(&'static str, &'static str)>,
}

const PROVIDERS: &[Provider] = &[
  Provider { id: "openai", url: "https://api.openai.com/v1/models", header: "Authorization", bearer: true, extra: None },
  Provider {
    id: "anthropic", url: "https://api.anthropic.com/v1/models", header: "x-api-key", bearer: false,
    extra: Some(("anthropic-version", "2023-06-01")),
  },
  Provider { id: "xai", url: "https://api.x.ai/v1/models", header: "Authorization", bearer: true, extra: None },
  Provider {
    id: "google", url: "https://generativelanguage.googleapis.com/v1beta/models", header: "x-goog-api-key", bearer: false,
    extra: None,
  },
];

fn provider(id: &str) -> Result<&'static Provider, String> {
  PROVIDERS.iter().find(|p| p.id == id).ok_or_else(|| "Unknown provider".to_string())
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(SERVICE, &format!("api-key.{id}")).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct KeyStatus {
  provider: &'static str,
  saved: bool,
}

#[derive(serde::Serialize)]
pub struct TestResult {
  ok: bool,
  detail: String,
}

pub fn check(p_id: &str, key: &str) -> Result<TestResult, String> {
  let p = provider(p_id)?;
  let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(12))).build().into();
  let value = if p.bearer { format!("Bearer {key}") } else { key.to_string() };
  let mut req = agent.get(p.url).header(p.header, &value);
  if let Some((k, v)) = p.extra {
    req = req.header(k, v);
  }
  Ok(match req.call() {
    Ok(mut res) => {
      let body = res.body_mut().read_to_string().unwrap_or_default();
      let json: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
      let count = json.get("data").or_else(|| json.get("models")).and_then(|v| v.as_array()).map(|a| a.len());
      TestResult {
        ok: true,
        detail: match count {
          Some(n) => format!("Connected. {n} models available."),
          None => "Connected.".to_string(),
        },
      }
    }
    // Providers disagree on the code for a bad key: 401 or 403 mostly, 400 from some.
    Err(ureq::Error::StatusCode(400 | 401 | 403)) => TestResult { ok: false, detail: "The provider rejected this key.".to_string() },
    Err(ureq::Error::StatusCode(code)) => TestResult { ok: false, detail: format!("The provider answered with error {code}.") },
    Err(_) => TestResult { ok: false, detail: "Could not reach the provider. Check your connection.".to_string() },
  })
}

#[tauri::command]
pub fn keys_status() -> Vec<KeyStatus> {
  PROVIDERS
    .iter()
    .map(|p| KeyStatus { provider: p.id, saved: entry(p.id).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok() })
    .collect()
}

#[tauri::command]
pub fn key_save(provider_id: String, key: String) -> Result<(), String> {
  let key = key.trim();
  if key.is_empty() || key.len() > 512 || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
    return Err("That does not look like an API key.".to_string());
  }
  provider(&provider_id)?;
  entry(&provider_id)?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn key_delete(provider_id: String) -> Result<(), String> {
  provider(&provider_id)?;
  match entry(&provider_id)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub async fn key_test(provider_id: String) -> Result<TestResult, String> {
  provider(&provider_id)?;
  let key = entry(&provider_id)?.get_password().map_err(|_| "No key saved for this provider.".to_string())?;
  tauri::async_runtime::spawn_blocking(move || check(&provider_id, &key)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn bad_keys_are_rejected_by_every_provider() {
    for p in PROVIDERS {
      let r = check(p.id, "sk-not-a-real-key").unwrap();
      assert!(!r.ok, "{} accepted a fake key", p.id);
      assert_eq!(r.detail, "The provider rejected this key.", "{}", p.id);
    }
  }

  #[test]
  fn save_rejects_junk() {
    assert!(key_save("openai".into(), "  ".into()).is_err());
    assert!(key_save("openai".into(), "has space".into()).is_err());
    assert!(key_save("nope".into(), "sk-abc".into()).is_err());
  }
}
