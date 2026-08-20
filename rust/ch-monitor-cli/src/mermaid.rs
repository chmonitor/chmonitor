//! Optional Mermaid rendering (feature `mermaid`).
//!
//! Without the feature, print the Mermaid source as a fenced code block so
//! operators can paste it into a viewer.

#![allow(dead_code)]

#[cfg(feature = "mermaid")]
pub fn print_mermaid(source: &str) {
    // Feature stub: when a real renderer is wired, render to SVG/PNG here.
    print_source_fallback(source);
}

#[cfg(not(feature = "mermaid"))]
pub fn print_mermaid(source: &str) {
    print_source_fallback(source);
}

pub fn print_source_fallback(source: &str) {
    println!("```mermaid");
    println!("{source}");
    println!("```");
}
