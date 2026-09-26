#!/bin/sh
# Sonarly entrypoint — PUID/PGID privilege-drop pattern: the alpine base has
# no pre-created application user, so one is created (or re-created at the
# requested ids) on every start.
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
APP_USER=sonarly

CURRENT_PUID=$(id -u "$APP_USER" 2>/dev/null || echo "")
CURRENT_PGID=$(id -g "$APP_USER" 2>/dev/null || echo "")

if [ "$PUID" != "$CURRENT_PUID" ] || [ "$PGID" != "$CURRENT_PGID" ]; then
  echo "Adjusting $APP_USER user/group to UID=$PUID GID=$PGID"
  deluser "$APP_USER" 2>/dev/null || true
  delgroup "$APP_USER" 2>/dev/null || true

  # Re-use an existing group with the requested GID; create one if it does not exist.
  if existing_group=$(getent group "$PGID" | cut -d: -f1) && [ -n "$existing_group" ]; then
    group_name="$existing_group"
  else
    addgroup -g "$PGID" "$APP_USER"
    group_name="$APP_USER"
  fi

  adduser -u "$PUID" -G "$group_name" -h "/home/$APP_USER" -s /bin/sh -D "$APP_USER"
else
  echo "$APP_USER user/group already matches PUID=$PUID PGID=$PGID"
fi

# Ensure data directories exist and are writable by the runtime user.
mkdir -p /data/db /data/ingest
chown -R "$PUID:$PGID" /data

echo "Starting Sonarly as $APP_USER (UID=$(id -u "$APP_USER"), GID=$(id -g "$APP_USER"))"
exec su-exec "$APP_USER" /app/sonarly
