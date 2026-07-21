#!/bin/sh
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"
UMASK="${UMASK:-0000}"
APP_DATA="${APP_DATA:-/config}"
FILE_ROOT="${FILE_ROOT:-/data}"

mkdir -p "$APP_DATA" "$FILE_ROOT"
chown -R "$PUID:$PGID" "$APP_DATA"
umask "$UMASK"

exec su-exec "$PUID:$PGID" "$@"
