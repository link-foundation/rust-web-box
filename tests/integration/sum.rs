use std::process::Command;

#[test]
fn test_cli_default_args() {
    let output = Command::new(env!("CARGO_BIN_EXE_rust-web-box"))
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "0");
}

#[test]
fn test_cli_sum_two_numbers() {
    let output = Command::new(env!("CARGO_BIN_EXE_rust-web-box"))
        .args(["--a", "3", "--b", "7"])
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "10");
}

#[test]
fn test_cli_negative_numbers() {
    let output = Command::new(env!("CARGO_BIN_EXE_rust-web-box"))
        .args(["--a", "-5", "--b", "3"])
        .output()
        .expect("Failed to execute binary");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(stdout.trim(), "-2");
}

#[test]
fn test_cli_product_identity() {
    for flag in ["--help", "--version"] {
        let output = Command::new(env!("CARGO_BIN_EXE_rust-web-box"))
            .arg(flag)
            .output()
            .expect("Failed to execute binary");
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("rust-web-box"), "{stdout}");
        assert!(!stdout.contains("example-sum-package-name"), "{stdout}");
    }
}
