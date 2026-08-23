//! Interactive `chm config` dialog (alt-screen). Secrets stay out of the form body.

use std::io;

use anyhow::{bail, Result};
use crossterm::{
    event::{self, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Paragraph, Wrap},
    Frame, Terminal,
};

use crate::{
    cli::Channel,
    config::{self, AppConfig, FileConfig, DEFAULT_BASE_URL, DEFAULT_CHART},
};

const ORANGE: Color = Color::Rgb(249, 115, 22);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    BaseUrl,
    HostId,
    Channel,
    DefaultChart,
    Save,
    Cancel,
}

impl Field {
    fn next(self) -> Self {
        match self {
            Field::BaseUrl => Field::HostId,
            Field::HostId => Field::Channel,
            Field::Channel => Field::DefaultChart,
            Field::DefaultChart => Field::Save,
            Field::Save => Field::Cancel,
            Field::Cancel => Field::BaseUrl,
        }
    }

    fn prev(self) -> Self {
        match self {
            Field::BaseUrl => Field::Cancel,
            Field::HostId => Field::BaseUrl,
            Field::Channel => Field::HostId,
            Field::DefaultChart => Field::Channel,
            Field::Save => Field::DefaultChart,
            Field::Cancel => Field::Save,
        }
    }

    fn is_text(self) -> bool {
        matches!(self, Field::BaseUrl | Field::HostId | Field::DefaultChart)
    }
}

#[derive(Debug, Clone)]
pub struct ConfigForm {
    pub base_url: String,
    pub host_id: String,
    pub channel: Channel,
    pub default_chart: String,
    selected: Field,
    error: Option<String>,
}

impl ConfigForm {
    pub fn from_config(cfg: &AppConfig, file: &FileConfig) -> Self {
        Self {
            base_url: file
                .base_url
                .clone()
                .unwrap_or_else(|| cfg.base_url.clone()),
            host_id: file.host_id.unwrap_or(cfg.host_id).to_string(),
            channel: file
                .channel
                .as_deref()
                .and_then(|c| match c {
                    "beta" => Some(Channel::Beta),
                    "stable" => Some(Channel::Stable),
                    _ => None,
                })
                .unwrap_or(cfg.channel),
            default_chart: file
                .default_chart
                .clone()
                .unwrap_or_else(|| cfg.default_chart.clone()),
            selected: Field::BaseUrl,
            error: None,
        }
    }

