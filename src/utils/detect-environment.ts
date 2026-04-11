// ---------------------------------------------------------------------------
// Run environment detection
//
// Detects whether the CLI is running:
//   - inside Claude Code (no API key needed — static analysis is sufficient)
//   - standalone with an Anthropic API key available
//   - standalone without any API key
//
// This function is intentionally synchronous — it only inspects process.env.
// ---------------------------------------------------------------------------

export type RunEnvironment = "claude-code" | "standalone-with-key" | "standalone-no-key"

/**
 * Detects the current run environment by inspecting environment variables.
 *
 * Claude Code sets one or more of these variables when it spawns child processes:
 *   - ANTHROPIC_MODEL   — the active model name, always present in Claude Code sessions
 *   - CLAUDE_CODE       — explicit flag set by Claude Code
 *   - CLAUDE_CODE_ENTRYPOINT — the agent entry point path
 *
 * Detection order:
 *  1. If any Claude Code marker is present → "claude-code"
 *  2. If ANTHROPIC_API_KEY is present → "standalone-with-key"
 *  3. Otherwise → "standalone-no-key"
 */
export function detectRunEnvironment(): RunEnvironment {
  if (
    process.env.ANTHROPIC_MODEL !== undefined ||
    process.env.CLAUDE_CODE !== undefined ||
    process.env.CLAUDE_CODE_ENTRYPOINT !== undefined
  ) {
    return "claude-code"
  }

  if (process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY.length > 0) {
    return "standalone-with-key"
  }

  return "standalone-no-key"
}
