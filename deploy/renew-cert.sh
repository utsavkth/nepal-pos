#!/usr/bin/env bash
# Refresh the Tailscale-issued TLS certificate for the POS domain and reload
# Caddy so it picks up the new files. Run ON THE PI as root, via cron.
#
# Let's Encrypt certs from `tailscale cert` last ~90 days; running this monthly
# gives several renewal attempts before any expiry. See deploy/DEPLOY.md.
set -euo pipefail

# ---- configure for this Pi -------------------------------------------------
# Full MagicDNS name the cert is issued for (the Pi's Tailscale name):
DOMAIN="uk-homeserver.tailea48bb.ts.net"

# HOST directory that is bind-mounted into the Caddy container at
# /etc/caddy/certs (the source side of `-v .../caddy-certs:/etc/caddy/certs`).
# tailscale cert writes here; Caddy reads the same files from /etc/caddy/certs.
CERT_DIR="/srv/dev-disk-by-uuid-d83cca89-bc12-4315-a166-686c581461cf/Docker-Data/caddy-certs"

# Short cert/key filenames referenced by the Caddyfile tls directive:
CERT_NAME="uk-homeserver"
# ---------------------------------------------------------------------------

mkdir -p "$CERT_DIR"

# Re-issues only when the cert is near expiry, so this is safe to run on a
# schedule. Must run on the node that owns the MagicDNS name.
tailscale cert \
  --cert-file "$CERT_DIR/$CERT_NAME.crt" \
  --key-file  "$CERT_DIR/$CERT_NAME.key" \
  "$DOMAIN"

# Caddy must be able to read the files from inside its container.
chmod 644 "$CERT_DIR/$CERT_NAME.crt" "$CERT_DIR/$CERT_NAME.key"

# Caddy runs as a host-networked container named "caddy".
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

echo "$(date -Is) renewed cert for $DOMAIN and reloaded Caddy"
