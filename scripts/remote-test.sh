#!/usr/bin/env bash
# Run super-collage tests on the inference server (lnsy@inference-server).
# Usage:
#   scripts/remote-test.sh [--branch BRANCH] [--no-install] [--build-wasm] [--unit] [--e2e] [--full-e2e] [--project chromium] [--] [extra playwright args]
#
# Pattern: work on a branch, push it, then on the remote server pull/check out that branch and run tests.
#   git checkout -b my-branch
#   git commit ...
#   git push -u origin my-branch
#   ssh lnsy@inference-server "cd /home/lnsy/Code/super-collage && scripts/remote-test.sh --branch my-branch --e2e"
#
# Or run directly on the remote server in the repo.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BRANCH=""
DO_INSTALL=1
BUILD_WASM=0
RUN_UNIT=0
RUN_E2E=0
FULL_E2E=0
PW_PROJECT="chromium"
PW_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    --build-wasm) BUILD_WASM=1; shift ;;
    --unit) RUN_UNIT=1; shift ;;
    --e2e) RUN_E2E=1; shift ;;
    --full-e2e) FULL_E2E=1; RUN_E2E=1; shift ;;
    --project) PW_PROJECT="$2"; shift 2 ;;
    --) shift; PW_ARGS+=("$@"); break ;;
    *) PW_ARGS+=("$1"); shift ;;
  esac
done

# Default: run unit + e2e smoke if nothing specified
if [[ $RUN_UNIT -eq 0 && $RUN_E2E -eq 0 ]]; then
  RUN_UNIT=1
  RUN_E2E=1
fi

# Load toolchains (nvm, cargo/rustup)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

echo "== remote-test: $(hostname) =="
echo "repo: $REPO_DIR"
echo "node: $(node -v 2>/dev/null || echo missing)"
echo "npm:  $(npm -v 2>/dev/null || echo missing)"
echo "rustc: $(rustc -V 2>/dev/null || echo missing)"
echo "wasm-pack: $(wasm-pack -V 2>/dev/null || echo missing)"

if [[ -n "$BRANCH" ]]; then
  echo "== syncing branch: $BRANCH =="
  git fetch origin --prune
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH" 2>/dev/null || git pull origin "$BRANCH"
fi

echo "== commit: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s) =="
git status -sb || true

if [[ $DO_INSTALL -eq 1 ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

if [[ $BUILD_WASM -eq 1 ]]; then
  echo "== building wasm =="
  npm run build:wasm
fi

if [[ $RUN_UNIT -eq 1 ]]; then
  echo "== unit tests =="
  node --test src/app/imposition.test.js src/app/grid-snap.test.js src/app/tiles.test.js
fi

if [[ $RUN_E2E -eq 1 ]]; then
  echo "== e2e tests (project=$PW_PROJECT) =="
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  if [[ $FULL_E2E -eq 1 ]]; then
    # Pagination export is intentionally slow (multi-sheet plate rendering)
    # and disables its own timeout, so run every other spec first and leave it
    # for the very end.
    shopt -s nullglob
    specs=()
    for spec in e2e/*.spec.js; do
      [[ "$spec" == "e2e/export-pagination.spec.js" ]] && continue
      specs+=("$spec")
    done
    npx playwright test "${specs[@]}" --project="$PW_PROJECT" --reporter=line "${PW_ARGS[@]}"
    echo "== long-running pagination export tests =="
    npx playwright test e2e/export-pagination.spec.js --project="$PW_PROJECT" --reporter=line "${PW_ARGS[@]}"
  else
    if [[ ${#PW_ARGS[@]} -eq 0 ]]; then
      npx playwright test e2e/app-shell.spec.js --project="$PW_PROJECT" --reporter=line
    else
      npx playwright test --project="$PW_PROJECT" --reporter=line "${PW_ARGS[@]}"
    fi
  fi
fi

echo "== done =="
