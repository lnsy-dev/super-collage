#!/usr/bin/env bash
# Run the e2e suite on the physical desktop display from a remote SSH session.
#
# Usage:
#   ./scripts/test-e2e.sh              # chromium project only
#   ./scripts/test-e2e.sh --all        # both projects (like `npm run test:e2e`)
#   ./scripts/test-e2e.sh e2e/zoom.spec.js   # run a subset, extra args pass through
#
# GNOME runs Wayland with Xwayland on :0, and Xwayland keeps its own Xauthority
# cookie in /run/user/<uid>/.mutter-Xwaylandauth.* — both must be exported or
# Chromium fails with "The platform failed to initialize."
set -euo pipefail
cd "$(dirname "$0")/.."

uid=$(id -u)
DISPLAY=:0
authority_glob="/run/user/$uid/.mutter-Xwaylandauth.*"
authority=$(echo $authority_glob 2>/dev/null | head -1 || true)

if [[ -z "${authority:-}" ]]; then
  # Fall back to ssh-agent forwarded / classic X authority if present
  authority="${XAUTHORITY:-$HOME/.Xauthority}"
fi
if [[ ! -f "${authority}" ]]; then
  echo "ERROR: could not find an Xauthority file matching $authority_glob" >&2
  exit 1
fi

export DISPLAY="$DISPLAY"
export XAUTHORITY="$authority"

# ── Keep the desktop awake while tests run ──────────────────────────
# GNOME blanks the display after idle-delay (default 300s). With a blanked
# screen, mutter stops sending frame callbacks and headful Chromium's rAF
# stalls (~1 frame/8s), which hangs Playwright's click-stability checks.
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$uid/bus}"
restore_idle=""
prev_idle=$(gsettings get org.gnome.desktop.session idle-delay 2>/dev/null || true)
if [[ "$prev_idle" != "uint32 0" && -n "$prev_idle" ]]; then
  gsettings set org.gnome.desktop.session idle-delay 0 >/dev/null 2>&1
  restore_idle="$prev_idle"
  echo "Temporarily disabled screen blanking (was $prev_idle); restored on exit."
fi
restore() {
  if [[ -n "$restore_idle" ]]; then
    gsettings set org.gnome.desktop.session idle-delay "$restore_idle" >/dev/null 2>&1 || true
  fi
}
trap restore EXIT

# ── One suite at a time ─────────────────────────────────────────────
if pgrep -fa "playwright test" | grep -qv "$$"; then
  echo "A 'playwright test' run appears to be active already:" >&2
  pgrep -fa "playwright test" || true
  echo "Wait for it to finish before starting another." >&2
  exit 1
fi

# ── Long-running pagination export runs last ────────────────────────
# Every other spec is bounded by the global 30s timeout. The pagination
# export spec renders and samples many multi-sheet plates, so it is excluded
# from the main pass and run afterwards (the spec disables its own timeout).
shopt -s nullglob

explicit_selection=0
for arg in "$@"; do
  case "$arg" in
    *.spec.js|e2e|e2e/*|*/e2e/*) explicit_selection=1 ;;
  esac
done

if [[ "${1:-}" == "--all" ]]; then
  shift || true
fi

if [[ $explicit_selection -eq 1 ]]; then
  exec npx playwright test "$@"
fi

specs=()
for spec in e2e/*.spec.js; do
  [[ "$spec" == "e2e/export-pagination.spec.js" ]] && continue
  specs+=("$spec")
done
npx playwright test "${specs[@]}" "$@"
echo "== long-running pagination export tests =="
npx playwright test e2e/export-pagination.spec.js "$@"
