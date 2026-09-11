#!/usr/bin/env bash
# Temporarily disable/re-enable the global rtk PreToolUse hook in
# ~/.claude/settings.json.
#
# Why this exists: when a Claude Code session is isolated in a git
# worktree (background jobs, EnterWorktree), the worktree-isolation
# safety check refuses to run ANY Bash command containing "git" if the
# rtk hook is active -- the hook wraps every Bash command through the
# rtk binary first, and the safety check can't verify a wrapped command
# targets the right directory, so it blocks unconditionally (confirmed:
# even a bare `git status` gets refused). There is no per-command bypass;
# the only fix is to disable the hook, run the git command directly
# (`! <command>` in the Claude Code prompt, or from a normal shell), then
# re-enable it. Claude Code's own auto-mode classifier also refuses to
# self-modify hooks.PreToolUse, so this can only be run by a human, in a
# real terminal -- not by Claude via its Bash tool.
#
# Usage:
#   scripts/toggle-rtk-hook.sh off      # disable the hook
#   scripts/toggle-rtk-hook.sh on       # restore the hook from backup
#   scripts/toggle-rtk-hook.sh status   # show current state
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
BACKUP="$HOME/.claude/settings.json.hooks-backup"

if [[ ! -f "$SETTINGS" ]]; then
  echo "error: $SETTINGS not found" >&2
  exit 1
fi

usage() { echo "usage: $0 {off|on|status}" >&2; exit 1; }
[[ $# -eq 1 ]] || usage

case "$1" in
  off)
    if [[ -f "$BACKUP" ]]; then
      echo "already off (backup exists at $BACKUP); run 'on' to restore, or delete the backup to re-run 'off'" >&2
      exit 1
    fi
    jq '.hooks // {}' "$SETTINGS" > "$BACKUP"
    tmp=$(mktemp)
    jq '.hooks = {}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "rtk hook disabled. Run git commands directly now."
    echo "Run '$0 on' when done to restore it."
    ;;
  on)
    if [[ ! -f "$BACKUP" ]]; then
      echo "no backup found at $BACKUP -- nothing to restore" >&2
      exit 1
    fi
    tmp=$(mktemp)
    jq --slurpfile hooks "$BACKUP" '.hooks = $hooks[0]' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    rm -f "$BACKUP"
    echo "rtk hook restored."
    ;;
  status)
    if [[ -f "$BACKUP" ]]; then
      echo "disabled (backup present, saved hooks below)"
      cat "$BACKUP"
    else
      echo "active:"
      jq '.hooks // {}' "$SETTINGS"
    fi
    ;;
  *)
    usage
    ;;
esac
