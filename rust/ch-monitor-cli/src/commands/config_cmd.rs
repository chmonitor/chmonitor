//! `chm config`

use anyhow::{bail, Result};

use crate::{
    cli::{Cli, ConfigArgs, ConfigCommand},
    config::{self, AppConfig, FileConfig},
    output,
};

pub fn run(cli: &Cli, cfg: &AppConfig, args: ConfigArgs) -> Result<()> {
    match args.command {
        None => crate::tui::config_form::run(cfg),
        Some(ConfigCommand::Show) => {
            let snap = config::current_snapshot(cli, cfg);
            if cfg.json {
                output::print_json(&config::format_snapshot_json(&snap))?;
            } else {
                print!("{}", config::format_snapshot_text(&snap));
            }
            Ok(())
        }
        Some(ConfigCommand::Path) => {
            println!("{}", cfg.user_config_path.display());
            Ok(())
        }
        Some(ConfigCommand::Set { key, value }) => {
            let mut file = config::load_user_file_config(&cfg.user_config_path)?;
            apply_set(&mut file, &key, &value)?;
            config::save_user_config(&cfg.user_config_path, &file)?;
            output::success(&format!("set {key} in {}", cfg.user_config_path.display()));
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
