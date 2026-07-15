# Deploying Nepal Grocery POS on the Pi

This runbook covers phases 6–8: running the container, serving it over HTTPS at
its Tailscale MagicDNS name, and testing on the shop's devices. Run every
command **on the Pi** unless stated otherwise.

Prerequisites (already true per CLAUDE.md): Docker + docker compose installed,
Caddy already running as the reverse proxy, Tailscale up with MagicDNS and
HTTPS Certificates enabled in the admin console.

Throughout, the domain is written as `uk-homeserver.tailea48bb.ts.net`. If you
rename the Pi's Tailscale device to `pos` first (cleaner for parents to type),
use `pos.tailea48bb.ts.net` everywhere instead — decide this **before** issuing
the cert in step 5.

---

## 1. Get the code onto the Pi

```bash
sudo mkdir -p /opt/nepal-pos
sudo chown "$USER" /opt/nepal-pos
git clone <your-repo-url> /opt/nepal-pos
cd /opt/nepal-pos
```

(Later updates: `cd /opt/nepal-pos && git pull`.)

## 2. Create the secrets file

```bash
cp .env.example .env
# generate a strong session key:
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32))"
```

Edit `.env` and set `SECRET_KEY` to the generated value. `.env` is gitignored —
it never leaves the Pi. There is no admin password here: you set it on the first
visit to `/admin` (step 7) and can change it later from inside the panel.

## 3. Build and start the container

```bash
# HDD path for the SQLite databases (matches the volume in docker-compose.yml)
sudo mkdir -p /srv/dev-disk-by-uuid-d83cca89-bc12-4315-a166-686c581461cf/Docker-Data/nepal-pos
docker compose up -d --build
docker compose logs -f                 # watch it start, Ctrl-C to stop tailing
```

The container publishes host port `5050` (Caddy proxies to it). Confirm that
port and the HTTPS port `8443` used in step 6 are both free first:
`sudo docker ps --format '{{.Names}} {{.Ports}}' | grep -E '5050|8443'` should
print nothing. If either is taken, change it in `docker-compose.yml` (host port)
and/or `deploy/Caddyfile.snippet`, and use the matching numbers below.

Verify it's serving locally on the Pi:

```bash
curl -s http://localhost:5050/ | head    # should return the cashier HTML
```

The databases are created empty on the HDD on first run. You'll populate real
products by scanning at the till once HTTPS is live (step 7). To load the sample
test products instead, run: `docker compose exec pos python seed.py`.

## 4. (Optional) Rename the Tailscale device

If you want the shorter `pos.tailea48bb.ts.net`, rename the device in the
Tailscale admin console now, before issuing the cert.

## 5. Issue the HTTPS certificate

`tailscale cert` must run on the Pi (the node that owns the name). It writes a
real Let's Encrypt cert that iPhones trust with no browser warning.

Write it into the **host** directory that is already bind-mounted into your
Caddy container at `/etc/caddy/certs` — i.e. the source side of your
`-v .../Docker-Data/caddy-certs:/etc/caddy/certs` mount:

```bash
sudo tailscale cert \
  --cert-file /srv/dev-disk-by-uuid-d83cca89-bc12-4315-a166-686c581461cf/Docker-Data/caddy-certs/uk-homeserver.crt \
  --key-file  /srv/dev-disk-by-uuid-d83cca89-bc12-4315-a166-686c581461cf/Docker-Data/caddy-certs/uk-homeserver.key \
  uk-homeserver.tailea48bb.ts.net
```

Caddy then reads those same two files from *inside* the container at
`/etc/caddy/certs/uk-homeserver.crt` and `.key` (that's what the Caddyfile
references in step 6 — a container path, not a host path).

If this errors, confirm HTTPS Certificates are enabled in the Tailscale admin
console and that `tailscale status` shows the Pi online.

## 6. Point Caddy at the app

POS is served on a **dedicated HTTPS port (8443)** so it doesn't disturb the
existing `uk-homeserver.tailea48bb.ts.net:443` site (Jellyfin) — same hostname,
same cert, different port. Your Caddy is a host-networked container, so it binds
host port 8443 directly, reaches the POS container through its published host
port `5050`, and already has the cert directory mounted. Append the block from
[`Caddyfile.snippet`](Caddyfile.snippet) to your Caddyfile (the file bind-mounted
at `/etc/caddy/Caddyfile`) — **do not modify the existing :443 Jellyfin block**:

```
uk-homeserver.tailea48bb.ts.net:8443 {
    tls /etc/caddy/certs/uk-homeserver.crt /etc/caddy/certs/uk-homeserver.key
    reverse_proxy localhost:5050
}
```

Note the `tls` paths are **container** paths (`/etc/caddy/certs/...`), which map
to the host `caddy-certs` directory you wrote the cert into in step 5.

Reload Caddy (the container is named `caddy`):

```bash
sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## 7. Test HTTPS from the shop devices

Open `https://uk-homeserver.tailea48bb.ts.net:8443/` (note the `:8443`) on:

1. The **Chromebook** (primary) — check the padlock shows a valid cert, the
   cashier screen loads, and tapping **SCAN** prompts for camera permission and
   opens the camera. Scan a product barcode; the first time it opens Quick Add,
   after saving it goes straight onto the bill next scan.
2. Both **iPhones** (Safari) — same checks. Camera scanning only works because
   of the valid HTTPS cert; if the camera is blocked, re-check step 5/6.
3. An **Android** device if available.

The **first** time you open `/admin`, you'll get a one-time "Set Admin Password"
screen — choose a strong password (min 8 characters); it's stored hashed in the
database. After that, `/admin` shows the normal login form.

Then walk through a full sale: scan/weigh a few items, use a price override,
and press NEW SALE. Check the sale in `/admin` → Reports.

## 8. Schedule certificate renewal

Certs expire ~90 days out. [`renew-cert.sh`](renew-cert.sh) is already filled in
for this Pi (`DOMAIN`, `CERT_DIR`, `CERT_NAME`, and the `docker exec caddy`
reload). Install it and a monthly cron job:

```bash
chmod +x /opt/nepal-pos/deploy/renew-cert.sh
sudo /opt/nepal-pos/deploy/renew-cert.sh       # run once to confirm it works
```

Use a dedicated `/etc/cron.d` file rather than `sudo crontab -e` — this Pi runs
OpenMediaVault, which manages part of root's crontab via Salt (look for a
`# Lines below here are managed by Salt, do not edit` marker in `sudo crontab
-l`); a manually-appended line risks being silently dropped if that state ever
regenerates. `/etc/cron.d` is untouched by that and matches every other system
cron job already on this Pi (`anacron`, `e2scrub_all`, `php`, etc. all live
there):

```bash
echo "15 3 1 * * root /opt/nepal-pos/deploy/renew-cert.sh >> /var/log/nepal-pos-cert.log 2>&1" | sudo tee /etc/cron.d/nepal-pos-cert-renew
sudo chmod 644 /etc/cron.d/nepal-pos-cert-renew
```

(`/etc/cron.d` entries need an explicit user field — `root` here, matching the
script's own "run as root" requirement — a per-user crontab line doesn't.)

---

## Everyday operations

- **Update the app:** `cd /opt/nepal-pos && git pull && docker compose up -d --build`
- **Restart:** `docker compose restart`
- **Logs:** `docker compose logs -f`
- **Back up the data:** copy `/data/nepal-pos/store.db` and
  `/data/nepal-pos/sales.db` somewhere safe (they're plain SQLite files).
- **Change the admin password:** log in to `/admin` and use **Change password**
  (no Pi access or restart needed).
