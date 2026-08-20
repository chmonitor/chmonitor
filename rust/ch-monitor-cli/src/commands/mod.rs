//! Subcommand implementations.

pub mod agent;
pub mod audit;
pub mod auth;
pub mod chart;
pub mod config_cmd;
pub mod diagnose_cmd;
pub mod doctor;
pub mod hosts;
pub mod table;
pub mod update_cmd;

use anyhow::Result;
use clap::CommandFactory;
use reqwest::Client;

use crate::{
    cli::{Commands, PromptCommand},
    config::AppConfig,
    prompts,
};

pub async fn dispatch(client: &Client, cfg: &AppConfig, command: Commands) -> Result<i32> {
    if cfg.debug {
        eprintln!(
            "[debug] base_url={} host_id={} channel={} json={}",
            cfg.base_url, cfg.host_id, cfg.channel, cfg.json
        );
    }
    match command {
        Commands::Auth(args) => auth::run(client, cfg, args).await,
        Commands::Config(args) => {
            config_cmd::run(cfg, args)?;
            Ok(0)
        }
        Commands::Hosts => {
            hosts::run(client, cfg).await?;
            Ok(0)
        }
        Commands::Link { path } => {
            let base = cfg.base_url.trim_end_matches('/');
            let url = match path {
                Some(p) if p.starts_with("http://") || p.starts_with("https://") => p,
                Some(p) => {
                    let p = if p.starts_with('/') {
                        p
                    } else {
                        format!("/{p}")
                    };
                    format!("{base}{p}")
                }
                None => base.to_string(),
            };
            if !cfg.yes && !cfg.quiet {
                crate::output::info(&format!("opening {url}"));
            }
            open::that(&url)?;
            Ok(0)
        }
        Commands::Chart { name, limit } => {
            chart::run(client, cfg, &name, limit).await?;
            Ok(0)
        }
        Commands::Table { name, limit } => {
            table::run(client, cfg, &name, limit).await?;
            Ok(0)
        }
        Commands::Tui { chart, overview } => {
            let c = chart.unwrap_or_else(|| cfg.default_chart.clone());
            crate::tui::run(client, cfg, &c, overview).await?;
            Ok(0)
        }
        Commands::Chat { message } => {
            crate::tui::chat::run(client, cfg, message).await?;
            Ok(0)
        }
        Commands::Agent { prompt, model } => {
            agent::run(client, cfg, prompt, model).await?;
            Ok(0)
        }
        Commands::Prompt(args) => {
            match args.command {
                PromptCommand::List => {
                    for p in prompts::list() {
                        println!("{:<20} {}", p.name, p.summary);
                    }
                }
                PromptCommand::Show { name } => {
                    let Some(pack) = prompts::find(&name) else {
                        anyhow::bail!(
                            "unknown prompt '{name}'. Run `chm prompt list` to see built-ins."
                        );
                    };
                    println!("{}", pack.body);
                }
            }
            Ok(0)
        }
        Commands::Audit(args) => {
            audit::run(client, cfg, args).await?;
            Ok(0)
        }
        Commands::Doctor => {
            doctor::run(client, cfg).await?;
            Ok(0)
        }
        Commands::Diagnose {
            ch_host,
            ch_user,
            ch_password,
            ch_database,
            json,
        } => diagnose_cmd::run(
            client,
            ch_host,
            ch_user,
            ch_password,
            ch_database,
            json || cfg.json,
        )
        .await,
        Commands::Update(args) | Commands::Upgrade(args) => {
            update_cmd::run(client, cfg, args).await
        }
        Commands::Completions { shell } => {
            let mut cmd = crate::cli::Cli::command();
            clap_complete::generate(shell, &mut cmd, "chm", &mut std::io::stdout());
            Ok(0)
        }
    }
}
