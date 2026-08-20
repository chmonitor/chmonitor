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
    let client = Client::builder().timeout(Duration::from_secs(60)).build()?;

    // Bare `chm` (no subcommand) is the live TUI — same as `chm tui`.
    let command = cli
        .command
        .take()
        .unwrap_or_else(|| Commands::Tui(TuiArgs::default()));

    // Anonymous, opt-out CLI telemetry (source=cli). Fires in the background and
    // never blocks or fails the command; see src/telemetry.rs.
    let (tel_event, tel_command): (&'static str, &'static str) = match &command {
        Commands::Diagnose(_) => ("cli_diagnose", "diagnose"),
        Commands::Doctor(args) if args.has_cluster_host() => ("cli_diagnose", "doctor"),
        Commands::Doctor(_) => ("cli_run", "doctor"),
        Commands::Hosts => ("cli_run", "hosts"),
        Commands::Chart { .. } => ("cli_run", "chart"),
        Commands::Table { .. } => ("cli_run", "table"),
        Commands::Tui(_) => ("cli_run", "tui"),
        Commands::Update(_) | Commands::Upgrade(_) => ("cli_run", "update"),
        Commands::Auth(_) => ("cli_run", "auth"),
        Commands::Config(_) => ("cli_run", "config"),
        Commands::Dashboard(_) => ("cli_run", "dashboard"),
        Commands::Link { .. } => ("cli_run", "link"),
        Commands::Chat { .. } => ("cli_run", "chat"),
        Commands::Agent { .. } => ("cli_run", "agent"),
        Commands::Prompt(_) => ("cli_run", "prompt"),
        Commands::Audit(_) => ("cli_run", "audit"),
        Commands::Completions { .. } => ("cli_run", "completions"),
    };
    let tel_handle = telemetry::spawn(tel_event, tel_command);

    let exit = commands::dispatch(&client, &cfg, &cli, command).await?;

    telemetry::finish(tel_handle).await;
    if exit != 0 {
        std::process::exit(exit);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    use crate::cli::{DoctorArgs, UpdateArgs};

    fn doctor_args(cli: Cli) -> DoctorArgs {
        match cli.command {
            Some(Commands::Doctor(args) | Commands::Diagnose(args)) => args,
            other => panic!("expected doctor/diagnose, got {other:?}"),
        }
    }

    fn update_args(cli: Cli) -> UpdateArgs {
        match cli.command {
            Some(Commands::Update(args) | Commands::Upgrade(args)) => args,
            other => panic!("expected update/upgrade, got {other:?}"),
        }
    }

    #[test]
    fn upgrade_is_first_class_alias_of_update() {
        for argv in [["chm", "update"], ["chm", "upgrade"]] {
            let args = update_args(Cli::try_parse_from(argv).expect("parse"));
            assert!(!args.check);
            assert!(args.version.is_none());
        }
    }

    #[test]
    fn upgrade_and_update_share_check_flag() {
        for argv in [["chm", "update", "--check"], ["chm", "upgrade", "--check"]] {
            let args = update_args(Cli::try_parse_from(argv).expect("parse"));
            assert!(args.check);
            assert!(args.version.is_none());
        }
    }

    #[test]
    fn upgrade_and_update_share_version_flag() {
        for argv in [
            ["chm", "update", "--version", "chm-v0.2.0"],
            ["chm", "upgrade", "--version", "chm-v0.2.0"],
        ] {
            let args = update_args(Cli::try_parse_from(argv).expect("parse"));
            assert!(!args.check);
            assert_eq!(args.version.as_deref(), Some("chm-v0.2.0"));
        }
        for argv in [
            ["chm", "update", "--version", "0.2.0"],
            ["chm", "upgrade", "--version", "0.2.0"],
        ] {
            let args = update_args(Cli::try_parse_from(argv).expect("parse"));
            assert_eq!(args.version.as_deref(), Some("0.2.0"));
        }
    }

    #[test]
    fn help_lists_update_and_upgrade() {
        let mut cmd = Cli::command();
        let help = cmd.render_long_help().to_string();
        assert!(help.contains("update"), "{help}");
        assert!(help.contains("upgrade"), "{help}");
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
        assert!(help.contains("zero-signup"), "{help}");
        assert!(help.contains("doctor"), "{help}");
        assert!(help.contains("diagnose"), "{help}");
        assert!(help.contains("--base-url"), "{help}");
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
    fn diagnose_without_host_still_parses_as_alias() {
        let cli = Cli::try_parse_from(["chm", "diagnose"]).expect("parse");
        assert!(
            matches!(cli.command, Some(Commands::Diagnose(_))),
            "expected Diagnose, got {:?}",
            cli.command
        );
    }

    #[test]
    fn doctor_with_host_is_cluster_scan() {
        let args = doctor_args(
            Cli::try_parse_from([
                "chm",
                "doctor",
                "--ch-host",
                "http://localhost:8123",
                "--ch-user",
                "default",
            ])
            .expect("parse"),
        );
        assert!(matches!(
            Cli::try_parse_from(["chm", "doctor", "--ch-host", "http://localhost:8123"])
                .expect("parse")
                .command,
            Some(Commands::Doctor(_))
        ));
        assert_eq!(args.ch_host.as_deref(), Some("http://localhost:8123"));
        assert!(args.has_cluster_host());
        assert_eq!(args.ch_user, "default");
    }

    #[test]
    fn diagnose_is_alias_of_doctor_cluster_scan() {
        let args = doctor_args(
            Cli::try_parse_from(["chm", "diagnose", "--ch-host", "http://127.0.0.1:8123"])
                .expect("parse"),
        );
        assert!(matches!(
            Cli::try_parse_from(["chm", "diagnose", "--ch-host", "http://127.0.0.1:8123"])
                .expect("parse")
                .command,
            Some(Commands::Diagnose(_))
        ));
        assert_eq!(args.ch_host.as_deref(), Some("http://127.0.0.1:8123"));
        assert!(args.has_cluster_host());
        assert!(!args.json);
    }

    #[test]
    fn cluster_host_ignores_blank_values() {
        let blank = DoctorArgs {
            ch_host: Some("  ".into()),
            ch_user: "default".into(),
            ch_password: String::new(),
            ch_database: "default".into(),
            json: false,
        };
        assert!(!blank.has_cluster_host());
        let missing = DoctorArgs {
            ch_host: None,
            ..blank.clone()
        };
        assert!(!missing.has_cluster_host());
        let present = DoctorArgs {
            ch_host: Some("http://localhost:8123".into()),
            ..blank
        };
        assert!(present.has_cluster_host());
    }

    #[test]
    fn diagnose_and_doctor_share_scan_flags() {
        for argv in [
            [
                "chm",
                "doctor",
                "--ch-host",
                "http://localhost:8123",
                "--json",
            ],
            [
                "chm",
                "diagnose",
                "--ch-host",
                "http://localhost:8123",
                "--json",
            ],
        ] {
            let args = doctor_args(Cli::try_parse_from(argv).expect("parse"));
            assert_eq!(args.ch_host.as_deref(), Some("http://localhost:8123"));
            assert!(args.json);
        }
    }

    #[test]
    fn doctor_and_diagnose_help_share_ch_host() {
        let mut cmd = Cli::command();
        let doctor_help = cmd
            .find_subcommand_mut("doctor")
            .expect("doctor subcommand")
            .render_long_help()
            .to_string();
        let mut cmd = Cli::command();
        let diagnose_help = cmd
            .find_subcommand_mut("diagnose")
            .expect("diagnose subcommand")
            .render_long_help()
            .to_string();
        for help in [&doctor_help, &diagnose_help] {
            assert!(help.contains("--ch-host"), "{help}");
            assert!(help.contains("--ch-user"), "{help}");
            assert!(help.contains("--json"), "{help}");
        }
    }

    #[test]
    fn update_and_upgrade_help_share_flags() {
        // clap 4's render_long_help takes &mut self.
        let mut cmd = Cli::command();
        let update_help = cmd
            .find_subcommand_mut("update")
            .expect("update subcommand")
            .render_long_help()
            .to_string();
        let mut cmd = Cli::command();
        let upgrade_help = cmd
            .find_subcommand_mut("upgrade")
            .expect("upgrade subcommand")
            .render_long_help()
            .to_string();
        for help in [&update_help, &upgrade_help] {
            assert!(help.contains("--check"), "{help}");
            assert!(help.contains("--version"), "{help}");
        }
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
