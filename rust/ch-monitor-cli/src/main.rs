//! `chm` — chmonitor CLI entry point (dispatch only).

mod cli;
mod client;
mod commands;
mod config;
mod credentials;
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

use crate::cli::{Cli, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let cfg = config::resolve_config(&cli)?;
    let client = Client::builder().timeout(Duration::from_secs(60)).build()?;

    // Anonymous, opt-out CLI telemetry (source=cli). Fires in the background and
    // never blocks or fails the command; see src/telemetry.rs.
    let (tel_event, tel_command): (&'static str, &'static str) = match &cli.command {
        Commands::Diagnose { .. } => ("cli_diagnose", "diagnose"),
        Commands::Hosts => ("cli_run", "hosts"),
        Commands::Chart { .. } => ("cli_run", "chart"),
        Commands::Table { .. } => ("cli_run", "table"),
        Commands::Tui { .. } => ("cli_run", "tui"),
        Commands::Update(_) | Commands::Upgrade(_) => ("cli_run", "update"),
        Commands::Auth(_) => ("cli_run", "auth"),
        Commands::Config(_) => ("cli_run", "config"),
        Commands::Link { .. } => ("cli_run", "link"),
        Commands::Chat { .. } => ("cli_run", "chat"),
        Commands::Agent { .. } => ("cli_run", "agent"),
        Commands::Prompt(_) => ("cli_run", "prompt"),
        Commands::Audit(_) => ("cli_run", "audit"),
        Commands::Doctor => ("cli_run", "doctor"),
        Commands::Completions { .. } => ("cli_run", "completions"),
    };
    let tel_handle = telemetry::spawn(tel_event, tel_command);

    let exit = commands::dispatch(&client, &cfg, cli.command).await?;

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

    use crate::cli::UpdateArgs;

    fn update_args(cli: Cli) -> UpdateArgs {
        match cli.command {
            Commands::Update(args) | Commands::Upgrade(args) => args,
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
        assert!(matches!(cli.command, Commands::Hosts));
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
        assert!(help.contains("--base-url"), "{help}");
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
}
