//! `chm update` / `chm upgrade` wrapper with release-channel support.

use anyhow::Result;
use reqwest::Client;

use crate::{
    cli::{Channel, UpdateArgs},
    config::{self, AppConfig},
    output,
    update::{self, is_brew_managed},
};

pub async fn run(client: &Client, cfg: &AppConfig, args: UpdateArgs) -> Result<i32> {
    if is_brew_managed() {
        anyhow::bail!(
            "this chm binary appears to be managed by Homebrew.\n\
             Refuse to self-update — run `brew upgrade chm` (or reinstall) instead."
        );
    }

    let channel = if args.beta {
        Channel::Beta
    } else if args.stable {
        Channel::Stable
    } else {
        cfg.channel
    };
    let persist = args.beta || args.stable;
    // Persist first so `--beta` / `--stable` still switch channel when GitHub
    // is unreachable or the binary is already current.
    if persist && !args.check {
        persist_channel(cfg, channel)?;
    }

    if args.check {
        let available = update::check_channel(client, channel).await?;
        if available {
            Ok(1)
        } else {
            Ok(0)
        }
    } else {
        update::run_channel(client, args.version, channel).await?;
        Ok(0)
    }
}

fn persist_channel(cfg: &AppConfig, channel: Channel) -> Result<()> {
    let mut file = config::load_user_file_config(&cfg.user_config_path)?;
    file.channel = Some(channel.as_str().to_string());
    config::save_user_config(&cfg.user_config_path, &file)?;
    output::success(&format!(
        "channel {channel} saved in {}",
        cfg.user_config_path.display()
    ));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use crate::cli::Channel;
    use crate::config::{AppConfig, DEFAULT_CHANNEL, DEFAULT_CHART, DEFAULT_HOST_ID};

    #[test]
    fn persist_channel_writes_user_toml() {
        let dir = std::env::temp_dir().join(format!("chm-update-beta-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.toml");
        let cfg = AppConfig {
            base_url: "https://dash.chmonitor.dev".into(),
            host_id: DEFAULT_HOST_ID,
            api_key: None,
            token: None,
            default_chart: DEFAULT_CHART.into(),
            channel: DEFAULT_CHANNEL,
            json: false,
            quiet: true,
            yes: false,
            debug: false,
            user_config_path: path.clone(),
        };
        persist_channel(&cfg, Channel::Beta).expect("persist");
        let text = fs::read_to_string(&path).expect("read");
        assert!(text.contains("beta"), "{text}");
        let _ = fs::remove_file(&path);
    }
}
