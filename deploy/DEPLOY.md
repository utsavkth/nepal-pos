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

Edit `.env` and set `ADMIN_PASSWORD` to a strong password and `SECRET_KEY` to
the generated value. `.env` is gitignored — it never leaves the Pi.

## 3. Build and start the container

```bash
sudo mkdir -p /data/nepal-pos          # HDD path for the SQLite databases
docker compose up -d --build
docker compose logs -f                 # watch it start, Ctrl-C to stop tailing
```

Verify it's serving locally on the Pi:

```bash
curl -s http://localhost:5050/ | head    # should return the cashier HTML
```

The databases are created empty in `/data/nepal-pos/` on first run. You'll
populate real products by scanning at the till once HTTPS is live (step 7). To
load the sample test products instead, run:
`docker compose exec pos python seed.py`.

## 4. (Optional) Rename the Tailscale device

If you want the shorter `pos.tailea48bb.ts.net`, rename the device in the
Tailscale admin console now, before issuing the cert.

## 5. Issue the HTTPS certificate

`tailscale cert` must run on the Pi (the node that owns the name). It writes a
real Let's Encrypt cert that iPhones trust with no browser warning.

Write it into the **host** directory that is already bind-mounted into your
Caddy container at `/etc/caddy/certs` — i.e. the source side of your
`-v .../Docker-Data/caddy-certs:/etc/caddy/certs` mount. Replace
`/PATH/TO/Docker-Data/caddy-certs` with that real host path:

```bash
sudo tailscale cert \
  --cert-file /PATH/TO/Docker-Data/caddy-certs/uk-homeserver.crt \
  --key-file  /PATH/TO/Docker-Data/caddy-certs/uk-homeserver.key \
  uk-homeserver.tailea48bb.ts.net
```

Caddy then reads those same two files from *inside* the container at
`/etc/caddy/certs/uk-homeserver.crt` and `.key` (that's what the Caddyfile
references in step 6 — a container path, not a host path).

If this errors, confirm HTTPS Certificates are enabled in the Tailscale admin
console and that `tailscale status` shows the Pi online.

## 6. Point Caddy at the app

Your Caddy is a **host-networked container**, so it reaches the POS container
through the host's published port `5050`, and it already has the cert directory
mounted. Append the block from [`Caddyfile.snippet`](Caddyfile.snippet) to your
Caddyfile (the file bind-mounted at `/etc/caddy/Caddyfile`):

```
uk-homeserver.tailea48bb.ts.net {
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

Open `https://uk-homeserver.tailea48bb.ts.net/` on:

1. The **Chromebook** (primary) — check the padlock shows a valid cert, the
   cashier screen loads, and tapping **SCAN** prompts for camera permission and
   opens the camera. Scan a product barcode; the first time it opens Quick Add,
   after saving it goes straight onto the bill next scan.
2. Both **iPhones** (Safari) — same checks. Camera scanning only works because
   of the valid HTTPS cert; if the camera is blocked, re-check step 5/6.
3. An **Android** device if available.

Then walk through a full sale: scan/weigh a few items, use a price override,
and press NEW SALE. Check the sale in `/admin` → Reports.

## 8. Schedule certificate renewal

Certs expire ~90 days out. Edit [`renew-cert.sh`](renew-cert.sh) and set
`CERT_DIR` to the same host `caddy-certs` path you used in step 5 (its `DOMAIN`,
`CERT_NAME`, and the `docker exec caddy` reload are already set for this setup).
Then install it and a monthly cron job:

```bash
chmod +x /opt/nepal-pos/deploy/renew-cert.sh
sudo /opt/nepal-pos/deploy/renew-cert.sh       # run once to confirm it works
sudo crontab -e
```

Add:

```
15 3 1 * * /opt/nepal-pos/deploy/renew-cert.sh >> /var/log/nepal-pos-cert.log 2>&1
```

---

## Everyday operations

- **Update the app:** `cd /opt/nepal-pos && git pull && docker compose up -d --build`
- **Restart:** `docker compose restart`
- **Logs:** `docker compose logs -f`
- **Back up the data:** copy `/data/nepal-pos/store.db` and
  `/data/nepal-pos/sales.db` somewhere safe (they're plain SQLite files).
- **Change the admin password:** edit `.env`, then `docker compose up -d`.
