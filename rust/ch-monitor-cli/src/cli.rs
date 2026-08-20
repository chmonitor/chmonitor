//! Clap definitions for `chm` / `chmonitor`.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "chm",
    version = concat!(env!("CARGO_PKG_VERSION"), " (", env!("CHM_TARGET"), ")"),
    about = "chmonitor CLI (`chm` / `chmonitor`) — dashboard API, TUI, and zero-signup cluster health (`chm doctor`)"
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
    /// Sign in / out — auto-detects open API, device login, or API key
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
        /// Print column names / query-config metadata (SQL hint when available)
        #[arg(long)]
        explain: bool,
    },
    /// Live multi-pane terminal UI (overview / chart / table). Enters alt-screen.
    Tui {
        /// Chart name (default: config `default_chart`, else query-count)
        chart: Option<String>,
        /// Start in overview mode (hosts summary + default chart sparkline)
        #[arg(long)]
        overview: bool,
        /// Table name for pane 3 (default: running-queries)
        #[arg(long, default_value = "running-queries")]
        table: String,
        /// Page size when fetching the TUI table pane
        #[arg(long, default_value_t = 15)]
        page_size: usize,
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
    /// Cluster health scan (with --ch-host) or CLI + dashboard connectivity.
    ///
    /// With `--ch-host`, runs a zero-signup read-only cluster health report.
    /// Without a host, checks local CLI + dashboard connectivity.
    Doctor(DoctorArgs),
    /// Alias of `doctor` cluster scan. Same flags; always the health report.
    Diagnose(DoctorArgs),
    /// Update chm to the latest GitHub release (self-update).
    ///
    /// Prints current -> target version, verifies sha256, and atomically
    /// replaces this binary. Never invokes sudo: checksum, permission, and
    /// unsupported-target failures print a copy-pasteable fallback
    /// (`scripts/install.sh` or `cargo install chmonitor`).
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

/// Flags for `chm doctor` / `chm diagnose`.
#[derive(Args, Debug, Clone)]
pub struct DoctorArgs {
    /// ClickHouse HTTP interface URL, e.g. http://localhost:8123.
    /// When set, `chm doctor` runs the cluster health scan instead of connectivity.
    #[arg(long, env = "CLICKHOUSE_HOST")] // pragma: allowlist secret
    pub ch_host: Option<String>,
    #[arg(
        long,
        env = "CLICKHOUSE_USER", // pragma: allowlist secret
        default_value = "default" // pragma: allowlist secret
    )]
    pub ch_user: String,
    #[arg(long, env = "CLICKHOUSE_PASSWORD", default_value = "")] // pragma: allowlist secret
    pub ch_password: String,
    #[arg(
        long,
        env = "CLICKHOUSE_DATABASE", // pragma: allowlist secret
        default_value = "default" // pragma: allowlist secret
    )]
    pub ch_database: String,
    /// Print the cluster-scan report as JSON instead of a table.
    #[arg(long)]
    pub json: bool,
}

impl DoctorArgs {
    /// True when `--ch-host` (or the matching env) points at a cluster.
    pub fn has_cluster_host(&self) -> bool {
        self.ch_host.as_ref().is_some_and(|h| !h.trim().is_empty())
    }
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
    /// Sign in (auto-detects none / device / api_key)
    Login(AuthLoginArgs),
    /// Clear stored credentials
    Logout,
    /// Show whether a token/api-key is configured
    Status,
    /// Print the stored bearer token to stdout (for CI)
    Token,
}

#[derive(Args, Debug)]
pub struct AuthLoginArgs {
    /// API key to store when the dashboard requires key auth (skips prompt)
    #[arg(long, env = "CHM_API_KEY")]
    pub api_key: Option<String>,
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
