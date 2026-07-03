"""Phase 4 — full local scenario tests for the Nepal Grocery POS.

Self-contained: no pytest, just the standard library and Flask's test client.
Runs against a throwaway database in a temp directory, so it never touches the
real data/ files or a running dev server.

    python tests.py
"""

import io
import os
import sys
import tempfile

# Windows consoles default to cp1252; keep the em-dashes/output readable.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# --- Isolate the database BEFORE importing the app -------------------------
# app.py calls db.init_db() at import time and reads ADMIN_PASSWORD, so both
# the DB paths and the env var must be set first.
os.environ["ADMIN_PASSWORD"] = "test-pw"
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
    (None, "LPG Refill", "lpg", 1900.0, 0, "piece", None),
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


def login(client):
    return client.post("/admin/login", data={"password": "test-pw"}, follow_redirects=False)


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
    groups = {g["label"]: [p["name"] for p in g["products"]] for g in data["groups"]}
    check("Rice group has both rice varieties", set(groups.get("Rice", [])) == {"Basmati Rice", "Mansuli Rice"})
    check("Dal group has the dal", groups.get("Dal") == ["Musuro Dal"])
    check("Sugar and Flour present", groups.get("Sugar") == ["Sugar"] and groups.get("Flour") == ["Flour"])
    check("LPG returned separately", [p["name"] for p in data["lpg"]] == ["LPG Refill"])

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
    rice = next(g["products"] for g in data["groups"] if g["label"] == "Rice")
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
    section("Admin — authentication")
    check("unauth /admin redirects to login", client.get("/admin").status_code == 302)
    check("wrong password shows error", b"Wrong password" in client.post("/admin/login", data={"password": "nope"}).data)
    # disabled when no password configured
    saved_pw = app_module.ADMIN_PASSWORD
    app_module.ADMIN_PASSWORD = None
    check("admin disabled (503) when no password set", client.get("/admin/login").status_code == 503)
    app_module.ADMIN_PASSWORD = saved_pw
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

    section("Admin — weighed group auto-detect on add")
    client.post("/admin/products/new", data={
        "name": "Salt", "barcode": "", "category": "weighed", "price": "45", "unit": "kg", "is_weighed": "1", "weighed_group": ""})
    salt = _product_by_name("Salt")
    check("keyword-less weighed item auto-grouped to Other", salt["weighed_group"] == "Other")
    data = client.get("/api/products/quick-taps").get_json()
    other = next(g["products"] for g in data["groups"] if g["label"] == "Other")
    check("Salt shows under Other group", any(p["name"] == "Salt" for p in other))

    # ---------------------------------------------------------------
    section("Admin — products search & category filter")
    check("admin name search filters", b"Basmati Rice" in client.get("/admin/products?q=basmati").data)
    html = client.get("/admin/products?category=lpg").data
    check("admin category filter (lpg only)", b"LPG Refill" in html and b"Basmati Rice" not in html)

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
