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
6. Client: browser only, no app installation, no Electron, no PWA install requirement. Must run well on the Lenovo Chromebook Duet (primary, touchscreen) AND on iPhone 13 / iPhone 13 Pro Max (parents' secondary devices, Safari). UI must be responsive — large touch targets that work at both Chromebook and iPhone screen sizes.
7. Barcode scanning: browser camera API (e.g. html5-qrcode or native BarcodeDetector with fallback), designed to work across Chromebook (ChromeOS Chrome), Android Chrome, and iPhone Safari. IMPORTANT: iOS Safari only allows camera access (getUserMedia) over a secure context (HTTPS). This means pos.home must be served over HTTPS via Tailscale, not plain HTTP — use `tailscale cert` to issue a certificate for pos.home and configure Caddy to serve it with TLS. This is a hard requirement for camera scanning to work on the iPhones, not optional polish.
8. Currency: Rs. (Nepali Rupee, NPR). Format all money as `Rs. 1,250.00`.
9. Weighed items sold per kg: multiple varieties are expected (e.g. several kinds of Rice, several kinds of Dal/Lentils), not just one product per category. Quick-tap buttons are by CATEGORY (Rice, Dal, Sugar, Flour), not by a single fixed product. Tapping a category button shows a short list of that category's active products from the database (populated dynamically — grows as new varieties are added via admin or Quick Add), staff pick the specific variety, then the weight number pad opens.
10. No receipt printer — display the total on screen only.
11. No payment integration — customers pay cash or QR; staff confirm manually. NEW SALE saves the transaction and clears the bill.
12. Price override at sale time: each line item in the running bill can have its price edited for that sale only (e.g. discounts, damaged goods) without changing the product's stored price. No approval/permission gate in v1 — any staff member can do this.
13. Quick Add auto-opens automatically the moment a barcode scan returns "not found" — staff should not have to notice the failure and manually open the form. Quick Add must support creating a new WEIGHED variety on the spot (not just fixed-price items) — staff need to be able to mark the new item as weighed, pick its category (Rice/Dal/Sugar/Flour/Other), and set its per-kg price, so a brand new rice or dal variety scanned or typed in at the till immediately becomes a proper weighed product and shows up under the correct category button next time, without needing admin access. Barcode is optional either way (blank if none).
14. Offline limitation accepted for v1: if the Sydney server or internet is down, the shop reverts to pen and paper. Do not build offline sync in v1.

## Project structure

- `app.py` — all Flask routes
- `db.py` — database helpers (connections, queries, schema init)
- `templates/` — Jinja2 HTML templates
- `static/` — CSS, JavaScript, barcode scanner code
- `Dockerfile` and `docker-compose.yml` — container config (port mapping 5050:5000, volume `/data/nepal-pos:/app/data`)
- Database files: `store.db` (products) and `sales.db` (sales + sale_items), created in `data/` locally, `/app/data` in the container

## Database schema

products (store.db):
id INTEGER PK, barcode TEXT nullable, name TEXT, category TEXT (grocery/weighed/lpg/stationery/other), price REAL, is_weighed BOOLEAN, unit TEXT (kg/piece/packet/bottle), active BOOLEAN (soft delete), weighed_group TEXT nullable (Rice/Dal/Sugar/Flour/Other — quick-tap button grouping for weighed items, NULL for non-weighed)

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

## Future phase — product images (not v1, do not build yet)

Once the skeleton (phases 1-8) is working, add product photos so parents
can visually identify items instead of relying only on name/category —
especially useful for weighed item varieties (different rice/dal types
can look similar in a list but very different in a photo).

Planned approach when this phase starts:
1. Add an `image_path` TEXT column (nullable) to the products table
2. Admin panel gets an image upload control on the add/edit product form
3. Images stored on the HDD alongside the databases (e.g.
   `/data/nepal-pos/images/`), not in the database itself — keep the
   database small and fast
4. Cashier screen and category variety-picker (see weighed items,
   decision 9) show the thumbnail next to each product name where
   available; products without an image just show text as they do now
5. Keep uploads small — resize/compress on upload so the Chromebook
   and iPhones load the cashier screen quickly over Tailscale

Flagging this now so the products table and file layout aren't designed
in a way that makes adding this later awkward — but this is explicitly
OUT OF SCOPE until the skeleton above is complete and tested.

## Build phases (work in this order)

1. Flask app + SQLite backend, schema init, seed script with test products — test locally
2. Cashier UI: scan, search, weighed items, running bill, quick add, new sale
3. Admin panel: products CRUD, reports, CSV export/import
4. Full local testing of all scenarios
5. Load the real product database
6. Dockerise (Dockerfile + compose entry, port 5050:5000, volume mount)
7. Caddy route for pos.home, served over HTTPS with a Tailscale-issued certificate (required for iPhone camera access — see decision 7 above)
8. End-to-end test via Tailscale on Chromebook, at least one Android device if available, and both parents' iPhones (camera scanning + general usability)

Always check this file before making architectural choices. If a request conflicts with a confirmed decision above, flag it instead of silently changing the approach.
