#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

CURRENT_PUID=$(id -u node 2>/dev/null || echo "")
CURRENT_PGID=$(id -g node 2>/dev/null || echo "")

if [ "$PUID" != "$CURRENT_PUID" ] || [ "$PGID" != "$CURRENT_PGID" ]; then
  echo "Adjusting node user/group to UID=$PUID GID=$PGID"
  deluser node 2>/dev/null || true
  delgroup node 2>/dev/null || true

  # Re-use an existing group with the requested GID; create one if it does not exist.
  if existing_group=$(getent group "$PGID" | cut -d: -f1) && [ -n "$existing_group" ]; then
    group_name="$existing_group"
  else
    addgroup -g "$PGID" node
    group_name="node"
  fi

  adduser -u "$PUID" -G "$group_name" -h /home/node -s /bin/sh -D node
else
  echo "node user/group already matches PUID=$PUID PGID=$PGID"
fi

# Ensure data directories exist and are writable by the runtime user.
mkdir -p /data/library /data/ingest
chown -R "$PUID:$PGID" /data

echo "Starting Sonarly as node (UID=$(id -u node), GID=$(id -g node))"
exec su-exec node node dist/index.js
