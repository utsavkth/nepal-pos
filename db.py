"""SQLite connection helpers and schema initialisation for the Nepal Grocery POS."""

import os
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STORE_DB_PATH = os.path.join(DATA_DIR, "store.db")
SALES_DB_PATH = os.path.join(DATA_DIR, "sales.db")

SHOP_TZ = ZoneInfo("Asia/Kathmandu")


def get_store_db():
    """Return a connection to store.db (products) with row access by column name."""
    conn = sqlite3.connect(STORE_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_sales_db():
    """Return a connection to sales.db (sales + sale_items) with row access by column name."""
    conn = sqlite3.connect(SALES_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_store_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_store_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT,
            name TEXT NOT NULL,
            category TEXT NOT NULL CHECK (category IN ('grocery', 'weighed', 'lpg', 'stationery', 'other')),
            price REAL NOT NULL,
            is_weighed BOOLEAN NOT NULL DEFAULT 0,
            unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'packet', 'bottle')),
            active BOOLEAN NOT NULL DEFAULT 1
        )
        """
    )
    conn.commit()
    conn.close()


def init_sales_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_sales_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sales (
            sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            total REAL NOT NULL,
            item_count INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sale_items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            line_total REAL NOT NULL,
            FOREIGN KEY (sale_id) REFERENCES sales (sale_id)
        )
        """
    )
    conn.commit()
    conn.close()


def init_db():
    """Create both databases and their schemas if they don't already exist."""
    init_store_db()
    init_sales_db()


def search_products(query, limit=20):
    """Search active products by name, case-insensitive substring match."""
    conn = get_store_db()
    rows = conn.execute(
        """
        SELECT * FROM products
        WHERE active = 1 AND name LIKE ? COLLATE NOCASE
        ORDER BY name
        LIMIT ?
        """,
        (f"%{query}%", limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_product_by_barcode(barcode):
    """Return the active product with this barcode, or None."""
    conn = get_store_db()
    row = conn.execute(
        "SELECT * FROM products WHERE active = 1 AND barcode = ?", (barcode,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_quick_tap_products():
    """Return active weighed products and LPG products for the quick-tap buttons."""
    conn = get_store_db()
    rows = conn.execute(
        """
        SELECT * FROM products
        WHERE active = 1 AND category IN ('weighed', 'lpg')
        ORDER BY category DESC, id
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_product(name, price, barcode=None, category="other", is_weighed=0, unit="piece"):
    """Insert a product and return it as a dict."""
    conn = get_store_db()
    cur = conn.execute(
        """
        INSERT INTO products (barcode, name, category, price, is_weighed, unit, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        (barcode, name, category, price, is_weighed, unit),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM products WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def get_products(query=None, category=None):
    """All products (active and inactive) for the admin list, with optional filters."""
    sql = "SELECT * FROM products WHERE 1=1"
    params = []
    if query:
        sql += " AND name LIKE ? COLLATE NOCASE"
        params.append(f"%{query}%")
    if category:
        sql += " AND category = ?"
        params.append(category)
    sql += " ORDER BY active DESC, name"
    conn = get_store_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_product(product_id):
    conn = get_store_db()
    row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_product(product_id, barcode, name, category, price, is_weighed, unit):
    conn = get_store_db()
    conn.execute(
        """
        UPDATE products
        SET barcode = ?, name = ?, category = ?, price = ?, is_weighed = ?, unit = ?
        WHERE id = ?
        """,
        (barcode, name, category, price, is_weighed, unit, product_id),
    )
    conn.commit()
    conn.close()


def set_product_active(product_id, active):
    conn = get_store_db()
    conn.execute("UPDATE products SET active = ? WHERE id = ?", (1 if active else 0, product_id))
    conn.commit()
    conn.close()


def import_product_row(barcode, name, category, price, is_weighed, unit):
    """Import one product row. A barcode matching an existing product updates it
    (and reactivates it); otherwise a new product is inserted.
    Returns 'updated' or 'inserted'."""
    conn = get_store_db()
    existing = None
    if barcode:
        existing = conn.execute(
            "SELECT id FROM products WHERE barcode = ?", (barcode,)
        ).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE products
            SET name = ?, category = ?, price = ?, is_weighed = ?, unit = ?, active = 1
            WHERE id = ?
            """,
            (name, category, price, is_weighed, unit, existing["id"]),
        )
        result = "updated"
    else:
        conn.execute(
            """
            INSERT INTO products (barcode, name, category, price, is_weighed, unit, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            """,
            (barcode, name, category, price, is_weighed, unit),
        )
        result = "inserted"
    conn.commit()
    conn.close()
    return result


def get_daily_totals(limit=31):
    """Daily sales totals, newest first. Dates are already Asia/Kathmandu local."""
    conn = get_sales_db()
    rows = conn.execute(
        """
        SELECT date, COUNT(*) AS sales_count, SUM(total) AS total
        FROM sales GROUP BY date ORDER BY date DESC LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_daily_totals():
    """Every day with sales, oldest first, for weekly/monthly aggregation."""
    conn = get_sales_db()
    rows = conn.execute(
        """
        SELECT date, COUNT(*) AS sales_count, SUM(total) AS total
        FROM sales GROUP BY date ORDER BY date
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sales_export_rows():
    """One row per sale item, joined with its sale, for CSV export."""
    conn = get_sales_db()
    rows = conn.execute(
        """
        SELECT s.sale_id, s.date, s.time, i.product_name, i.quantity,
               i.unit_price, i.line_total, s.total AS sale_total
        FROM sales s JOIN sale_items i ON i.sale_id = s.sale_id
        ORDER BY s.sale_id, i.item_id
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_sale(items):
    """Save a sale with its line items. Timestamps use Asia/Kathmandu shop time.

    items: list of dicts with product_name, quantity, unit_price, line_total.
    Returns the saved sale as a dict.
    """
    now = datetime.now(SHOP_TZ)
    date = now.date().isoformat()
    time = now.strftime("%H:%M:%S")
    total = round(sum(item["line_total"] for item in items), 2)

    conn = get_sales_db()
    cur = conn.execute(
        "INSERT INTO sales (date, time, total, item_count) VALUES (?, ?, ?, ?)",
        (date, time, total, len(items)),
    )
    sale_id = cur.lastrowid
    conn.executemany(
        """
        INSERT INTO sale_items (sale_id, product_name, quantity, unit_price, line_total)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (sale_id, i["product_name"], i["quantity"], i["unit_price"], i["line_total"])
            for i in items
        ],
    )
    conn.commit()
    conn.close()
    return {"sale_id": sale_id, "date": date, "time": time, "total": total, "item_count": len(items)}
