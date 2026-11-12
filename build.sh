#!/bin/sh
# Rebuild index.html from src/.  Use "./build.sh --data" to regenerate src/data.js first
# (add --fetch to also refresh the offline snapshot from the live tracking sheet).
set -e
cd "$(dirname "$0")"
if [ "$1" = "--data" ]; then shift; python3 tools/build_data.py "$@"; fi
python3 build.py
