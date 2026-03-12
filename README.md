<p align="right">
  <a href="README.ko.md">🇰🇷 한국어</a>
</p>

<h1 align="center">AsQu</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/rust-2024_edition-orange.svg?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/tauri-2-24C8D8.svg?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/MCP-compatible-8A2BE2.svg" alt="MCP Compatible">
</p>

<p align="center">
  <b>Async Ask Question Queue for AI coding agents</b><br>
  Questions queue up in a desktop app — answer at your own pace, no more idle waiting.
</p>

<p align="center">
  <img src="image.png" alt="AsQu Screenshot">
</p>

## What is AsQu?

AsQu is an Async Ask Question Queue for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and other MCP-compatible agents. Instead of the agent blocking on one question at a time, questions accumulate in a desktop UI and you answer them whenever you're ready.

## Installation

### Prerequisites

- [Rust](https://rustup.rs/) toolchain (edition 2024)
- Platform dependencies for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

### Install

```bash
# 1. Install binary
cargo install --git https://github.com/inonego/AsQu.git --bin asqu

# 2. Register marketplace
claude plugin marketplace add inonego/AsQu

# 3. Install plugin
claude plugin install asqu
```

## MCP Configuration

Add to your project `.mcp.json` (or `~/.claude.json` for global):

```json
{
  "mcpServers": {
    "asqu": {
      "command": "asqu"
    }
  }
}
```

> If not installed via `cargo install`, replace `"asqu"` with the full path to the binary.

The desktop UI launches automatically when the MCP server starts.

## MCP Tools

| Tool | Description |
|---|---|
| `ask` | Submit questions (free-text, single/multi-choice, instant, with category/priority) |
| `get_answers` | Non-blocking poll for answer status |
| `wait_for_answers` | Block until answers arrive (supports timeout, require_all) |
| `list_questions` | List questions filtered by status |
| `dismiss_questions` | Cancel pending questions |
| `open_ui` | Show the desktop window |

## License

[MIT](LICENSE)
