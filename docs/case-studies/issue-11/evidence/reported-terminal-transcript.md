```
rust-web-box — anonymous in-browser Rust sandbox
Powered by CheerpX (leaningtech/webvm) and VS Code Web.

[rust-web-box] Booting Linux VM…
..
[rust-web-box] Linux VM ready ✓
[rust-web-box] disk: ./disk/rust-alpine.ext2
[rust-web-box] Workspace mirrored to /workspace — try `cargo run` in /workspace/hello.

set +o history 2>/dev/null
stty -echo 2>/dev/null
printf '\n[rust-web-box] preparing /workspace …\n'
mkdir -p '/workspace/.vscode'
cat > '/workspace/.vscode/launch.json' <<'RWB_EOF'
{
  "version": "0.2.0",
  "configurations": []
}

RWB_EOF
mkdir -p '/workspace/.vscode'
cat > '/workspace/.vscode/settings.json' <<'RWB_EOF'
{
  // Workspace settings for rust-web-box.
  // Edit freely — changes persist in your browser's IndexedDB.
  "files.autoSave": "afterDelay",
  "editor.formatOnSave": false,
  "rust-analyzer.checkOnSave": false
}

RWB_EOF
mkdir -p '/workspace/.vscode'
cat > '/workspace/.vscode/tasks.json' <<'RWB_EOF'
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "cargo run",
      "type": "shell",
      "command": "cd /workspace/hello && cargo run",
      "problemMatcher": ["$rustc"],
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}

RWB_EOF
mkdir -p '/workspace'
cat > '/workspace/README.md' <<'RWB_EOF'
# rust-web-box workspace

This workspace lives inside your browser. Files persist in IndexedDB
and are mirrored into the in-browser Linux VM at `/workspace/` so
`cargo run` from the terminal sees the same content.

## Try it

* Open `hello_world.rs` for a one-file demo.
* Open `hello/src/main.rs` and run `cargo run` from the terminal
  (or click the **Cargo Run** status-bar button).

RWB_EOF
mkdir -p '/workspace/hello'
cat > '/workspace/hello/Cargo.toml' <<'RWB_EOF'
[package]
name = "hello"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "hello"
path = "src/main.rs"

[dependencies]

RWB_EOF
mkdir -p '/workspace/hello/src'
cat > '/workspace/hello/src/main.rs' <<'RWB_EOF'
// Entry point built by `cargo run` from /workspace/hello.
// Edit and save — changes mirror into the VM on every save.

fn main() {
    println!("Hello from rust-web-box!");
    println!("Compiled by Rust inside the browser via CheerpX.");
}

RWB_EOF
mkdir -p '/workspace'
cat > '/workspace/hello_world.rs' <<'RWB_EOF'
// hello_world.rs — the entry point for the rust-web-box sandbox.
//
// `cargo run` from /workspace/hello will compile and execute this
// program inside the in-browser Linux VM. Edit freely; your changes
// persist in IndexedDB and are mirrored into the VM on every save.

fn main() {
    println!("Hello from rust-web-box!");
    println!("This binary was compiled inside CheerpX (WebVM).");
}

RWB_EOF
chown -R root:root /workspace 2>/dev/null || true
cd /workspace
stty echo 2>/dev/null
printf '[rust-web-box] /workspace ready — try `cargo run` from /workspace/hello\n'
clear 2>/dev/null; ls -la /workspace
[root@rust-web-box workspace]# set +o history 2>/dev/null
[root@rust-web-box workspace]# stty -echo 2>/dev/null
[root@rust-web-box workspace]# 

[rust-web-box] preparing /workspace …
[root@rust-web-box workspace]# 
[root@rust-web-box workspace]# 
> 
> 
> 
> 
> 
> 
[root@rust-web-box workspace]# 
[root@rust-web-box workspace]# 
> 
> 
> 
> 
> 
> 
> 
> 
> 
[root@rust-web-box workspace]# 
[root@rust-web-box workspace]# 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
[root@rust-web-box workspace]# 
[root@rust-web-box workspace]# 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
[root@rust-web-box workspace]# 
[root@rust-web-box workspace]# 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
> 
total 0
drwxr-xr-x    2 root     root          4096 Apr 30 10:39 .vscode
-rw-r--r--    1 root     root           387 Apr 30 10:39 README.md
drwxr-xr-x    5 root     root          4096 Apr 29 16:22 hello
-rw-r--r--    1 root     root           399 Apr 30 10:39 hello_world.rs
[root@rust-web-box workspace]# ls
README.md       hello           hello_world.rs
[root@rust-web-box workspace]# 
```

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code.

Please plan and execute everything in a single pull request, you have unlimited time and context, as context autocompacts and you can continue indefinetely, do as much as possible in one go, if something will be left over, we can continue in the same pull request (but don't rely on it too much), until it is each and every requirement fully addressed, and everything is totally done.