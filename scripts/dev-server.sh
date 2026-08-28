#!/usr/bin/env bash
# Start/stop/status/logs for a persistent `next dev` process, detached from
# whatever terminal or Claude Code session invoked it. Tracks the server via
# a PID file (not just the port) so `dev:stop` never kills a process it
# didn't start.
set -euo pipefail

PORT=3100
STATE_DIR=".dev-server"
PID_FILE="$STATE_DIR/dev.pid"
LOG_FILE="$STATE_DIR/dev.log"

cd "$(dirname "$0")/.."   # always operate from repo root

is_our_pid() {
  # True only if $1 is alive AND looks like our dev server, guarding against
  # the (rare) case where the OS has since reissued that PID to something else.
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -qE "next dev|pnpm.*dev"
}

port_pid() {
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -n1 || true
}

tracked_pid() {
  [ -f "$PID_FILE" ] && cat "$PID_FILE" || true
}

cmd_status() {
  local pid; pid="$(tracked_pid)"
  if [ -n "$pid" ] && is_our_pid "$pid"; then
    echo "RUNNING (pid $pid, http://127.0.0.1:$PORT, log: $LOG_FILE)"
    return 0
  fi
  local listener; listener="$(port_pid)"
  if [ -n "$listener" ]; then
    echo "PORT $PORT in use by untracked pid $listener (not started by this script)"
    return 2
  fi
  echo "STOPPED"
  return 1
}

cmd_start() {
  mkdir -p "$STATE_DIR"

  local pid; pid="$(tracked_pid)"
  if [ -n "$pid" ] && is_our_pid "$pid"; then
    echo "Already running (pid $pid) — reusing it. Logs: pnpm dev:logs"
    return 0
  fi
  [ -n "$pid" ] && rm -f "$PID_FILE"   # stale pid file from a crash/kill -9

  local listener; listener="$(port_pid)"
  if [ -n "$listener" ]; then
    echo "Port $PORT is already in use by pid $listener, which this script didn't start." >&2
    echo "Reuse it directly, or stop it manually if it's stale (kill $listener)." >&2
    exit 1
  fi

  echo "Starting dev server (detached, logging to $LOG_FILE)..."
  : > "$LOG_FILE"   # fresh log per real start
  nohup pnpm dev > "$LOG_FILE" 2>&1 &
  local new_pid=$!
  disown "$new_pid" 2>/dev/null || true
  echo "$new_pid" > "$PID_FILE"

  for _ in $(seq 1 60); do
    curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" 2>/dev/null \
      | grep -qE "^[23]" && { echo "Ready (pid $new_pid)."; return 0; }
    is_our_pid "$new_pid" || { echo "Dev server exited immediately — check $LOG_FILE" >&2; exit 1; }
    sleep 1
  done
  echo "Still not answering after 60s (pid $new_pid still alive) — check $LOG_FILE" >&2
  exit 1
}

cmd_stop() {
  local pid; pid="$(tracked_pid)"
  if [ -z "$pid" ] || ! is_our_pid "$pid"; then
    echo "Not running (no tracked pid)."
    rm -f "$PID_FILE"
    local listener; listener="$(port_pid)"
    [ -n "$listener" ] && echo "Note: pid $listener is listening on $PORT but wasn't started by this script — leaving it alone."
    return 0
  fi
  echo "Stopping pid $pid..."
  kill "$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true   # pnpm's own child (next dev), best-effort
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null && { kill -9 "$pid" 2>/dev/null || true; pkill -KILL -P "$pid" 2>/dev/null || true; }
  rm -f "$PID_FILE"
  echo "Stopped."
}

cmd_logs() {
  mkdir -p "$STATE_DIR"; touch "$LOG_FILE"
  tail -n 50 -f "$LOG_FILE"
}

case "${1:-}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  logs)   cmd_logs ;;
  *) echo "Usage: $0 {start|stop|status|logs}" >&2; exit 1 ;;
esac
