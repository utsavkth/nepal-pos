"""Seed store.db with test products covering every category and both barcode cases."""

from db import get_store_db, init_db

PRODUCTS = [
    # (barcode, name, category, price, is_weighed, unit)
    ("8901058851101", "Wai Wai Noodles", "grocery", 25.00, 0, "packet"),
    ("5449000000996", "Coca-Cola 500ml", "grocery", 70.00, 0, "bottle"),
    ("8901030675013", "Surf Excel Detergent", "grocery", 150.00, 0, "packet"),
    (None, "Basmati Rice", "weighed", 250.00, 1, "kg"),
    (None, "Mansuli Rice", "weighed", 95.00, 1, "kg"),
    (None, "Musuro Dal", "weighed", 190.00, 1, "kg"),
    (None, "Chana Dal", "weighed", 210.00, 1, "kg"),
    (None, "Sugar", "weighed", 110.00, 1, "kg"),
    (None, "Flour", "weighed", 90.00, 1, "kg"),
    (None, "LPG Cylinder Refill", "lpg", 1900.00, 0, "piece"),
    (None, "Exercise Copy", "stationery", 40.00, 0, "piece"),
    (None, "Matchbox", "other", 5.00, 0, "piece"),
]


def seed():
    init_db()
    conn = get_store_db()
    conn.execute("DELETE FROM products")
    conn.executemany(
        """
        INSERT INTO products (barcode, name, category, price, is_weighed, unit, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        PRODUCTS,
    )
    conn.commit()

    print("Seeded products:")
    rows = conn.execute("SELECT * FROM products ORDER BY id").fetchall()
    for row in rows:
        barcode = row["barcode"] or "-"
        weighed = "yes" if row["is_weighed"] else "no"
        print(
            f"  [{row['id']}] {row['name']:<22} category={row['category']:<10} "
            f"price=Rs. {row['price']:.2f}  weighed={weighed}  unit={row['unit']}  barcode={barcode}"
        )
    conn.close()


if __name__ == "__main__":
    seed()
