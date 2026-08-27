//! `chm add` / `ls` / `use` / `rm` — local named connections (no dashboard).

use anyhow::Result;

use crate::{
    cli::AddConnectionArgs,
    config::AppConfig,
    connections::{self, ConnectionStore},
    output,
};

fn store(cfg: &AppConfig) -> ConnectionStore {
    ConnectionStore::from_config_path(cfg.user_config_path.clone())
}

pub fn add(
    cfg: &AppConfig,
    url: &str,
    args: &AddConnectionArgs,
    ch_user: &str,
    ch_password: &str,
    ch_database: &str,
) -> Result<()> {
    let mut parsed = connections::parse_connection_url(url)?;
    connections::apply_ch_args(&mut parsed, ch_user, ch_password, ch_database); // pragma: allowlist secret
    let engine = parsed.engine.as_str().to_string();
    let conn_host = format!("{}:{}", parsed.host, parsed.port);
    let store = store(cfg);
    let outcome = store.add(parsed, args.name.as_deref())?;
    let verb = if outcome.replacing {
        "updated"
    } else {
        "saved"
    };
    if !cfg.quiet {
        output::success(&format!(
            "{verb} connection '{}' ({} {conn_host})",
            outcome.name, engine
        ));
        if outcome.current.as_deref() == Some(outcome.name.as_str()) {
            output::info("active — `chm use` to switch, `chm ls` to list");
        } else {
            output::info(&format!(
                "run `chm use {}` to make this the active connection",
                outcome.name
            ));
        }
    }
    Ok(())
}

pub fn ls(cfg: &AppConfig) -> Result<()> {
    let store = store(cfg);
    let (conns, current) = store.load()?;
    if cfg.json {
        output::print_json(&connections::list_json(&conns, current.as_deref()))?;
        return Ok(());
    }
    if conns.is_empty() {
        print!(
            "{}",
            connections::format_list_text(&conns, current.as_deref())
        );
        return Ok(());
    }
    if crate::output::wants_tui(false, false) {
        if let Some(idx) = crate::tui::picker::run(
            "local connections",
            connections::picker_labels(&conns, current.as_deref()),
            " j/k select  Enter use  q quit",
            Some("local store — not dashboard `chm hosts`".into()),
        )? {
            let name = &conns[idx].name;
            let conn = store.use_name(name)?;
            output::success(&format!(
                "using '{}' ({} {})",
                conn.name,
                conn.engine.as_str(),
                conn.display_host()
            ));
        }
        return Ok(());
    }
    print!(
        "{}",
        connections::format_list_text(&conns, current.as_deref())
    );
    Ok(())
}

pub fn use_name(cfg: &AppConfig, name: &str) -> Result<()> {
    let conn = store(cfg).use_name(name)?;
    if !cfg.quiet {
        output::success(&format!(
            "using '{}' ({} {})",
            conn.name,
            conn.engine.as_str(),
            conn.display_host()
        ));
    }
    Ok(())
}

pub fn rm(cfg: &AppConfig, name: &str) -> Result<()> {
    let conn = store(cfg).remove(name)?;
    if !cfg.quiet {
        output::success(&format!("removed '{}'", conn.name));
    }
    Ok(())
}
