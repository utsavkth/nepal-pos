"""SQLite connection helpers and schema initialisation for the Nepal Grocery POS."""

import os
import sqlite3

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STORE_DB_PATH = os.path.join(DATA_DIR, "store.db")
SALES_DB_PATH = os.path.join(DATA_DIR, "sales.db")


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