    pub fn apply_key(&mut self, key: KeyEvent) -> FormAction {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return FormAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return FormAction::Cancel;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            return self.try_save();
        }
        match key.code {
            KeyCode::Esc => FormAction::Cancel,
            KeyCode::Enter => match self.selected {
                Field::Cancel => FormAction::Cancel,
                Field::Save
                | Field::BaseUrl
                | Field::HostId
                | Field::Channel
                | Field::DefaultChart => self.try_save(),
            },
            KeyCode::Char('s') if !self.selected.is_text() => self.try_save(),
            KeyCode::Tab | KeyCode::Down => {
                self.selected = self.selected.next();
                FormAction::None
            }
            KeyCode::Char('j') if !self.selected.is_text() => {
                self.selected = self.selected.next();
                FormAction::None
            }
            KeyCode::BackTab | KeyCode::Up => {
                self.selected = self.selected.prev();
                FormAction::None
            }
            KeyCode::Char('k') if !self.selected.is_text() => {
                self.selected = self.selected.prev();
                FormAction::None
            }
            KeyCode::Left | KeyCode::Char('h') if self.selected == Field::Channel => {
                self.channel = match self.channel {
                    Channel::Stable => Channel::Beta,
                    Channel::Beta => Channel::Stable,
                };
                FormAction::None
            }
            KeyCode::Right | KeyCode::Char('l') if self.selected == Field::Channel => {
                self.channel = match self.channel {
                    Channel::Stable => Channel::Beta,
                    Channel::Beta => Channel::Stable,
                };
                FormAction::None
            }
            KeyCode::Backspace if self.selected.is_text() => {
                self.edit_buf().pop();
                FormAction::None
            }
            KeyCode::Char(c)
                if self.selected.is_text() && !key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                self.insert_char(c);
                FormAction::None
            }
            _ => FormAction::None,
        }
    }

    fn insert_char(&mut self, c: char) {
        if c.is_control() {
            return;
        }
        self.edit_buf().push(c);
    }

    fn edit_buf(&mut self) -> &mut String {
        match self.selected {
            Field::BaseUrl => &mut self.base_url,
            Field::HostId => &mut self.host_id,
            Field::DefaultChart => &mut self.default_chart,
            Field::Channel | Field::Save | Field::Cancel => unreachable!(),
        }
    }

    fn try_save(&mut self) -> FormAction {
        match self.to_file_patch() {
            Ok(_) => FormAction::Save,
            Err(err) => {
                self.error = Some(err);
                FormAction::None
            }
        }
    }

    pub fn to_file_patch(&self) -> Result<FileConfig, String> {
        let base_url = self.base_url.trim();
        if base_url.is_empty() {
            return Err("base_url must not be empty".into());
        }
        let host_id: u32 = self
            .host_id
            .trim()
            .parse()
            .map_err(|_| "host_id must be an integer".to_string())?;
        let default_chart = self.default_chart.trim();
        if default_chart.is_empty() {
            return Err("default_chart must not be empty".into());
        }
        Ok(FileConfig {
            base_url: Some(base_url.to_string()),
            host_id: Some(host_id),
            api_key: None,
            token: None,
            default_chart: Some(default_chart.to_string()),
            channel: Some(self.channel.as_str().to_string()),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormAction {
    None,
    Save,
    Cancel,
}

struct FormGuard;

impl Drop for FormGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub fn run(cfg: &AppConfig) -> Result<()> {
    if !crate::output::wants_tui(cfg.json, false) {
        bail!(
            "interactive config needs a terminal (or use `chm config show` / `chm config set KEY VALUE`)"
        );
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = FormGuard;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let existing = config::load_user_file_config(&cfg.user_config_path)?;
    let mut form = ConfigForm::from_config(cfg, &existing);
    let mut saved = false;

    loop {
        terminal.draw(|f| draw(f, cfg, &form, &existing))?;
        if !event::poll(std::time::Duration::from_millis(250))? {
            continue;
        }
        let event::Event::Key(key) = event::read()? else {
            continue;
        };
        match form.apply_key(key) {
            FormAction::None => {}
            FormAction::Cancel => break,
            FormAction::Save => {
                let patch = form.to_file_patch().map_err(|e| anyhow::anyhow!(e))?;
                let mut file = existing.clone();
                file.base_url = patch.base_url;
                file.host_id = patch.host_id;
                file.default_chart = patch.default_chart;
                file.channel = patch.channel;
                config::save_user_config(&cfg.user_config_path, &file)?;
                saved = true;
                break;
            }
        }
    }
    drop(terminal);
    drop(_guard);
    if saved {
        crate::output::success(&format!("saved {}", cfg.user_config_path.display()));
    }
    Ok(())
}

fn draw(f: &mut Frame<'_>, cfg: &AppConfig, form: &ConfigForm, file: &FileConfig) {
    let area = f.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(12),
            Constraint::Length(3),
        ])
        .split(area);

    f.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                " chm config ",
                Style::default().fg(ORANGE).add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                cfg.user_config_path.display().to_string(),
                Style::default().fg(Color::DarkGray),
            ),
        ]))
        .block(Block::bordered()),
        chunks[0],
    );

    let api = if file.api_key.as_ref().is_some_and(|k| !k.is_empty()) {
        "(set)  — not edited here"
    } else {
        "(unset)  — use `chm config set api_key …` or `chm auth login`"
    };
    let token = if file.token.as_ref().is_some_and(|t| !t.is_empty()) {
        "(set)  — not edited here"
    } else {
        "(unset)  — use `chm auth login`"
    };

    let mut lines = vec![
        field_line("base_url", &form.base_url, form.selected == Field::BaseUrl),
        field_line("host_id", &form.host_id, form.selected == Field::HostId),
        field_line(
            "channel",
            form.channel.as_str(),
            form.selected == Field::Channel,
        ),
        field_line(
            "default_chart",
            &form.default_chart,
            form.selected == Field::DefaultChart,
        ),
        Line::from(""),
        Line::from(Span::styled(
            format!("api_key   {api}"),
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(Span::styled(
            format!("token     {token}"),
            Style::default().fg(Color::DarkGray),
        )),
        Line::from(""),
        action_line("[ Save ]", form.selected == Field::Save),
        action_line("[ Cancel ]", form.selected == Field::Cancel),
    ];
    if let Some(err) = &form.error {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            err.clone(),
            Style::default().fg(Color::Red),
        )));
    }

    f.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(Block::bordered().title("user config (no secrets in form)")),
        chunks[1],
    );

    f.render_widget(
        Paragraph::new(format!(
            " Tab/↑↓ field  type to edit  h/l channel  Enter/s save  Esc cancel  · default {DEFAULT_BASE_URL} / {DEFAULT_CHART}"
        ))
        .style(Style::default().fg(Color::DarkGray)),
        chunks[2],
    );
}

