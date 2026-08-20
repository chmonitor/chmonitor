//! Clap definitions for `chm`.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "chm",
    version = concat!(env!("CARGO_PKG_VERSION"), " (", env!("CHM_TARGET"), ")"),
    about = "chmonitor CLI — dashboard API, TUI, and zero-signup diagnostics"
)]
pub struct Cli {
    /// Path to config.toml (default ~/.config/chm/config.toml)
    #[arg(long, env = "CHM_CONFIG", global = true)]
    pub config: Option<PathBuf>,

    /// Dashboard base URL (default https://dash.chmonitor.dev)
    #[arg(long, env = "CHM_BASE_URL", global = true)]
    pub base_url: Option<String>,

    /// Dashboard host id (default 0)
    #[arg(long, env = "CHM_HOST_ID", global = true)]
    pub host_id: Option<u32>,

    /// Dashboard API key (sent as x-api-key)
    #[arg(long, env = "CHM_API_KEY", global = true)]
    pub api_key: Option<String>,

    /// Bearer token (sent as Authorization: Bearer …)
    #[arg(long, env = "CHM_TOKEN", global = true)]
    pub token: Option<String>,

    /// Release channel for self-update (stable|beta)
    #[arg(long, env = "CHM_CHANNEL", global = true, value_enum)]
    pub channel: Option<Channel>,

    /// Print machine-readable JSON where supported
    #[arg(long, global = true)]
    pub json: bool,

    /// Suppress non-essential stderr output
    #[arg(long, short = 'q', global = true)]
    pub quiet: bool,

    /// Assume yes for confirmation prompts
    #[arg(long, short = 'y', global = true)]
    pub yes: bool,

    /// Enable verbose debug logging on stderr
    #[arg(long, global = true)]
    pub debug: bool,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Beta => "beta",
        }
    }
}

impl std::fmt::Display for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Sign in / out of chmonitor Cloud (device-code flow)
    Auth(AuthArgs),
    /// Show or edit local CLI config
    Config(ConfigArgs),
    /// List hosts from a running chmonitor dashboard
    Hosts,
    /// Open the dashboard (or a path) in the browser
    Link {
        /// Optional path under the dashboard base URL (e.g. /overview)
        path: Option<String>,
    },
    /// Fetch a named chart from the dashboard API
    Chart {
        /// Chart name, e.g. query-count
        name: String,
        /// Max rows to print
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Fetch a named table from the dashboard API
    Table {
        /// Table name, e.g. running-queries
        name: String,
        /// Max rows to print
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Live terminal UI for a dashboard chart (or overview)
    Tui {
        /// Chart name (default: config `default_chart`, else query-count)
        chart: Option<String>,
        /// Show overview metrics instead of a single chart
        #[arg(long)]
        overview: bool,
    },
    /// Stream a chat reply from the dashboard AI agent
    Chat {
        /// Prompt text (reads stdin when omitted)
        message: Option<String>,
    },
    /// One-shot agent request (non-interactive)
    Agent {
        /// Prompt text (reads stdin when omitted)
        prompt: Option<String>,
        /// Model id override
        #[arg(long)]
        model: Option<String>,
    },
    /// List or print built-in prompt packs
    Prompt(PromptArgs),
    /// Export or inspect audit events
    Audit(AuditArgs),
    /// Check local CLI + dashboard connectivity
    Doctor,
    /// Zero-signup local diagnostics: connect directly to a [REDACTED] host // pragma: allowlist secret
    /// (no chmonitor account/backend needed) and print a scored health report.
    Diagnose {
        /// [REDACTED] HTTP interface URL, e.g. http://localhost:8123 // pragma: allowlist secret
        #[arg(long, env = "CLICKHOUSE_HOST")] // pragma: allowlist secret
        ch_host: Option<String>,
        #[arg(
            long,
            env = "CLICKHOUSE_USER", // pragma: allowlist secret
            default_value = "default" // pragma: allowlist secret
        )]
        ch_user: String,
        #[arg(long, env = "CLICKHOUSE_PASSWORD", default_value = "")] // pragma: allowlist secret
        ch_password: String,
        #[arg(
            long,
            env = "CLICKHOUSE_DATABASE", // pragma: allowlist secret
            default_value = "default" // pragma: allowlist secret
        )]
        ch_database: String,
        /// Print the report as JSON instead of a table.
        #[arg(long)]
        json: bool,
    },
    /// Update chm to the latest GitHub release (self-update).
    ///
    /// Prints current -> target version, verifies sha256, and atomically
    /// replaces this binary. Never invokes sudo: checksum, permission, and
    /// unsupported-target failures print a copy-pasteable fallback
    /// (`scripts/install.sh` or `cargo install ch-monitor-cli`).
    Update(UpdateArgs),
    /// Alias of `update`. Same flags (`--check`, `--version`), same behaviour.
    Upgrade(UpdateArgs),
    /// Generate shell completions
    Completions {
        /// Shell to emit completions for
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
}

/// Shared flags for `chm update` and `chm upgrade`.
#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// Only check whether an update is available; exit 1 if one exists.
    #[arg(long)]
    pub check: bool,
    /// Install a specific release tag, e.g. chm-v0.2.0.
    #[arg(long)]
    pub version: Option<String>,
}

#[derive(Args, Debug)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub command: AuthCommand,
}

#[derive(Subcommand, Debug)]
pub enum AuthCommand {
    /// Sign in via browser device-code flow
    Login,
    /// Clear stored credentials
    Logout,
    /// Show whether a token/api-key is configured
    Status,
}

#[derive(Args, Debug)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub command: ConfigCommand,
}

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Print the resolved config
    Show,
    /// Print the user config file path
    Path,
    /// Set a key in the user config file
    Set {
        /// Config key (base_url, host_id, api_key, default_chart, channel)
        key: String,
        /// Value to write
        value: String,
    },
}

#[derive(Args, Debug)]
pub struct PromptArgs {
    #[command(subcommand)]
    pub command: PromptCommand,
}

#[derive(Subcommand, Debug)]
pub enum PromptCommand {
    /// List built-in prompt packs
    List,
    /// Print a built-in prompt by name
    Show {
        /// Prompt pack name
        name: String,
    },
}

#[derive(Args, Debug)]
pub struct AuditArgs {
    #[command(subcommand)]
    pub command: AuditCommand,
}

#[derive(Subcommand, Debug)]
pub enum AuditCommand {
    /// Export audit events (JSON)
    Export {
        /// Max events to fetch
        #[arg(long, default_value_t = 100)]
        limit: usize,
    },
}
