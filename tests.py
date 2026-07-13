"""Phase 4 — full local scenario tests for the Nepal Grocery POS.

Self-contained: no pytest, just the standard library and Flask's test client.
Runs against a throwaway database in a temp directory, so it never touches the
real data/ files or a running dev server.

    python tests.py
"""

import hashlib
import io
import os
import re
import sys
import tempfile

from datetime import date as _date

from PIL import Image
from werkzeug.security import check_password_hash

import nepali_date


def _png_bytes(color=(200, 30, 30), size=(600, 800)):
    """A real (oversized) PNG in memory, to exercise the upload/resize path."""
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()

# Windows consoles default to cp1252; keep the em-dashes/output readable.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# --- Isolate the database BEFORE importing the app -------------------------
# app.py calls db.init_db() at import time, so the DB paths must be set first.
# The admin password is no longer an env var — it's set via the first-run flow.
_TMP = tempfile.mkdtemp(prefix="nepalpos-test-")

import db  # noqa: E402

db.DATA_DIR = _TMP
db.STORE_DB_PATH = os.path.join(_TMP, "store.db")
db.SALES_DB_PATH = os.path.join(_TMP, "sales.db")

import app as app_module  # noqa: E402  (imports db, inits schema into _TMP)

app_module.app.config["TESTING"] = True

# --- Tiny assertion harness ------------------------------------------------
_passed = 0
_failed = 0


def check(label, condition, detail=""):
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  PASS  {label}")
    else:
        _failed += 1
        print(f"  FAIL  {label}" + (f"  — {detail}" if detail else ""))


def section(title):
    print(f"\n=== {title} ===")


# --- Known, deterministic seed data ----------------------------------------
SEED = [
    # barcode, name, category, price, is_weighed, unit, weighed_group
    ("1111111111111", "Test Noodles", "grocery", 25.0, 0, "packet", None),
    ("2222222222222", "Test Cola", "grocery", 70.0, 0, "bottle", None),
    (None, "Basmati Rice", "weighed", 250.0, 1, "kg", "Rice"),
    (None, "Mansuli Rice", "weighed", 95.0, 1, "kg", "Rice"),
    (None, "Musuro Dal", "weighed", 190.0, 1, "kg", "Dal"),
    (None, "Sugar", "weighed", 110.0, 1, "kg", "Sugar"),
    (None, "Flour", "weighed", 90.0, 1, "kg", "Flour"),
    (None, "LPG Refill", "lpg", 1900.0, 0, "piece", "LPG"),
    (None, "Pencil", "stationery", 10.0, 0, "piece", None),
]


