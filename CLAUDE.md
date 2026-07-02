# Nepal Grocery POS

A browser-based Point of Sale system for a family grocery store in Kathmandu, Nepal.
Hosted in a Docker container on uk-homeserver (Raspberry Pi 4 8GB) in Parramatta, Sydney.
Accessed from Nepal via Tailscale in Chrome on a Lenovo Chromebook Duet (touchscreen, rear camera).
Owner: Utsav (Sydney). Users: non-technical family members in the shop.

## Confirmed decisions — do NOT suggest alternatives to these

1. Stack: Python + Flask + SQLite + plain HTML/CSS/JavaScript. No other frameworks (no React, no FastAPI, no Postgres).
2. Hosting: Docker container on uk-homeserver alongside the existing media stack. Not a VPS, not cloud.
3. Remote access: Tailscale (already configured). Never suggest TeamViewer, AnyDesk, or port forwarding.
4. Reverse proxy: Caddy (already running). Route: `pos.home` → Flask container. Config is appended to the existing Caddyfile.
5. Database: SQLite files stored at `/data/nepal-pos/` on the Pi's HDD, mounted into the container at `/app/data`.
6. Client: browser only on the Chromebook. No app installation, no Electron, no PWA install requirement.
7. Barcode scanning: browser camera API using the Chromebook rear camera (e.g. html5-qrcode or native BarcodeDetector with fallback).
8. Currency: Rs. (Nepali Rupee, NPR). Format all money as `Rs. 1,250.00`.
9. Weighed items sold per kg: Rice, Sugar, Flour, Lentils. These get quick-tap buttons plus a weight number pad.
10. No receipt printer — display the total on screen only.
11. No payment integration — customers pay cash or QR; staff confirm manually. NEW SALE saves the transaction and clears the bill.
12. Offline limitation accepted for v1: if the Sydney server or internet is down, the shop reverts to pen and paper. Do not build offline sync in v1.

## Project structure

- `app.py` — all Flask routes
- `db.py` — database helpers (connections, queries, schema init)
- `templates/` — Jinja2 HTML templates
- `static/` — CSS, JavaScript, barcode scanner code
- `Dockerfile` and `docker-compose.yml` — container config (port mapping 5050:5000, volume `/data/nepal-pos:/app/data`)
- Database files: `store.db` (products) and `sales.db` (sales + sale_items), created in `data/` locally, `/app/data` in the container

## Database schema

products (store.db):
id INTEGER PK, barcode TEXT nullable, name TEXT, category TEXT (grocery/weighed/lpg/stationery/other), price REAL, is_weighed BOOLEAN, unit TEXT (kg/piece/packet/bottle), active BOOLEAN (soft delete)

sales (sales.db):
sale_id INTEGER PK, date TEXT (ISO), time TEXT (HH:MM:SS), total REAL, item_count INTEGER

sale_items (sales.db):
item_id INTEGER PK, sale_id INTEGER FK, product_name TEXT (snapshot at time of sale), quantity REAL, unit_price REAL, line_total REAL

## Features

Cashier screen (the only daily screen — big buttons, dead simple, touch-friendly):
1. Barcode scan via camera
2. Instant search-as-you-type by product name
3. Quick-tap buttons for Rice, Sugar, Flour, Lentils → weight number pad → line total
4. LPG one-tap button
5. Running bill with line totals in Rs.
6. Quick Add: when a barcode is not found or an item has no barcode, add name + price on the spot — saves to database AND adds to the current bill
7. NEW SALE button — saves transaction, clears the bill

Admin panel (password protected):
1. Add / edit / deactivate products (soft delete via `active` flag)
2. View all products, searchable, filterable by category
3. Sales reports: daily, weekly, monthly totals
4. Export sales to CSV
5. Bulk product import via CSV

## Conventions

1. Keep dependencies minimal — Flask and the standard library where possible
2. UI must be usable by non-technical users: large touch targets, high contrast, minimal text
3. Timezone for sales timestamps: Asia/Kathmandu (the shop's local time), not the server's Sydney time
4. Prices and weights use REAL; quantity for weighed items is kg with up to 3 decimals
5. Never use bullet points with dashes in generated docs — use numbered lists or plain bullets

## Build phases (work in this order)

1. Flask app + SQLite backend, schema init, seed script with test products — test locally
2. Cashier UI: scan, search, weighed items, running bill, quick add, new sale
3. Admin panel: products CRUD, reports, CSV export/import
4. Full local testing of all scenarios
5. Load the real product database
6. Dockerise (Dockerfile + compose entry, port 5050:5000, volume mount)
7. Caddy route for pos.home
8. End-to-end test via Tailscale

Always check this file before making architectural choices. If a request conflicts with a confirmed decision above, flag it instead of silently changing the approach.
