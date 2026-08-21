//! Ratatui list picker (alt-screen). Used by `chm dashboard list`.

use std::io::{self, IsTerminal};

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
    widgets::{Block, List, ListItem, ListState, Paragraph},
    Frame, Terminal,
};

const ORANGE: Color = Color::Rgb(249, 115, 22);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickerAction {
    None,
    Confirm,
    Cancel,
}

#[derive(Debug, Clone)]
pub struct Picker {
    pub title: String,
    pub items: Vec<String>,
    pub hints: String,
    pub selected: usize,
    pub note: Option<String>,
}

impl Picker {
    pub fn new(
        title: impl Into<String>,
        items: Vec<String>,
        hints: impl Into<String>,
        note: Option<String>,
    ) -> Result<Self> {
        if items.is_empty() {
            bail!("no items to pick");
        }
        Ok(Self {
            title: title.into(),
            items,
            hints: hints.into(),
            selected: 0,
            note,
        })
    }

    pub fn apply_key(&mut self, key: KeyEvent) -> PickerAction {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return PickerAction::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return PickerAction::Cancel;
        }
        let n = self.items.len();
        match key.code {
            KeyCode::Enter => PickerAction::Confirm,
            KeyCode::Esc | KeyCode::Char('q') => PickerAction::Cancel,
            KeyCode::Down | KeyCode::Char('j') | KeyCode::Char('l') => {
                self.selected = (self.selected + 1) % n;
                PickerAction::None
            }
            KeyCode::Up | KeyCode::Char('k') | KeyCode::Char('h') => {
                self.selected = self.selected.checked_sub(1).unwrap_or(n - 1);
                PickerAction::None
            }
            _ => PickerAction::None,
        }
    }
}

struct PickerGuard;

impl Drop for PickerGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

pub fn run(
    title: &str,
    items: Vec<String>,
    hints: &str,
    note: Option<String>,
) -> Result<Option<usize>> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        bail!("interactive picker needs a terminal");
    }
    let mut picker = Picker::new(title, items, hints, note)?;

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = PickerGuard;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    loop {
        terminal.draw(|f| draw(f, &picker))?;
        if !event::poll(std::time::Duration::from_millis(250))? {
            continue;
        }
        let event::Event::Key(key) = event::read()? else {
            continue;
        };
        match picker.apply_key(key) {
            PickerAction::None => {}
            PickerAction::Cancel => return Ok(None),
            PickerAction::Confirm => return Ok(Some(picker.selected)),
        }
    }
}

fn draw(f: &mut Frame<'_>, picker: &Picker) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(1),
        ])
        .split(f.area());

    let title = Line::from(vec![
        Span::styled(
            " chmonitor ",
            Style::default().fg(ORANGE).add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::raw(&picker.title),
    ]);
    f.render_widget(Paragraph::new(title).block(Block::bordered()), chunks[0]);

    let items: Vec<ListItem> = picker
        .items
        .iter()
        .map(|s| ListItem::new(s.as_str()))
        .collect();
    let mut state = ListState::default();
    state.select(Some(picker.selected));
    let mut block = Block::bordered();
    if let Some(note) = &picker.note {
        block = block.title(note.as_str());
    }
    let list = List::new(items)
        .block(block)
        .highlight_symbol("▸ ")
        .highlight_style(Style::default().fg(ORANGE).add_modifier(Modifier::BOLD));
    f.render_stateful_widget(list, chunks[1], &mut state);

    f.render_widget(
        Paragraph::new(picker.hints.as_str()).style(Style::default().fg(Color::DarkGray)),
        chunks[2],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn j_and_enter_select_second() {
        let mut p = Picker::new(
            "dashboards",
            vec!["Overview".into(), "Queries".into()],
            "",
            None,
        )
        .unwrap();
        assert_eq!(p.apply_key(key(KeyCode::Char('j'))), PickerAction::None);
        assert_eq!(p.selected, 1);
        assert_eq!(p.apply_key(key(KeyCode::Enter)), PickerAction::Confirm);
    }

    #[test]
    fn q_cancels() {
        let mut p = Picker::new("dashboards", vec!["Overview".into()], "", None).unwrap();
        assert_eq!(p.apply_key(key(KeyCode::Char('q'))), PickerAction::Cancel);
    }

    #[test]
    fn empty_items_error() {
        assert!(Picker::new("x", Vec::<String>::new(), "", None).is_err());
    }
}