def seed():
    conn = db.get_store_db()
    conn.execute("DELETE FROM products")
    conn.executemany(
        """INSERT INTO products (barcode, name, category, price, is_weighed, unit, weighed_group, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
        SEED,
    )
    conn.commit()
    conn.close()


ADMIN_PW = "test-pw-123"   # >= 8 chars
NEW_PW = "new-pass-456"    # >= 8 chars


def login(client):
    return client.post("/admin/login", data={"password": ADMIN_PW}, follow_redirects=False)


def run():
    client = app_module.app.test_client()
    seed()

    # ---------------------------------------------------------------
    section("Cashier — barcode lookup")
    r = client.get("/api/products/barcode/1111111111111")
    check("known barcode returns product", r.status_code == 200 and r.get_json()["name"] == "Test Noodles")
    r = client.get("/api/products/barcode/0000000000000")
    check("unknown barcode returns 404 (drives auto Quick Add)", r.status_code == 404)

    # ---------------------------------------------------------------
    section("Cashier — search by name and barcode")
    r = client.get("/api/products/search?q=cola")
    check("search by name (case-insensitive)", any(p["name"] == "Test Cola" for p in r.get_json()))
    r = client.get("/api/products/search?q=2222222222222")
    check("search by full barcode", any(p["name"] == "Test Cola" for p in r.get_json()))
    r = client.get("/api/products/search?q=1111")
    check("search by partial barcode", any(p["name"] == "Test Noodles" for p in r.get_json()))
    r = client.get("/api/products/search?q=")
    check("empty search returns nothing", r.get_json() == [])

    # ---------------------------------------------------------------
    section("Cashier — quick-tap grouping")
    data = client.get("/api/products/quick-taps").get_json()
    groups = {g["name"]: [p["name"] for p in g["products"]] for g in data["groups"]}
    check("Rice group has both rice varieties", set(groups.get("Rice", [])) == {"Basmati Rice", "Mansuli Rice"})
    check("Dal group has the dal", groups.get("Dal") == ["Musuro Dal"])
    check("Sugar and Flour present", groups.get("Sugar") == ["Sugar"] and groups.get("Flour") == ["Flour"])
    check("LPG is its own group", groups.get("LPG") == ["LPG Refill"])
    check("groups carry a type flag", all("is_weighed" in g for g in data["groups"]))

    # ---------------------------------------------------------------
    section("Cashier — Quick Add (fixed price)")
    r = client.post("/api/products/quick-add", json={"name": "Impulse Candy", "price": 5, "barcode": "9990001112223"})
    check("fixed quick-add returns 201", r.status_code == 201)
    prod = r.get_json()
    check("fixed quick-add is not weighed", prod["is_weighed"] == 0 and prod["category"] == "other")
    check("fixed quick-add persisted with barcode", db.get_product_by_barcode("9990001112223") is not None)

    section("Cashier — Quick Add (weighed variety)")
    r = client.post("/api/products/quick-add", json={
        "name": "Jeera Masino Rice", "price": 180, "is_weighed": True, "weighed_group": "Rice"})
    check("weighed quick-add returns 201", r.status_code == 201)
    prod = r.get_json()
    check("weighed quick-add is weighed/kg/group", prod["is_weighed"] == 1 and prod["unit"] == "kg" and prod["weighed_group"] == "Rice")
    data = client.get("/api/products/quick-taps").get_json()
    rice = next(g["products"] for g in data["groups"] if g["name"] == "Rice")
    check("new variety appears under Rice button", any(p["name"] == "Jeera Masino Rice" for p in rice))

    section("Cashier — Quick Add validation")
    check("missing name rejected", client.post("/api/products/quick-add", json={"price": 5}).status_code == 400)
    check("zero price rejected", client.post("/api/products/quick-add", json={"name": "X", "price": 0}).status_code == 400)
    check("bad weighed group rejected",
          client.post("/api/products/quick-add", json={"name": "Y", "price": 5, "is_weighed": True, "weighed_group": "Nope"}).status_code == 400)

    # ---------------------------------------------------------------
    section("Cashier — save sale, price override, timezone")
    r = client.post("/api/sales", json={"items": [
        {"product_name": "Test Noodles", "quantity": 2, "unit_price": 25},
        {"product_name": "Basmati Rice", "quantity": 1.5, "unit_price": 250},
    ]})
    check("sale saved returns 201", r.status_code == 201)
    sale = r.get_json()
    check("sale total = 2*25 + 1.5*250 = 425", sale["total"] == 425.0, str(sale))
    check("sale date is Kathmandu today", sale["date"] == db.datetime.now(db.SHOP_TZ).date().isoformat())

    # price override: sell noodles at 20 instead of stored 25
    before = db.get_product_by_barcode("1111111111111")["price"]
    r = client.post("/api/sales", json={"items": [
        {"product_name": "Test Noodles", "quantity": 1, "unit_price": 20},
    ]})
    after = db.get_product_by_barcode("1111111111111")["price"]
    saved_item = _last_sale_item()
    check("override recorded at overridden price", saved_item["unit_price"] == 20.0)
    check("override did NOT change stored product price", before == 25.0 and after == 25.0)

    section("Cashier — sale validation")
    check("empty items rejected", client.post("/api/sales", json={"items": []}).status_code == 400)
    check("missing fields rejected", client.post("/api/sales", json={"items": [{"product_name": "X"}]}).status_code == 400)
    check("negative quantity rejected",
          client.post("/api/sales", json={"items": [{"product_name": "X", "quantity": -1, "unit_price": 5}]}).status_code == 400)

    # ---------------------------------------------------------------
    section("Admin — first-run set-password + authentication")
    # With no password stored yet, everything funnels to the setup screen.
    check("no password yet: /admin -> setup",
          client.get("/admin").headers.get("Location", "").endswith("/admin/setup"))
    check("no password yet: /admin/login -> setup",
          client.get("/admin/login").headers.get("Location", "").endswith("/admin/setup"))
    check("setup screen shown", b"Set admin password" in client.get("/admin/setup").data)
    # setup validation
    check("setup rejects too-short password",
          b"at least 8" in client.post("/admin/setup", data={"password": "short", "confirm": "short"}).data)
    check("setup rejects mismatched confirm",
          b"do not match" in client.post("/admin/setup", data={"password": "longenough1", "confirm": "different1"}).data)
    check("no password stored after invalid attempts", not db.is_admin_password_set())
    # set it for real -> auto-login, stored hashed
    r = client.post("/admin/setup", data={"password": ADMIN_PW, "confirm": ADMIN_PW}, follow_redirects=False)
    check("valid setup redirects into panel", r.status_code == 302 and r.headers["Location"].endswith("/admin/products"))
    stored = db.get_admin_password_hash()
    check("password stored hashed, not plaintext",
          stored is not None and ADMIN_PW not in stored and check_password_hash(stored, ADMIN_PW))
    check("setup auto-logged-in", client.get("/admin/products").status_code == 200)
    check("setup can't reset once set (-> login)",
          client.get("/admin/setup").headers.get("Location", "").endswith("/admin/login"))
    # normal login flow against the stored hash
    client.get("/admin/logout")
    check("after logout: /admin -> login (not setup)",
          "/admin/login" in client.get("/admin").headers.get("Location", ""))
    check("wrong password rejected", b"Wrong password" in client.post("/admin/login", data={"password": "wrongpw12"}).data)
    check("wrong password does not grant access", client.get("/admin/products").status_code == 302)
    login(client)
    check("correct password grants access to products", client.get("/admin/products").status_code == 200)

    # ---------------------------------------------------------------
    section("Admin — products CRUD + soft delete")
    client.post("/admin/products/new", data={
        "name": "Marker Pen", "barcode": "", "category": "stationery", "price": "30", "unit": "piece"})
    pen = _product_by_name("Marker Pen")
    check("admin add product", pen is not None and pen["price"] == 30.0)
    client.post(f"/admin/products/{pen['id']}/edit", data={
        "name": "Marker Pen", "barcode": "", "category": "stationery", "price": "35", "unit": "piece"})
    check("admin edit product price", db.get_product(pen["id"])["price"] == 35.0)

    # deactivate -> disappears from cashier search & barcode
    client.post(f"/admin/products/{pen['id']}/active", data={"active": "0"})
    check("deactivated product is inactive", db.get_product(pen["id"])["active"] == 0)
    check("deactivated product hidden from cashier search",
          not any(p["name"] == "Marker Pen" for p in client.get("/api/products/search?q=marker").get_json()))
    # reactivate
    client.post(f"/admin/products/{pen['id']}/active", data={"active": "1"})
    check("reactivated product visible again",
          any(p["name"] == "Marker Pen" for p in client.get("/api/products/search?q=marker").get_json()))
    # permanent delete (for junk/accidental entries)
    junk = db.add_product(name="Junk Entry", price=1, category="other")
    r = client.post(f"/admin/products/{junk['id']}/delete")
    check("admin permanently deletes a product", r.status_code == 302 and db.get_product(junk["id"]) is None)
    check("delete of a missing product is a clean 404", client.post(f"/admin/products/{junk['id']}/delete").status_code == 404)

    section("Admin — clean up existing duplicates")
    # create 3 copies sharing a barcode + 2 copies sharing a name (no barcode)
    for _ in range(3):
        db.add_product(name="Hit 400ml", price=305, barcode="8901157025200", category="grocery")
    for _ in range(2):
        db.add_product(name="Loose Item", price=10, category="grocery")  # no barcode -> name match
    groups = db.find_duplicate_groups()
    hit = next((g for g in groups if g["keep"]["barcode"] == "8901157025200"), None)
    check("finds the barcode duplicate group (keep 1, remove 2)", hit and len(hit["remove"]) == 2)
    check("keeper is the oldest (lowest id)", hit and all(hit["keep"]["id"] < p["id"] for p in hit["remove"]))
    loose = next((g for g in groups if g["keep"]["name"] == "Loose Item"), None)
    check("finds the no-barcode name duplicate group", loose and len(loose["remove"]) == 1)
    # the review page renders and the cleanup removes the extras (keeps one each)
    check("duplicates page renders", b"Duplicate products" in client.get("/admin/duplicates").data)
    r = client.post("/admin/duplicates/cleanup", follow_redirects=False)
    check("cleanup redirects", r.status_code == 302)
    check("only one Hit 400ml remains", len(db.get_products(query="Hit 400ml")) == 1)
    check("only one Loose Item remains", len(db.get_products(query="Loose Item")) == 1)
    check("no duplicate groups left", db.find_duplicate_groups() == [])

    section("Cashier + Admin — duplicate guard")
    client.post("/api/products/quick-add", json={"name": "Dup Candy", "price": 5, "barcode": "5550001112223"})
    # same name -> 409 duplicate
    r = client.post("/api/products/quick-add", json={"name": "Dup Candy", "price": 9})
    check("quick-add same-name is flagged as duplicate (409)", r.status_code == 409 and r.get_json()["error"] == "duplicate")
    check("duplicate response carries the existing product", r.get_json()["existing"]["name"] == "Dup Candy")
    # same barcode, different name -> still a duplicate
    r = client.post("/api/products/quick-add", json={"name": "Totally Different", "price": 9, "barcode": "5550001112223"})
    check("quick-add same-barcode is flagged as duplicate (409)", r.status_code == 409)
    # force=true creates it anyway
    r = client.post("/api/products/quick-add", json={"name": "Dup Candy", "price": 9, "force": True})
    check("quick-add force overrides the duplicate guard", r.status_code == 201)
    # admin add: duplicate re-renders with a warning instead of creating
    before = len(db.get_products(query="Marker Pen"))
    r = client.post("/admin/products/new", data={"name": "Marker Pen", "category": "stationery", "price": "30", "unit": "piece"})
    check("admin add of a dup name shows the warning (no redirect)", r.status_code == 200 and b"Possible duplicate" in r.data)
    check("admin dup warning did not create a new row", len(db.get_products(query="Marker Pen")) == before)
    # admin 'add anyway' (confirm_duplicate) creates it
    client.post("/admin/products/new", data={"name": "Marker Pen", "category": "stationery", "price": "30", "unit": "piece", "confirm_duplicate": "1"})
    check("admin 'add anyway' creates despite the duplicate", len(db.get_products(query="Marker Pen")) == before + 1)

    section("Admin — optional per-product Nepali name (name_ne)")
    # add a product with a Nepali name via the admin form
    client.post("/admin/products/new", data={
        "name": "Basmati Rice", "name_ne": "बासमती चामल", "barcode": "",
        "category": "weighed", "price": "250", "unit": "kg", "is_weighed": "1", "weighed_group": "Rice",
        "confirm_duplicate": "1"})  # seed already has one; re-adding on purpose to test name_ne
    br = _product_by_name("Basmati Rice")
    check("admin form stores name_ne", br is not None and br["name_ne"] == "बासमती चामल")
    check("name_ne comes back on the quick-taps API",
          any(p.get("name_ne") == "बासमती चामल"
              for g in client.get("/api/products/quick-taps").get_json()["groups"]
              for p in g["products"]))
    check("name_ne comes back on search", any(p.get("name_ne") == "बासमती चामल" for p in client.get("/api/products/search?q=basmati").get_json()))
    # a product with no Nepali name stores NULL, and the canonical English name is unaffected
    client.post("/admin/products/new", data={
        "name": "Plain Soap", "name_ne": "", "category": "grocery", "price": "40", "unit": "piece"})
    ps = _product_by_name("Plain Soap")
    check("blank Nepali name stored as NULL", ps is not None and ps["name_ne"] is None)
    # editing can add a Nepali name later
    client.post(f"/admin/products/{ps['id']}/edit", data={
        "name": "Plain Soap", "name_ne": "साबुन", "category": "grocery", "price": "40", "unit": "piece"})
    check("edit adds a Nepali name", db.get_product(ps["id"])["name_ne"] == "साबुन")

    section("Cashier — pin a product as a one-tap button (#pin)")
    # add a pinned fixed-price product via Quick Add
    r = client.post("/api/products/quick-add", json={"name": "Milk 500ml", "price": 55, "category": "grocery", "pinned": True})
    check("quick-add stores pinned flag", r.status_code == 201 and r.get_json().get("pinned") == 1)
    qt = client.get("/api/products/quick-taps").get_json()
    check("pinned product appears in quick-taps 'pinned' list",
          any(p["name"] == "Milk 500ml" for p in qt.get("pinned", [])))
    # a non-pinned product does not appear as a button
    client.post("/api/products/quick-add", json={"name": "Rare Item", "price": 15, "category": "grocery"})
    qt = client.get("/api/products/quick-taps").get_json()
    check("non-pinned product is not a button",
          not any(p["name"] == "Rare Item" for p in qt.get("pinned", [])))
    # admin can pin/unpin via the edit form
    milk = _product_by_name("Milk 500ml")
    client.post(f"/admin/products/{milk['id']}/edit", data={
        "name": "Milk 500ml", "category": "grocery", "price": "55", "unit": "packet"})  # pinned checkbox unchecked
    check("admin edit without the box unpins", db.get_product(milk["id"])["pinned"] == 0)
    client.post(f"/admin/products/{milk['id']}/edit", data={
        "name": "Milk 500ml", "category": "grocery", "price": "55", "unit": "packet", "pinned": "1"})
    check("admin edit with the box pins", db.get_product(milk["id"])["pinned"] == 1)
    # weighed and lpg products never show in the pinned list (they have their own buttons)
    db.add_product(name="Pinned Weighed", price=100, category="weighed", is_weighed=1, unit="kg", weighed_group="Rice", pinned=1)
    qt = client.get("/api/products/quick-taps").get_json()
    check("pinned weighed item excluded from pinned buttons",
          not any(p["name"] == "Pinned Weighed" for p in qt.get("pinned", [])))

    section("Admin — weighed group auto-detect on add")
    client.post("/admin/products/new", data={
        "name": "Salt", "barcode": "", "category": "weighed", "price": "45", "unit": "kg", "is_weighed": "1", "weighed_group": ""})
    salt = _product_by_name("Salt")
    check("keyword-less weighed item auto-grouped to Other", salt["weighed_group"] == "Other")
    data = client.get("/api/products/quick-taps").get_json()
    other = next(g["products"] for g in data["groups"] if g["name"] == "Other")
    check("Salt shows under Other group", any(p["name"] == "Salt" for p in other))

    # ---------------------------------------------------------------
    section("Admin — products search & category filter")
    check("admin name search filters", b"Basmati Rice" in client.get("/admin/products?q=basmati").data)
    html = client.get("/admin/products?category=lpg").data
    check("admin category filter (lpg only)", b"LPG Refill" in html and b"Basmati Rice" not in html)
    # Live text search is client-side: the page ships the script and per-row
    # search data so typing filters instantly without a page reload.
    check("live-search script + row search data present",
          b"admin-products.js" in html and b"data-search=" in html)

    # ---------------------------------------------------------------
    section("Categories — cosmetics + extensibility")
    # Quick Add a fixed item with an explicit category
    r = client.post("/api/products/quick-add", json={"name": "Face Cream", "price": 180, "category": "cosmetics"})
    check("quick-add fixed item honours category", r.status_code == 201 and r.get_json()["category"] == "cosmetics")
    # Quick Add with an unknown category falls back to 'other'
    r = client.post("/api/products/quick-add", json={"name": "Mystery Item", "price": 20, "category": "nonsense"})
    check("quick-add rejects unknown category (-> other)", r.get_json()["category"] == "other")
    # Admin add with cosmetics (now in CATEGORIES, and no CHECK to block it)
    client.post("/admin/products/new", data={
        "name": "Lipstick", "barcode": "", "category": "cosmetics", "price": "250", "unit": "piece"})
    lip = _product_by_name("Lipstick")
    check("admin add cosmetics product", lip is not None and lip["category"] == "cosmetics")
    check("cosmetics filter shows it", b"Lipstick" in client.get("/admin/products?category=cosmetics").data)
    # The category column has no CHECK constraint, so a brand-new category name
    # inserts fine at the DB layer (future categories = code-list change only).
    db.add_product(name="Hardware Nail", price=10, category="hardware")
    check("category column is not CHECK-constrained (extensible)",
          _product_by_name("Hardware Nail")["category"] == "hardware")

    # ---------------------------------------------------------------
    section("Admin — reports (daily/weekly/monthly)")
    _insert_backdated_sale("2026-06-24", 500.0)   # different ISO week
    _insert_backdated_sale("2026-06-01", 700.0)   # different month
    rep = client.get("/admin/reports").data.decode()
    check("daily report shows a Rs. total", "Rs. " in rep)
    check("weekly groups appear (ISO week label)", "2026-W" in rep)
    check("monthly groups appear (2026-06 merged)", "2026-06" in rep)
    # verify monthly aggregation numerically via db helper
    months = {}
    for row in db.get_all_daily_totals():
        months.setdefault(row["date"][:7], 0.0)
        months[row["date"][:7]] += row["total"]
    check("June total = 500 + 700 = 1200", round(months.get("2026-06", 0), 2) == 1200.0, str(months))

    # ---------------------------------------------------------------
    section("Admin — Bikram Sambat dates in reports (#4)")
    check("BS converter anchor 2024-04-13 -> 2081-01-01", nepali_date.to_bs(_date(2024, 4, 13)) == (2081, 1, 1))
    check("BS converter 2025-04-14 -> 2082-01-01", nepali_date.to_bs(_date(2025, 4, 14)) == (2082, 1, 1))
    check("BS date label 2026-07-04 -> '2083 Asar 20'", nepali_date.bs_date_label("2026-07-04") == "2083 Asar 20")
    check("BS month key 2026-07-04 -> '2083 Asar'", nepali_date.bs_month_key("2026-07-04") == ("2083-03", "2083 Asar"))
    check("BS out-of-range date returns None", nepali_date.bs_date_label("1990-01-01") is None)
    rep_bs = client.get("/admin/reports").data.decode()
    check("daily report has a BS date column", "Date (BS)" in rep_bs)
    check("reports have a Bikram Sambat month section", "Bikram Sambat month" in rep_bs)
    check("reports render a converted BS date (2083 ...)", "2083 " in rep_bs)

    # ---------------------------------------------------------------
    section("Admin — CSV export")
    r = client.get("/admin/sales/export.csv")
    check("export content-type is CSV", r.mimetype == "text/csv")
    check("export is an attachment", "attachment" in r.headers.get("Content-Disposition", ""))
    lines = r.data.decode().strip().splitlines()
    check("export header correct",
          lines[0] == "sale_id,date,time,product_name,quantity,unit_price,line_total,sale_total")
    check("export has one row per line item", len(lines) - 1 == _count_sale_items())

    # ---------------------------------------------------------------
    section("Admin — CSV import (insert / update / invalid / bad header)")
    good = (
        "barcode,name,category,price,is_weighed,unit\n"
        "3334445556667,Imported Soap,grocery,45,0,piece\n"        # new insert
        ",Imported Aata,weighed,88,1,kg\n"                        # new weighed (Flour keyword)
        "1111111111111,Test Noodles XL,grocery,30,0,packet\n"    # update existing by barcode
        ",Broken Row,grocery,,0,piece\n"                          # invalid (no price)
    )
    r = client.post("/admin/import",
                    data={"file": (io.BytesIO(good.encode()), "products.csv")},
                    content_type="multipart/form-data")
    body = r.data.decode()
    check("import summary: 2 added, 1 updated, 1 skipped", "2 added, 1 updated, 1 row(s) skipped" in body)
    check("import inserted new product", db.get_product_by_barcode("3334445556667") is not None)
    check("import updated existing by barcode", db.get_product_by_barcode("1111111111111")["name"] == "Test Noodles XL")
    aata = _product_by_name("Imported Aata")
    check("imported weighed item auto-grouped (Flour keyword? -> Other)", aata is not None and aata["weighed_group"] in db.WEIGHED_GROUPS)
    check("import reports the bad line number", "Line 5" in body)

    bad_header = client.post("/admin/import",
                             data={"file": (io.BytesIO(b"a,b,c\n1,2,3\n"), "x.csv")},
                             content_type="multipart/form-data")
    check("wrong header rejected", b"CSV header must be" in bad_header.data)

    # ---------------------------------------------------------------
    section("Groups — user-defined cashier buttons")
    check("default groups seeded",
          all(n in db.group_names() for n in ["Rice", "Dal", "Sugar", "Flour", "Other", "LPG"]))
    # Create a new fixed-price group via admin, then file a product under it
    client.post("/admin/groups/new", data={"name": "Oil", "name_ne": "तेल", "sort_order": "35"})
    oil = db.get_group_by_name("Oil")
    check("admin created a fixed-price group", oil is not None and oil["is_weighed"] == 0)
    client.post("/admin/products/new", data={
        "name": "Sunflower Oil 1L", "category": "grocery", "price": "220", "unit": "bottle",
        "weighed_group": "Oil"})
    check("product filed under the new group", _product_by_name("Sunflower Oil 1L")["weighed_group"] == "Oil")
    data = client.get("/api/products/quick-taps").get_json()
    oilg = next((g for g in data["groups"] if g["name"] == "Oil"), None)
    check("new fixed group shows on the cashier", oilg is not None and oilg["is_weighed"] == 0
          and any(p["name"] == "Sunflower Oil 1L" for p in oilg["products"]))
    # Rename the group -> its products move with it
    client.post(f"/admin/groups/{oil['id']}/edit",
                data={"name": "Cooking Oil", "name_ne": "तेल", "sort_order": "35"})
    check("rename carries the products across", _product_by_name("Sunflower Oil 1L")["weighed_group"] == "Cooking Oil")
    # Hide -> gone from cashier; Delete -> product kept but un-grouped
    client.post(f"/admin/groups/{oil['id']}/active", data={"active": "0"})
    data = client.get("/api/products/quick-taps").get_json()
    check("hidden group not on cashier", not any(g["name"] == "Cooking Oil" for g in data["groups"]))
    client.post(f"/admin/groups/{oil['id']}/delete", data={})
    check("group deleted", db.get_group(oil["id"]) is None)
    check("deleted group's product kept, un-grouped",
          _product_by_name("Sunflower Oil 1L")["weighed_group"] in (None, ""))
    # A custom WEIGHED group works too (weight pad path)
    client.post("/admin/groups/new", data={"name": "Pulses", "is_weighed": "1", "sort_order": "25"})
    client.post("/admin/products/new", data={
        "name": "Chana", "category": "weighed", "price": "160", "unit": "kg",
        "is_weighed": "1", "weighed_group": "Pulses"})
    data = client.get("/api/products/quick-taps").get_json()
    pulses = next((g for g in data["groups"] if g["name"] == "Pulses"), None)
    check("custom weighed group works",
          pulses is not None and pulses["is_weighed"] == 1 and any(p["name"] == "Chana" for p in pulses["products"]))
    check("duplicate group name rejected",
          b"already exists" in client.post("/admin/groups/new", data={"name": "Pulses"}).data)

    # ---------------------------------------------------------------
    section("Measured by litre — loose liquids (oil etc.)")
    # Quick Add a measured litre product into a weighed-type group
    r = client.post("/api/products/quick-add", json={
        "name": "Loose Mustard Oil", "price": 265, "is_weighed": True,
        "weighed_group": "Other", "unit": "litre"})
    check("litre quick-add returns 201", r.status_code == 201)
    prod = r.get_json()
    check("litre quick-add is measured/litre/group",
          prod["is_weighed"] == 1 and prod["unit"] == "litre" and prod["weighed_group"] == "Other")
    check("litre product appears under its group button",
          any(p["name"] == "Loose Mustard Oil"
              for g in client.get("/api/products/quick-taps").get_json()["groups"]
              if g["name"] == "Other" for p in g["products"]))
    # unit is validated; omitting it keeps the kg default
    check("bad measure unit rejected",
          client.post("/api/products/quick-add", json={
              "name": "Bad Unit Oil", "price": 10, "is_weighed": True,
              "weighed_group": "Other", "unit": "gallon"}).status_code == 400)
    r = client.post("/api/products/quick-add", json={
        "name": "Default Unit Item", "price": 80, "is_weighed": True, "weighed_group": "Other"})
    check("measured quick-add without unit defaults to kg", r.get_json()["unit"] == "kg")
    # admin form: litre is an offered unit and saves on a measured product
    check("admin form offers the litre unit", b">litre<" in client.get("/admin/products/new").data)
    client.post("/admin/products/new", data={
        "name": "Loose Kerosene", "category": "weighed", "price": "150", "unit": "litre",
        "is_weighed": "1", "weighed_group": "Other"})
    check("admin add stores a litre product", _product_by_name("Loose Kerosene")["unit"] == "litre")
    # CSV import accepts litre
    litre_csv = (
        "barcode,name,category,price,is_weighed,unit\n"
        ",Imported Loose Oil,weighed,240,1,litre\n"
    )
    client.post("/admin/import",
                data={"file": (io.BytesIO(litre_csv.encode()), "litre.csv")},
                content_type="multipart/form-data")
    imported = _product_by_name("Imported Loose Oil")
    check("CSV import accepts a litre unit", imported is not None and imported["unit"] == "litre")
    # a fractional-litre sale computes like any measured sale
    r = client.post("/api/sales", json={"items": [
        {"product_name": "Loose Mustard Oil", "quantity": 0.5, "unit_price": 265}]})
    check("half-litre sale totals correctly", r.status_code == 201 and r.get_json()["total"] == 132.5)

    section("Migration — unit CHECK dropped, data preserved")
    # Simulate the deployed database, whose products table still has the old
    # CHECK (unit IN ('kg','piece','packet','bottle')) — init must rebuild it
    # without the CHECK, keep existing rows/ids, and then accept litre.
    import sqlite3 as _sqlite3
    _mig_dir = tempfile.mkdtemp(prefix="nepalpos-mig-")
    _old_paths = (db.DATA_DIR, db.STORE_DB_PATH, db.SALES_DB_PATH)
    db.DATA_DIR = _mig_dir
    db.STORE_DB_PATH = os.path.join(_mig_dir, "store.db")
    db.SALES_DB_PATH = os.path.join(_mig_dir, "sales.db")
    try:
        conn = _sqlite3.connect(db.STORE_DB_PATH)
        conn.execute("""
            CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                barcode TEXT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                is_weighed BOOLEAN NOT NULL DEFAULT 0,
                unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'packet', 'bottle')),
                active BOOLEAN NOT NULL DEFAULT 1,
                weighed_group TEXT,
                name_ne TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                image_path TEXT
            )""")
        conn.execute(
            "INSERT INTO products (barcode, name, category, price, is_weighed, unit, active, weighed_group, name_ne, pinned, image_path) "
            "VALUES ('7770001112223', 'Old Rice', 'weighed', 100.0, 1, 'kg', 1, 'Rice', 'पुरानो चामल', 0, NULL)")
        conn.commit()
        conn.close()
        db.init_store_db()
        table_sql = _sqlite3.connect(db.STORE_DB_PATH).execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").fetchone()[0]
        check("unit CHECK removed by migration", "CHECK (unit IN" not in table_sql)
        old_row = db.get_product(1)
        check("existing row survives with id and columns intact",
              old_row is not None and old_row["name"] == "Old Rice"
              and old_row["unit"] == "kg" and old_row["name_ne"] == "पुरानो चामल")
        litre_prod = db.add_product(name="Post-migration Oil", price=200, category="weighed",
                                    is_weighed=1, unit="litre", weighed_group="Other")
        check("litre insert accepted after migration", litre_prod["unit"] == "litre")
    finally:
        db.DATA_DIR, db.STORE_DB_PATH, db.SALES_DB_PATH = _old_paths

    # ---------------------------------------------------------------
    section("Admin — product photos")
    # Add a product with a photo (oversized image should be resized down).
    r = client.post("/admin/products/new",
                    data={"name": "Photo Rice", "category": "weighed", "price": "120",
                          "unit": "kg", "is_weighed": "1", "weighed_group": "Rice",
                          "image": (io.BytesIO(_png_bytes()), "rice.png")},
                    content_type="multipart/form-data", follow_redirects=False)
    check("add-with-photo redirects", r.status_code == 302)
    prod = _product_by_name("Photo Rice")
    check("photo filename stored on product", prod and prod["image_path"])
    img_path = os.path.join(app_module.IMAGES_DIR, prod["image_path"])
    check("photo file written to disk", os.path.exists(img_path))
    with Image.open(img_path) as im:
        check("photo resized to <=400px thumbnail", max(im.size) <= app_module.IMAGE_MAX_PX)
    served = client.get("/media/" + prod["image_path"])
    check("photo served over /media",
          served.status_code == 200 and served.mimetype.startswith("image/") and len(served.data) > 0)
    served.close()  # release the file handle (Windows won't delete an open file)
    # Search results now carry the image_path for the cashier thumbnail.
    hit = client.get("/api/products/search?q=Photo Rice").get_json()
    check("search result includes image_path", hit and hit[0].get("image_path") == prod["image_path"])
    # Re-upload replaces the file (old one removed).
    old_file = prod["image_path"]
    client.post(f"/admin/products/{prod['id']}/edit",
                data={"name": "Photo Rice", "category": "weighed", "price": "120",
                      "unit": "kg", "is_weighed": "1", "weighed_group": "Rice",
                      "image": (io.BytesIO(_png_bytes((20, 120, 40))), "rice2.png")},
                content_type="multipart/form-data")
    prod2 = _product_by_name("Photo Rice")
    check("re-upload changes the stored filename", prod2["image_path"] != old_file)
    check("old photo file deleted on replace", not os.path.exists(os.path.join(app_module.IMAGES_DIR, old_file)))
    # Ticking "remove photo" clears it and deletes the file.
    client.post(f"/admin/products/{prod['id']}/edit",
                data={"name": "Photo Rice", "category": "weighed", "price": "120",
                      "unit": "kg", "is_weighed": "1", "weighed_group": "Rice", "remove_image": "1"},
                content_type="multipart/form-data")
    prod3 = _product_by_name("Photo Rice")
    check("remove-photo clears image_path", prod3["image_path"] is None)
    check("removed photo file deleted", not os.path.exists(os.path.join(app_module.IMAGES_DIR, prod2["image_path"])))
    # A non-image upload is ignored, not stored.
    client.post("/admin/products/new",
                data={"name": "Bad Photo", "category": "grocery", "price": "10", "unit": "piece",
                      "image": (io.BytesIO(b"not an image"), "notimage.png")},
                content_type="multipart/form-data")
    check("non-image upload leaves image_path empty", _product_by_name("Bad Photo")["image_path"] is None)

    # ---------------------------------------------------------------
    section("Admin — change password")
    # (currently logged in with ADMIN_PW from the auth section)
    r = client.post("/admin/change-password", data={"current": "wrongpw12", "password": NEW_PW, "confirm": NEW_PW})
    check("wrong current password rejected", b"Current password is wrong" in r.data)
    check("password unchanged after failed attempt", check_password_hash(db.get_admin_password_hash(), ADMIN_PW))
    r = client.post("/admin/change-password", data={"current": ADMIN_PW, "password": NEW_PW, "confirm": "mismatch9"})
    check("mismatched new password rejected", b"do not match" in r.data)
    r = client.post("/admin/change-password",
                    data={"current": ADMIN_PW, "password": NEW_PW, "confirm": NEW_PW}, follow_redirects=False)
    check("valid change redirects to products", r.status_code == 302)
    check("new password hash stored", check_password_hash(db.get_admin_password_hash(), NEW_PW))
    # old no longer works, new one does
    client.get("/admin/logout")
    check("old password no longer logs in", b"Wrong password" in client.post("/admin/login", data={"password": ADMIN_PW}).data)
    client.post("/admin/login", data={"password": NEW_PW})
    check("new password logs in", client.get("/admin/products").status_code == 200)

    # ---------------------------------------------------------------
    section("Static assets — cache-busting version param")
    page = client.get("/").data.decode()
    m = re.search(r'href="(/static/style\.css\?v=([0-9a-f]{8}))"', page)
    check("cashier stylesheet URL carries a ?v= content hash", m is not None, page[:200])
    check("all cashier static assets carry ?v=",
          len(re.findall(r'/static/[^"]+\?v=[0-9a-f]{8}', page)) >= 6, str(re.findall(r'/static/[^"]+"', page)))
    if m:
        check("versioned asset URL serves the file", client.get(m.group(1)).status_code == 200)
        expected = hashlib.md5(open(os.path.join("static", "style.css"), "rb").read()).hexdigest()[:8]
        check("version matches the file's content hash", m.group(2) == expected)

    # ---------------------------------------------------------------
    section("Cashier — change calculator / success screen / weight presets markup")
    check("confirm modal has the optional change calculator",
          'data-i18n="customerPaid"' in page and 'id="paid-custom-pad"' in page and 'id="change-box"' in page)
    check("payment quick chips are Rs. 500 / Rs. 1000 / Custom",
          'data-paid="500"' in page and 'data-paid="1000"' in page and 'id="paid-custom-chip"' in page)
    check("sale-saved success screen present", 'id="success-modal"' in page and 'data-i18n="saleSavedTitle"' in page)
    check("weight pad has a preset chip row", 'id="weight-presets"' in page)
    check("confirm modal offers Cash / QR payment step",
          'id="pay-cash"' in page and 'id="pay-qr"' in page and 'id="qr-pay-box"' in page)
    m_qr = re.search(r'src="(/static/fonepay-qr\.png[^"]*)"', page)
    check("static FonePay QR image referenced and served",
          m_qr is not None and client.get(m_qr.group(1)).status_code == 200)

    # ---------------------------------------------------------------
    print(f"\n{'='*40}\n{_passed} passed, {_failed} failed\n{'='*40}")
    return 0 if _failed == 0 else 1


# --- small DB helpers for assertions ---------------------------------------
def _product_by_name(name):
    conn = db.get_store_db()
    row = conn.execute("SELECT * FROM products WHERE name = ? ORDER BY id DESC LIMIT 1", (name,)).fetchone()
    conn.close()
    return dict(row) if row else None


def _last_sale_item():
    conn = db.get_sales_db()
    row = conn.execute("SELECT * FROM sale_items ORDER BY item_id DESC LIMIT 1").fetchone()
    conn.close()
    return dict(row)


def _count_sale_items():
    conn = db.get_sales_db()
    n = conn.execute("SELECT COUNT(*) FROM sale_items").fetchone()[0]
    conn.close()
    return n


def _insert_backdated_sale(date, total):
    conn = db.get_sales_db()
    cur = conn.execute("INSERT INTO sales (date, time, total, item_count) VALUES (?, ?, ?, 1)",
                       (date, "12:00:00", total))
    conn.execute("INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, line_total) VALUES (?,?,?,?,?)",
                 (cur.lastrowid, "Backdated", 1, total, total))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    sys.exit(run())
