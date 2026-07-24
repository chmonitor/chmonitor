// Expose the compile-time target triple (e.g. `x86_64-unknown-linux-gnu`) to the
// crate as `env!("CHM_TARGET")`. Cargo sets `TARGET` for build scripts; we re-emit
// it as a rustc-env so `chm update` can pick the matching release asset.
fn main() {
    let target = std::env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=CHM_TARGET={target}");
}
