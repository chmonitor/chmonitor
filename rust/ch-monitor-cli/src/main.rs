//! `chm` — chmonitor CLI entry point (dispatch only).

mod cli;
mod client;
mod commands;
mod config;
mod credentials;
mod dashboards;
mod diagnose;
mod mermaid;
mod metrics;
mod output;
mod prompts;
mod telemetry;
mod tui;
mod update;

use std::time::Duration;

use anyhow::Result;
use clap::Parser;
use reqwest::Client;

use crate::cli::{Cli, Commands, TuiArgs};

#[tokio::main]
async fn main() -> Result<()> {
    let mut cli = Cli::parse();
    let cfg = config::resolve_config(&cli)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        // CLI is one-shot: idle keep-alives would leave hyper pool tasks
        // running after `chm update` prints "already up to date".
        .pool_max_idle_per_host(0)
        .build()?;

    // Bare `chm` (no subcommand) is the live TUI — same as `chm tui`.
    let command = cli
        .command
        .take()
        .unwrap_or_else(|| Commands::Tui(TuiArgs::default()));

    // Anonymous, opt-out CLI telemetry (source=cli). Fires in the background and
    // never blocks or fails the command; see src/telemetry.rs.
    let (tel_event, tel_command): (&'static str, &'static str) = match &command {
        Commands::Doctor(_) if cli.clickhouse.has_cluster_host() => ("cli_diagnose", "doctor"),
        Commands::Doctor(_) => ("cli_run", "doctor"),
        Commands::Hosts => ("cli_run", "hosts"),
        Commands::Chart { .. } => ("cli_run", "chart"),
        Commands::Table { .. } => ("cli_run", "table"),
        Commands::Tui(_) => ("cli_run", "tui"),
        Commands::Update(_) => ("cli_run", "update"),
        Commands::Auth(_) => ("cli_run", "auth"),
        Commands::Config(_) => ("cli_run", "config"),
        Commands::Dashboard(_) => ("cli_run", "dashboard"),
        Commands::Link { .. } => ("cli_run", "link"),
        Commands::Chat { .. } => ("cli_run", "chat"),
        Commands::Agent { .. } => ("cli_run", "agent"),
        Commands::Prompt(_) => ("cli_run", "prompt"),
        Commands::Audit(_) => ("cli_run", "audit"),
    };
    let tel_handle = telemetry::spawn(tel_event, tel_command);

    let exit = commands::dispatch(&client, &cfg, &cli, command).await?;

    telemetry::finish(tel_handle).await;
    // Always exit the process: returning from `#[tokio::main]` waits for every
    // leftover background task (reqwest pool, detached telemetry).
    std::process::exit(exit);
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    use crate::cli::{ClickHouseArgs, DoctorArgs, UpdateArgs};

    fn doctor_args(cli: Cli) -> DoctorArgs {
        match cli.command {
            Some(Commands::Doctor(args)) => args,
            other => panic!("expected doctor, got {other:?}"),
        }
    }

    fn update_args(cli: Cli) -> UpdateArgs {
        match cli.command {
            Some(Commands::Update(args)) => args,
            other => panic!("expected update, got {other:?}"),
        }
    }

    #[test]
    fn update_parses_check_flag() {
        let args = update_args(Cli::try_parse_from(["chm", "update", "--check"]).expect("parse"));
        assert!(args.check);
        assert!(args.version.is_none());
    }

    #[test]
    fn update_beta_and_stable_flags() {
        let beta = update_args(Cli::try_parse_from(["chm", "update", "--beta"]).expect("parse"));
        assert!(beta.beta);
        assert!(!beta.stable);
        let stable =
            update_args(Cli::try_parse_from(["chm", "update", "--stable"]).expect("parse"));
        assert!(stable.stable);
        assert!(!stable.beta);
        assert!(Cli::try_parse_from(["chm", "update", "--beta", "--stable"]).is_err());
    }

    #[test]
    fn update_version_flag() {
        let args = update_args(
            Cli::try_parse_from(["chm", "update", "--version", "chm-v0.2.0"]).expect("parse"),
        );
        assert!(!args.check);
        assert_eq!(args.version.as_deref(), Some("chm-v0.2.0"));
        let short = update_args(
            Cli::try_parse_from(["chm", "update", "--version", "0.2.0"]).expect("parse"),
        );
        assert_eq!(short.version.as_deref(), Some("0.2.0"));
    }

    #[test]
    fn help_lists_update_not_upgrade() {
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(help.contains("update"), "{help}");
        assert!(!help.contains("upgrade"), "{help}");
        assert!(!help.contains("diagnose"), "{help}");
        assert!(!help.contains("completions"), "{help}");
    }

    #[test]
    fn dashboard_flags_are_accepted_after_subcommand() {
        let cli = Cli::try_parse_from([
            "chm",
            "hosts",
            "--base-url",
            "http://127.0.0.1:3000",
            "--host-id",
            "2",
        ])
        .expect("global flags after subcommand");
        assert_eq!(cli.base_url.as_deref(), Some("http://127.0.0.1:3000"));
        assert_eq!(cli.host_id, Some(2));
        assert!(matches!(cli.command, Some(Commands::Hosts)));
    }

    #[test]
    fn version_output_includes_pkg_version_and_target() {
        let cmd = Cli::command();
        let version = cmd.get_version().expect("version");
        assert!(version.contains(env!("CARGO_PKG_VERSION")), "{version}");
        assert!(
            version.contains(env!("CHM_TARGET")),
            "expected compile-time target in version, got {version}"
        );
    }

    #[test]
    fn help_describes_core_commands() {
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(help.contains("List hosts"), "{help}");
        assert!(help.contains("named chart"), "{help}");
        assert!(help.contains("named table"), "{help}");
        assert!(help.contains("doctor"), "{help}");
        assert!(help.contains("auth"), "{help}");
        assert!(help.contains("config"), "{help}");
        assert!(help.contains("--base-url"), "{help}");
        assert!(!help.contains("diagnose"), "{help}");
    }

    #[test]
    fn doctor_without_host_is_connectivity() {
        let cli = Cli::try_parse_from(["chm", "doctor"]).expect("parse");
        assert!(
            matches!(cli.command, Some(Commands::Doctor(_))),
            "expected Doctor, got {:?}",
            cli.command
        );
    }

    #[test]
    fn diagnose_is_removed() {
        let err = Cli::try_parse_from(["chm", "diagnose"]).expect_err("diagnose removed");
        assert_eq!(err.kind(), clap::error::ErrorKind::InvalidSubcommand);
    }

    #[test]
    fn doctor_with_host_is_cluster_scan() {
        let parsed = Cli::try_parse_from([
            "chm",
            "doctor",
            "--ch-host",
            "http://localhost:8123",
            "--ch-user",
            "default",
        ])
        .expect("parse");
        assert!(matches!(parsed.command, Some(Commands::Doctor(_))));
        assert!(parsed.clickhouse.has_cluster_host());
        assert_eq!(
            parsed.clickhouse.ch_host.as_deref(),
            Some("http://localhost:8123")
        );
        assert_eq!(parsed.clickhouse.ch_user, "default");
    }

    #[test]
    fn upgrade_and_completions_are_removed() {
        let upgrade = Cli::try_parse_from(["chm", "upgrade"]).expect_err("upgrade removed");
        assert_eq!(upgrade.kind(), clap::error::ErrorKind::InvalidSubcommand);
        let completions =
            Cli::try_parse_from(["chm", "completions", "bash"]).expect_err("completions removed");
        assert_eq!(
            completions.kind(),
            clap::error::ErrorKind::InvalidSubcommand
        );
    }

    #[test]
    fn cluster_host_ignores_blank_values() {
        let blank = ClickHouseArgs {
            ch_host: Some("  ".into()),
            ch_user: "default".into(),
            ch_password: String::new(),
            ch_database: "default".into(),
        };
        assert!(!blank.has_cluster_host());
        let missing = ClickHouseArgs {
            ch_host: None,
            ..blank.clone()
        };
        assert!(!missing.has_cluster_host());
        let present = ClickHouseArgs {
            ch_host: Some("http://localhost:8123".into()),
            ..blank
        };
        assert!(present.has_cluster_host());
    }

    #[test]
    fn doctor_scan_flags() {
        let parsed = Cli::try_parse_from([
            "chm",
            "doctor",
            "--ch-host",
            "http://localhost:8123",
            "--json",
        ])
        .expect("parse");
        let args = doctor_args(parsed.clone());
        assert_eq!(
            parsed.clickhouse.ch_host.as_deref(),
            Some("http://localhost:8123")
        );
        assert!(args.json);
        assert!(parsed.clickhouse.has_cluster_host());
    }

    #[test]
    fn doctor_help_has_ch_host() {
        let mut cmd = Cli::command();
        let root_help = cmd.render_long_help().to_string();
        assert!(root_help.contains("--ch-host"), "{root_help}");
        assert!(root_help.contains("--ch-user"), "{root_help}");
        let doctor_help = cmd
            .find_subcommand_mut("doctor")
            .expect("doctor subcommand")
            .render_long_help()
            .to_string();
        assert!(doctor_help.contains("--json"), "{doctor_help}");
        assert!(cmd.find_subcommand_mut("diagnose").is_none());
    }

    #[test]
    fn update_help_has_flags() {
        let mut cmd = Cli::command();
        let update_help = cmd
            .find_subcommand_mut("update")
            .expect("update subcommand")
            .render_long_help()
            .to_string();
        assert!(update_help.contains("--check"), "{update_help}");
        assert!(update_help.contains("--version"), "{update_help}");
        assert!(update_help.contains("--beta"), "{update_help}");
        assert!(update_help.contains("--stable"), "{update_help}");
        assert!(cmd.find_subcommand_mut("upgrade").is_none());
        assert!(cmd.find_subcommand_mut("completions").is_none());
    }

    #[test]
    fn default_base_url_is_cloud() {
        assert_eq!(
            crate::config::DEFAULT_BASE_URL,
            "https://dash.chmonitor.dev"
        );
    }

    #[test]
    fn table_explain_flag_parses() {
        let cli = Cli::try_parse_from([
            "chm",
            "table",
            "running-queries",
            "--explain",
            "--limit",
            "5",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Table {
                name,
                limit,
                explain,
            }) => {
                assert_eq!(name, "running-queries");
                assert_eq!(limit, 5);
                assert!(explain);
            }
            other => panic!("expected Table, got {other:?}"),
        }
    }

    #[test]
    fn tui_table_and_page_size_flags_parse() {
        let cli = Cli::try_parse_from([
            "chm",
            "tui",
            "query-count",
            "--overview",
            "--table",
            "merges",
            "--page-size",
            "10",
        ])
        .expect("parse");
        match cli.command {
            Some(Commands::Tui(args)) => {
                assert_eq!(args.chart.as_deref(), Some("query-count"));
                assert!(args.overview);
                assert_eq!(args.table, "merges");
                assert_eq!(args.page_size, 10);
            }
            other => panic!("expected Tui, got {other:?}"),
        }
    }

    #[test]
    fn bare_chm_parses_as_tui() {
        let cli = Cli::try_parse_from(["chm"]).expect("parse");
        assert!(
            cli.command.is_none(),
            "expected no subcommand, got {:?}",
            cli.command
        );
    }

    #[test]
    fn bare_chm_keeps_global_flags() {
        let cli = Cli::try_parse_from([
            "chm",
            "--base-url",
            "http://127.0.0.1:3000",
            "--host-id",
            "2",
        ])
        .expect("parse");
        assert!(cli.command.is_none());
        assert_eq!(cli.base_url.as_deref(), Some("http://127.0.0.1:3000"));
        assert_eq!(cli.host_id, Some(2));
    }

    #[test]
    fn chm_tui_still_parses() {
        let cli = Cli::try_parse_from(["chm", "tui"]).expect("parse");
        match cli.command {
            Some(Commands::Tui(args)) => {
                assert!(args.chart.is_none());
                assert_eq!(args.table, "running-queries");
                assert_eq!(args.page_size, 15);
                assert!(!args.overview);
            }
            other => panic!("expected Tui, got {other:?}"),
        }
    }

    #[test]
    fn chm_hosts_still_hosts() {
        let cli = Cli::try_parse_from(["chm", "hosts"]).expect("parse");
        assert!(matches!(cli.command, Some(Commands::Hosts)));
    }

    #[test]
    fn help_flags_and_subcommand_still_work() {
        for argv in [["chm", "--help"], ["chm", "-h"], ["chm", "help"]] {
            let err = Cli::try_parse_from(argv).expect_err("help should not parse as a command");
            assert_eq!(
                err.kind(),
                clap::error::ErrorKind::DisplayHelp,
                "{argv:?}: {err}"
            );
        }
    }

    #[test]
    fn help_says_bare_chm_opens_tui() {
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(help.contains("live TUI"), "{help}");
        assert!(help.contains("no subcommand"), "{help}");
    }

    #[test]
    fn dashboard_list_parses() {
        let cli = Cli::try_parse_from(["chm", "dashboard", "list"]).expect("parse");
        match cli.command {
            Some(Commands::Dashboard(args)) => {
                assert!(matches!(args.command, crate::cli::DashboardCommand::List));
            }
            other => panic!("expected Dashboard list, got {other:?}"),
        }
    }

    #[test]
    fn dashboard_open_parses_name() {
        let cli = Cli::try_parse_from(["chm", "dashboard", "open", "Overview"]).expect("parse");
        match cli.command {
            Some(Commands::Dashboard(args)) => match args.command {
                crate::cli::DashboardCommand::Open { name } => {
                    assert_eq!(name, "Overview");
                }
                other => panic!("expected Open, got {other:?}"),
            },
            other => panic!("expected Dashboard, got {other:?}"),
        }
    }

    #[test]
    fn json_before_dashboard_list_is_global() {
        let cli = Cli::try_parse_from(["chm", "--json", "dashboard", "list"]).expect("parse");
        assert!(cli.json);
        assert!(matches!(cli.command, Some(Commands::Dashboard(_))));
    }

    #[test]
    fn config_without_subcommand_is_interactive() {
        let cli = Cli::try_parse_from(["chm", "config"]).expect("parse");
        match cli.command {
            Some(Commands::Config(args)) => {
                assert!(args.command.is_none(), "expected no subcommand");
            }
            other => panic!("expected Config, got {other:?}"),
        }
    }

    #[test]
    fn config_show_still_parses() {
        let cli = Cli::try_parse_from(["chm", "config", "show"]).expect("parse");
        match cli.command {
            Some(Commands::Config(args)) => {
                assert!(matches!(
                    args.command,
                    Some(crate::cli::ConfigCommand::Show)
                ));
            }
            other => panic!("expected Config show, got {other:?}"),
        }
    }

    #[test]
    fn help_lists_dashboard_and_config() {
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(help.contains("dashboard"), "{help}");
        assert!(help.contains("config"), "{help}");
    }
}
