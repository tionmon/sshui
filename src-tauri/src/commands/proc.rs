//! Helpers for running the user's own CLI tools (git, gh, ssh, npm, docker, python).

use std::ffi::OsStr;
use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// A command with no console window and no interactive prompts.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Never let a tool wait on a prompt nobody can see
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("PIP_NO_INPUT", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null());
    cmd
}

pub fn run(program: impl AsRef<OsStr>, args: &[&str]) -> Option<Output> {
    command(program).args(args).output().ok()
}

/// Trimmed stdout, or None when empty.
pub fn stdout_text(output: &Output) -> Option<String> {
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Last non-empty line of stderr (falling back to stdout), for error messages.
pub fn error_line(output: &Output) -> String {
    let last_line = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .next_back()
            .map(str::to_string)
    };
    last_line(&output.stderr)
        .or_else(|| last_line(&output.stdout))
        .unwrap_or_else(|| "Command failed".to_string())
}

/// Run with a deadline, killing the process if it overruns. Output pipes are drained on
/// background threads so a chatty process can't block on a full pipe.
pub fn run_with_timeout(cmd: Command, timeout: Duration) -> Result<Output, String> {
    run_with_input(cmd, None, timeout)
}

/// Like `run_with_timeout`, writing `input` to the process's stdin first.
pub fn run_with_input(mut cmd: Command, input: Option<&[u8]>, timeout: Duration) -> Result<Output, String> {
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(input).map_err(|e| e.to_string())?;
        // stdin is dropped here so the process sees EOF
    }

    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let start = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout".to_string());
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// Run blocking work (process spawns, file IO) off the async runtime.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

pub fn open_url(url: &str) {
    #[cfg(windows)]
    let _ = command("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drains_large_output_and_passes_stdin() {
        // Produce more than a pipe buffer's worth of output; must not hang
        #[cfg(windows)]
        let cmd = {
            let mut c = command("powershell.exe");
            c.args(["-NoProfile", "-Command", "$input | ForEach-Object { $_ }; 'x' * 200000"]);
            c
        };
        #[cfg(not(windows))]
        let cmd = {
            let mut c = command("sh");
            c.args(["-c", "cat; head -c 200000 /dev/zero | tr '\\0' x"]);
            c
        };
        let out = run_with_input(cmd, Some(b"hello\n"), Duration::from_secs(30)).unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("hello"));
        assert!(text.len() >= 200_000);
    }
}
