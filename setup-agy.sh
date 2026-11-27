#!/usr/bin/env sh
# setup-agy.sh — Backward-compatible wrapper forwarding to setup.sh (agy-base v3.0.0+).
exec sh "$(dirname "$0")/setup.sh" "$@"
