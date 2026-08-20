//! `chm config`

use anyhow::{bail, Result};

use crate::{
    cli::{ConfigArgs, ConfigCommand},
    config::{self, AppConfig, FileConfig},
    output,
};

pub fn run(cfg: &AppConfig, args: ConfigArgs) -> Result<()> {
    match args.command {
        ConfigCommand::Show => {
            let v = serde_json::json!({
                "base_url": cfg.base_url,
                "host_id": cfg.host_id,
                "api_key_set": cfg.api_key.as_ref().map(|k| !k.is_empty()).unwrap_or(false),
                "token_set": cfg.token.as_ref().map(|t| !t.is_empty()).unwrap_or(false),
                "default_chart": cfg.default_chart,
                "channel": cfg.channel.as_str(),
                "user_config_path": cfg.user_config_path.display().to_string(),
            });
            if cfg.json {
                output::print_json(&v)?;
            } else {
                println!("base_url        = {}", cfg.base_url);
                println!("host_id         = {}", cfg.host_id);
                println!(
                    "api_key         = {}",
                    if cfg.api_key.as_ref().is_some_and(|k| !k.is_empty()) {
                        "(set)"
                    } else {
                        "(unset)"
                    }
                );
                println!(
                    "token           = {}",
                    if cfg.token.as_ref().is_some_and(|t| !t.is_empty()) {
                        "(set)"
                    } else {
                        "(unset)"
                    }
                );
                println!("default_chart   = {}", cfg.default_chart);
                println!("channel         = {}", cfg.channel);
                println!("user_config     = {}", cfg.user_config_path.display());
            }
            Ok(())
        }
        ConfigCommand::Path => {
            println!("{}", cfg.user_config_path.display());
            Ok(())
        }
        ConfigCommand::Set { key, value } => {
            let mut file = config::load_user_file_config(&cfg.user_config_path)?;
            apply_set(&mut file, &key, &value)?;
            config::save_user_config(&cfg.user_config_path, &file)?;
            output::success(&format!(
                "set {key} in {}",
                cfg.user_config_path.display()
            ));
            Ok(())
        }
    }
}

fn apply_set(file: &mut FileConfig, key: &str, value: &str) -> Result<()> {
    match key.trim().to_ascii_lowercase().as_str() {
        "base_url" | "base-url" => file.base_url = Some(value.to_string()),
        "host_id" | "host-id" => {
            let id: u32 = value
                .parse()
                .map_err(|_| anyhow::anyhow!("host_id must be an integer"))?;
            file.host_id = Some(id);
        }
        "api_key" | "api-key" => {
            file.api_key = Some(value.to_string());
            // Also persist into the credential store so runtime resolution finds it.
            let _ = crate::credentials::store_api_key(value);
        }
        "token" => file.token = Some(value.to_string()),
        "default_chart" | "default-chart" => file.default_chart = Some(value.to_string()),
        "channel" => {
            let _ = match value.trim().to_ascii_lowercase().as_str() {
                "stable" | "beta" => value,
                other => bail!("channel must be stable|beta, got '{other}'"),
            };
            file.channel = Some(value.to_ascii_lowercase());
        }
        other => bail!(
            "unknown config key '{other}' (base_url, host_id, api_key, token, default_chart, channel)"
        ),
    }
    Ok(())
}
