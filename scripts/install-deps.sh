#!/usr/bin/env bash
# Install system dependencies for running the super-collage test suite.
# Run interactively:  sudo ./scripts/install-deps.sh
#
# Installs the fonts Playwright Chromium expects (missing on Ubuntu 26.04's
# GNOME desktop) plus xvfb/xauth. pdftoppm (poppler-utils) is required for
# scripts/test-color-separation.cjs but is usually already installed.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run with sudo. Try:" >&2
  echo "  sudo $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  fonts-freefont-ttf \
  fonts-ipafont-gothic \
  fonts-tlwg-loma-otf \
  fonts-unifont \
  fonts-wqy-zenhei \
  xfonts-cyrillic \
  xfonts-scalable \
  xauth \
  xvfb

fc-cache -f

echo
echo "Done. Missing dependencies installed. Re-run tests with:"
echo "  ./scripts/test-e2e.sh"
