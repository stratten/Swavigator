//! Navigation and window/space manipulation.

mod close;
mod navigate;

pub use close::{close_space, close_window};
pub use navigate::{navigate_to_space, navigate_to_window};
