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
    cli::{Commands, DoctorArgs, PromptCommand},
    config::AppConfig,
    prompts,
};

async fn run_cluster_scan(client: &Client, cfg: &AppConfig, args: DoctorArgs) -> Result<i32> {
    diagnose_cmd::run(
        client,
        args.ch_host,
        args.ch_user,
        args.ch_password,
        args.ch_database,
        args.json || cfg.json,
    )
    .await
}

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
        Commands::Table {
            name,
            limit,
            explain,
        } => {
            table::run(client, cfg, &name, limit, explain).await?;
            Ok(0)
        }
        Commands::Tui {
            chart,
            overview,
            table,
            page_size,
        } => {
            let c = chart.unwrap_or_else(|| cfg.default_chart.clone());
            crate::tui::run(
                client,
                cfg,
                crate::tui::TuiOptions {
                    chart: &c,
                    table: &table,
                    page_size,
                    start_overview: overview,
                },
            )
            .await?;
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
        Commands::Doctor(args) if args.has_cluster_host() => {
            run_cluster_scan(client, cfg, args).await
        }
        Commands::Doctor(_) => {
            doctor::run(client, cfg).await?;
            Ok(0)
        }
        Commands::Diagnose(args) => run_cluster_scan(client, cfg, args).await,
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
