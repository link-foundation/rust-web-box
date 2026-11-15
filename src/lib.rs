//! Rust Web Box's example arithmetic API.
//!
//! The `rust-web-box` CLI uses the same [`sum()`] function. The browser
//! workbench is deployed separately from this crate.
//!
//! ```
//! use rust_web_box::sum;
//!
//! assert_eq!(sum(3, 7), 10);
//! ```

pub mod sum;

pub use sum::sum;
