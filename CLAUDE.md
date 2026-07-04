# Nepal Grocery POS

A browser-based Point of Sale system for a family grocery store in Kathmandu, Nepal.
Hosted in a Docker container on uk-homeserver (Raspberry Pi 4 8GB) in Parramatta, Sydney.
Accessed from Nepal via Tailscale in Chrome on a Lenovo Chromebook Duet (touchscreen, rear camera).
Owner: Utsav (Sydney). Users: non-technical family members in the shop.
The shop-facing display name shown in the UI is "Khatiwada Store"; "Nepal Grocery POS" is the internal project/codename.

## Confirmed decisions — do NOT suggest alternatives to these

1. Stack: Python + Flask + SQLite + plain HTML/CSS/JavaScript. No other frameworks (no React, no FastAPI, no Postgres).
2. Hosting: Docker container on uk-homeserver alongside the existing media stack. Not a VPS, not cloud.
3. Remote access: Tailscale (already configured). Never suggest TeamViewer, AnyDesk, or port forwarding.
4. Reverse proxy: Caddy (already running). Tailnet name is `tailea48bb.ts.net` (MagicDNS + HTTPS Certificates already enabled in the Tailscale admin console). The Pi's device name in Tailscale is currently `UK-HOMESERVER`, giving it the address `uk-homeserver.tailea48bb.ts.net` — Utsav may rename the device to `pos` before generating the cert, which would make the address `pos.tailea48bb.ts.net` instead (cleaner for parents to type/bookmark). Whichever name is used, run `sudo tailscale cert <device>.tailea48bb.ts.net` ON THE PI to obtain a real Let's Encrypt-backed cert/key pair (works on iPhone, no browser warnings). Caddy must be configured to serve that cert/key for that domain — Caddy's own automatic HTTPS won't work for a private Tailscale-only name, so point it at the files `tailscale cert` produces. Certs expire (Let's Encrypt, ~90 days) and need periodic renewal via a cron job re-running `tailscale cert` and reloading Caddy. Do NOT use a plain custom hostname like `pos.home` — Tailscale can only issue certificates for real MagicDNS names under the tailnet domain. DEPLOYED REALITY: the app is live at `https://uk-homeserver.tailea48bb.ts.net:8443` — a second Caddy site block on port 8443 for the same hostname, reusing the same cert (certs are hostname-scoped, not port-scoped), because Jellyfin already occupies :443 on this host. The container publishes host port 5050; Caddy proxies 8443 → localhost:5050.
5. Database: SQLite files stored at `/data/nepal-pos/` on the Pi's HDD, mounted into the container at `/app/data`.
6. Client: browser only, no app installation, no Electron, no PWA install requirement. Must run well on the Lenovo Chromebook Duet (primary, touchscreen) AND on iPhone 13 / iPhone 13 Pro Max (parents' secondary devices, Safari). UI must be responsive — large touch targets that work at both Chromebook and iPhone screen sizes.
7. Barcode scanning: browser camera API (e.g. html5-qrcode or native BarcodeDetector with fallback), designed to work across Chromebook (ChromeOS Chrome), Android Chrome, and iPhone Safari/Chrome (all iOS browsers use WebKit, so the same rules apply regardless of which browser app is used). IMPORTANT: iOS only allows camera access (getUserMedia) over a secure context (HTTPS). This means the app must be served over HTTPS via its Tailscale MagicDNS name, not plain HTTP — see decision 4 for the exact domain and cert process. This is a hard requirement for camera scanning to work on the iPhones, not optional polish. On devices with more than one camera, the scanner overlay shows a front/rear switch control (defaults to the rear/`environment` camera, remembers the choice for the session); single-camera devices don't show it.
8. Currency: Rs. (Nepali Rupee, NPR). Format all money as `Rs. 1,250.00`.
9. Weighed items sold per kg: multiple varieties are expected (e.g. several kinds of Rice, several kinds of Dal/Lentils), not just one product per category. Quick-tap buttons are by CATEGORY (Rice, Dal, Sugar, Flour), not by a single fixed product. Tapping a category button shows a short list of that category's active products from the database (populated dynamically — grows as new varieties are added via admin or Quick Add), staff pick the specific variety, then the weight number pad opens.
10. No receipt printer — display the total on screen only.
11. No payment integration — customers pay cash or QR; staff confirm manually. NEW SALE shows a confirmation step ("Confirm sale of Rs. X?") before it saves the transaction and clears the bill, to guard against accidental taps finalizing a wrong sale. A separate "Clear Bill" button empties the running bill in one tap without saving (individual line items can still be removed one at a time as before).
12. Price override at sale time: each line item in the running bill can have its price edited for that sale only (e.g. discounts, damaged goods) without changing the product's stored price. No approval/permission gate in v1 — any staff member can do this.
13. Quick Add auto-opens automatically the moment a barcode scan returns "not found" — staff should not have to notice the failure and manually open the form. Quick Add must support creating a new WEIGHED variety on the spot (not just fixed-price items) — staff need to be able to mark the new item as weighed, pick its category (Rice/Dal/Sugar/Flour/Other), and set its per-kg price, so a brand new rice or dal variety scanned or typed in at the till immediately becomes a proper weighed product and shows up under the correct category button next time, without needing admin access. Barcode is optional either way (blank if none).
14. Offline limitation accepted for v1: if the Sydney server or internet is down, the shop reverts to pen and paper. Do not build offline sync in v1.
15. Bilingual UI (English/Nepali): the cashier screen has a language toggle that translates interface chrome ONLY — buttons, labels, headings, prompts, statuses, and toasts, plus display-only Nepali labels for the five fixed weighed-group buttons (Rice→चामल, Dal→दाल, Sugar→चिनी, Flour→पीठो, Other→अन्य). Product names and all stored data are NEVER translated; money keeps the `Rs. 1,250.00` format in both languages (decision 8); numerals stay Western digits. The choice persists per device via localStorage (`pos_lang`). Translations live in a plain JS dictionary in `static/i18n.js` — no framework, no server round-trip, no backend involvement. The admin panel stays English-only (it's Utsav's screen).
16. Cashier header shows the current date in the Bikram Sambat (Nepali) calendar plus the current Kathmandu time in 12-hour format, ticking live (e.g. English `Saturday, 2083 Asar 20 · 2:45 PM`; Nepali `शनिबार, २०८३ असार २० · २:४५ PM` with Devanagari digits, respecting the decision-15 toggle). The cashier header itself is display-only and frontend-only (`static/nepali-date.js`) — no backend. BS conversion uses an embedded month-length table (authoritative medic/bikram-sambat data) anchored at BS 2081-01-01 = 2024-04-13 AD, covering BS 2078–2090 (AD ~2021–2033); the table must be extended before ~2033 or the header falls back to time-only. This is presentation only: sales still store Gregorian ISO dates at Kathmandu time (convention 3) — BS is never persisted. The admin sales reports also present BS dates (in English script, since the admin panel stays English per decision 15) using the same conversion via a Python port, `nepali_date.py`, which must be kept in sync with the JS table.

## Project structure

- `app.py` — all Flask routes
- `db.py` — database helpers (connections, queries, schema init)
- `nepali_date.py` — Bikram Sambat calendar conversion for the admin sales reports (Python port of `static/nepali-date.js`; keep the two tables/anchor in sync)
- `templates/` — Jinja2 HTML templates
- `static/` — CSS, JavaScript, barcode scanner code
- `Dockerfile` and `docker-compose.yml` — container config (port mapping 5050:5000, volume `/data/nepal-pos:/app/data`)
- Database files: `store.db` (products) and `sales.db` (sales + sale_items), created in `data/` locally, `/app/data` in the container

## Database schema

products (store.db):
id INTEGER PK, barcode TEXT nullable, name TEXT, category TEXT (grocery/weighed/lpg/stationery/cosmetics/other), price REAL, is_weighed BOOLEAN, unit TEXT (kg/piece/packet/bottle), active BOOLEAN (soft delete)

The `category` column is NOT constrained by a DB CHECK — the allowed list lives in app code (`CATEGORIES` in `app.py`), so new categories (cosmetics was added this way) need only a code-list change, no schema migration. Both the admin add/edit form and the Quick Add form (for fixed-price items) expose the category picker.

sales (sales.db):
sale_id INTEGER PK, date TEXT (ISO), time TEXT (HH:MM:SS), total REAL, item_count INTEGER

sale_items (sales.db):
item_id INTEGER PK, sale_id INTEGER FK, product_name TEXT (snapshot at time of sale), quantity REAL, unit_price REAL, line_total REAL

settings (store.db):
key TEXT PK, value TEXT — small key/value table; currently holds the hashed admin password under key `admin_password_hash`

## Features

Cashier screen (the only daily screen — big buttons, dead simple, touch-friendly):
1. Barcode scan via camera
2. Instant search-as-you-type by product name
3. Quick-tap category buttons (Rice/Dal/Sugar/Flour, plus Other when non-empty) → variety picker → weight number pad → line total
4. LPG one-tap button
5. Running bill with line totals in Rs.
6. Quick Add: when a barcode is not found or an item has no barcode, add name + price on the spot — saves to database AND adds to the current bill
7. NEW SALE button — shows a confirmation prompt, then saves the transaction and clears the bill
8. Clear Bill button — empties the current bill in one tap without saving
9. Language toggle (English ↔ नेपाली) — chrome only, persists per device (see decision 15)
10. Header shows today's Bikram Sambat date + live 12-hour Kathmandu time (see decision 16)

Admin panel (password protected):
Authentication is set up on first use, not via an environment variable. On the
first visit to `/admin` with no password stored, a one-time "Set Admin Password"
screen appears (password + confirm, minimum 8 characters); the password is
hashed with werkzeug's `generate_password_hash` and stored in the `settings`
table — never in plain text and never in the environment. After that, `/admin`
shows a normal login form checked against the stored hash. A logged-in admin can
change the password from inside the panel (must enter the current password),
so it can be updated without SSH/Pi access. `SECRET_KEY` is still an env var
(Flask session signing); only the admin password moved into the database.
1. Add / edit / deactivate products (soft delete via `active` flag)
2. View all products, searchable, filterable by category
3. Sales reports: daily, weekly, and monthly (Gregorian) totals, plus Bikram Sambat dates — a BS date column on the daily report and a monthly-by-BS-month breakdown, shown in English script (`nepali_date.py`)
4. Export sales to CSV
5. Bulk product import via CSV
6. Change admin password (requires the current password)

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
7. Caddy route serving the app over HTTPS at its Tailscale MagicDNS name, using a real cert from `tailscale cert` (required for iPhone camera access — see decision 4 and 7 above)
8. End-to-end test via Tailscale on Chromebook, at least one Android device if available, and both parents' iPhones (camera scanning + general usability)

Always check this file before making architectural choices. If a request conflicts with a confirmed decision above, flag it instead of silently changing the approach.
