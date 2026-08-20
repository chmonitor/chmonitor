//! `chm update` / `chm upgrade` wrapper with release-channel support.

use anyhow::Result;
use reqwest::Client;

use crate::{
    cli::UpdateArgs,
    config::AppConfig,
    update::{self, is_brew_managed},
};

pub async fn run(client: &Client, cfg: &AppConfig, args: UpdateArgs) -> Result<i32> {
    if is_brew_managed() {
        anyhow::bail!(
            "this chm binary appears to be managed by Homebrew.\n\
             Refuse to self-update — run `brew upgrade chm` (or reinstall) instead."
        );
    }

    if args.check {
        let available = update::check_channel(client, cfg.channel).await?;
        if available {
            Ok(1)
        } else {
            Ok(0)
        }
    } else {
        update::run_channel(client, args.version, cfg.channel).await?;
        Ok(0)
    }
}
