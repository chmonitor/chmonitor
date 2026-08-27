//! Subcommand implementations.

pub mod agent;
pub mod audit;
pub mod auth;
pub mod chart;
pub mod config_cmd;
pub mod connections;
pub mod dashboard;
pub mod diagnose_cmd;
pub mod doctor;
pub mod hosts;
pub mod table;
pub mod update_cmd;

use anyhow::Result;
use reqwest::Client;

use crate::{
    cli::{Cli, Commands, DoctorArgs, PromptCommand},
    config::AppConfig,
    connections::ConnectionStore,
    prompts,
    tui::TuiOptions,
};

async fn run_cluster_scan(
    client: &Client,
    cfg: &AppConfig,
    cli: &Cli,
    args: DoctorArgs,
) -> Result<i32> {
    diagnose_cmd::run(
        client,
        cli.clickhouse.ch_host.clone(),
        cli.clickhouse.ch_user.clone(),
        cli.clickhouse.ch_password.clone(),
        cli.clickhouse.ch_database.clone(),
        args.json || cfg.json,
    )
    .await
}

fn resolve_tui_backend(
    cfg: &AppConfig,
    cli: &Cli,
) -> (
    Option<crate::diagnose::ChConfig>,
    Vec<crate::connections::StoredConnection>,
    Option<String>,
) {
    let explicit = cli.clickhouse.to_ch_config(); // pragma: allowlist secret
    if let Some(ch) = explicit {
        return (Some(ch), Vec::new(), None);
    }
    let store = ConnectionStore::from_config_path(cfg.user_config_path.clone());
    let Ok((conns, current)) = store.load() else {
        return (None, Vec::new(), None);
    };
    let ch = current
        .as_deref()
        .and_then(|name| store.ch_config_for(name).ok().flatten());
    (ch, conns, current)
}

pub(crate) async fn run_tui_session(
    client: &Client,
    cfg: &AppConfig,
    interactive: bool,
    mut opts: TuiOptions,
) -> Result<()> {
    if !interactive {
        return crate::tui::snapshot(client, cfg, &opts).await;
    }
    loop {
        match crate::tui::run(client, cfg, opts.clone()).await? {
            crate::tui::TuiExit::Quit => break,
            crate::tui::TuiExit::Chat { host_id: hid } => {
                opts.host_id = hid;
                crate::tui::chat::run(client, cfg, None).await?;
            }
        }
    }
    Ok(())
}

pub async fn dispatch(
    client: &Client,
    cfg: &AppConfig,
    cli: &Cli,
    command: Commands,
) -> Result<i32> {
    if cfg.debug {
        eprintln!(
            "[debug] base_url={} host_id={} channel={} json={}",
            cfg.base_url, cfg.host_id, cfg.channel, cfg.json
        );
    }
    match command {
        Commands::Auth(args) => auth::run(client, cfg, args).await,
        Commands::Config(args) => {
            config_cmd::run(cli, cfg, args)?;
            Ok(0)
        }
        Commands::Dashboard(args) => dashboard::run(client, cfg, args.command).await,
        Commands::Add(args) => {
            connections::add(
                cfg,
                &args.url,
                &args,
                &cli.clickhouse.ch_user,     // pragma: allowlist secret
                &cli.clickhouse.ch_password, // pragma: allowlist secret
                &cli.clickhouse.ch_database, // pragma: allowlist secret
            )?;
            Ok(0)
        }
        Commands::Ls => {
            connections::ls(cfg)?;
            Ok(0)
        }
        Commands::Use { name } => {
            connections::use_name(cfg, &name)?;
            Ok(0)
        }
        Commands::Rm { name } => {
            connections::rm(cfg, &name)?;
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
        Commands::Tui(args) => {
            let (ch, local_connections, current_connection) = resolve_tui_backend(cfg, cli);
            run_tui_session(
                client,
                cfg,
                crate::output::wants_tui(cfg.json, cli.no_tui),
                TuiOptions {
                    dashboard: crate::dashboards::OVERVIEW_NAME.to_string(),
                    charts: crate::dashboards::tui_chart_names(args.chart.as_deref()),
                    table: args.table,
                    page_size: args.page_size,
                    start_overview: args.overview,
                    host_id: cfg.host_id,
                    ch,
                    local_connections,
                    current_connection,
                    config_path: Some(cfg.user_config_path.clone()),
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
        Commands::Doctor(args) if cli.clickhouse.has_cluster_host() => {
            run_cluster_scan(client, cfg, cli, args).await
        }
        Commands::Doctor(_) => {
            doctor::run(client, cfg).await?;
            Ok(0)
        }
        Commands::Update(args) => update_cmd::run(client, cfg, args).await,
    }
}