fn field_line<'a>(label: &'a str, value: &'a str, selected: bool) -> Line<'a> {
    let style = if selected {
        Style::default()
            .fg(ORANGE)
            .add_modifier(Modifier::BOLD | Modifier::REVERSED)
    } else {
        Style::default()
    };
    Line::from(vec![
        Span::raw(format!("{label:<14} ")),
        Span::styled(format!(" {value} "), style),
    ])
}

fn action_line(label: &str, selected: bool) -> Line<'static> {
    let style = if selected {
        Style::default()
            .fg(ORANGE)
            .add_modifier(Modifier::BOLD | Modifier::REVERSED)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    Line::from(Span::styled(label.to_string(), style))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DEFAULT_HOST_ID;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn sample_cfg() -> AppConfig {
        AppConfig {
            base_url: DEFAULT_BASE_URL.to_string(),
            host_id: DEFAULT_HOST_ID,
            api_key: None,
            token: None,
            default_chart: DEFAULT_CHART.to_string(),
            channel: Channel::Stable,
            json: false,
            quiet: false,
            yes: false,
            debug: false,
            user_config_path: std::path::PathBuf::from("/tmp/chm-test-config.toml"),
        }
    }

    #[test]
    fn save_writes_fields_without_secrets() {
        let cfg = sample_cfg();
        let file = FileConfig {
            api_key: Some("secret".into()),
            token: Some("tok".into()),
            ..FileConfig::default()
        };
        let form = ConfigForm::from_config(&cfg, &file);
        let patch = form.to_file_patch().unwrap();
        assert_eq!(patch.base_url.as_deref(), Some(DEFAULT_BASE_URL));
        assert_eq!(patch.host_id, Some(0));
        assert_eq!(patch.channel.as_deref(), Some("stable"));
        assert_eq!(patch.default_chart.as_deref(), Some(DEFAULT_CHART));
        assert!(patch.api_key.is_none());
        assert!(patch.token.is_none());
    }

    #[test]
    fn host_id_must_be_integer() {
        let mut form = ConfigForm::from_config(&sample_cfg(), &FileConfig::default());
        form.host_id = "nope".into();
        assert!(form.to_file_patch().is_err());
        form.host_id = "4".into();
        assert_eq!(form.to_file_patch().unwrap().host_id, Some(4));
    }

    #[test]
    fn enter_saves_and_esc_cancels() {
        let mut form = ConfigForm::from_config(&sample_cfg(), &FileConfig::default());
        assert_eq!(form.apply_key(key(KeyCode::Esc)), FormAction::Cancel);
        assert_eq!(form.apply_key(key(KeyCode::Enter)), FormAction::Save);
        form.selected = Field::Save;
        assert_eq!(form.apply_key(key(KeyCode::Char('s'))), FormAction::Save);
        form.selected = Field::Cancel;
        assert_eq!(form.apply_key(key(KeyCode::Enter)), FormAction::Cancel);
    }

    #[test]
    fn typing_edits_selected_text_field() {
        let mut form = ConfigForm::from_config(&sample_cfg(), &FileConfig::default());
        form.base_url.clear();
        form.apply_key(key(KeyCode::Char('h')));
        form.apply_key(key(KeyCode::Char('t')));
        form.apply_key(key(KeyCode::Char('t')));
        form.apply_key(key(KeyCode::Backspace));
        assert_eq!(form.base_url, "ht");
        form.selected = Field::Channel;
        form.apply_key(key(KeyCode::Right));
        assert_eq!(form.channel, Channel::Beta);
    }
}
