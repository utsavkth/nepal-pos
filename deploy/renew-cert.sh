#!/usr/bin/env bash
# Refresh the Tailscale-issued TLS certificate for the POS domain and reload
# Caddy so it picks up the new files. Run ON THE PI as root, via cron.
#
# Let's Encrypt certs from `tailscale cert` last ~90 days; running this monthly
# gives several renewal attempts before any expiry. See deploy/DEPLOY.md.
set -euo pipefail

# ---- configure these for your setup ----------------------------------------
DOMAIN="uk-homeserver.tailea48bb.ts.net"   # or pos.tailea48bb.ts.net if renamed
CERT_DIR="/etc/caddy/certs"

# How to reload Caddy after refreshing the cert. Uncomment the ONE that matches:
CADDY_RELOAD=(systemctl reload caddy)                                   # host service
# CADDY_RELOAD=(docker exec caddy caddy reload --config /etc/caddy/Caddyfile)  # container
# ---------------------------------------------------------------------------

mkdir -p "$CERT_DIR"

# tailscale cert re-issues only when the cert is near expiry, so this is safe
# to run on a schedule. Must run on the node that owns the MagicDNS name.
tailscale cert \
  --cert-file "$CERT_DIR/$DOMAIN.crt" \
  --key-file  "$CERT_DIR/$DOMAIN.key" \
  "$DOMAIN"

# Caddy must be able to read the files. Tighten (e.g. chown to the caddy user)
# if your Caddy runs as a dedicated non-root user.
chmod 644 "$CERT_DIR/$DOMAIN.crt" "$CERT_DIR/$DOMAIN.key"

"${CADDY_RELOAD[@]}"
echo "$(date -Is) renewed cert for $DOMAIN and reloaded Caddy"
