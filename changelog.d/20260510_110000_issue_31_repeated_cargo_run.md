## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.
