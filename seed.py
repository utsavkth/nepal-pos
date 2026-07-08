"""Seed store.db with test products covering every category and both barcode cases."""

from db import get_store_db, init_db

PRODUCTS = [
    # (barcode, name, category, price, is_weighed, unit, weighed_group, name_ne, pinned)
    ("8901058851101", "Wai Wai Noodles", "grocery", 25.00, 0, "packet", None, "वाइ वाइ चाउचाउ", 0),
    ("5449000000996", "Coca-Cola 500ml", "grocery", 70.00, 0, "bottle", None, None, 0),
    ("8901030675013", "Surf Excel Detergent", "grocery", 150.00, 0, "packet", None, None, 0),
    (None, "Milk 500ml", "grocery", 55.00, 0, "packet", None, "दूध", 1),  # pinned -> cashier button
    (None, "Basmati Rice", "weighed", 250.00, 1, "kg", "Rice", "बासमती चामल", 0),
    (None, "Mansuli Rice", "weighed", 95.00, 1, "kg", "Rice", "मन्सुली चामल", 0),
    (None, "Musuro Dal", "weighed", 190.00, 1, "kg", "Dal", "मुसुरो दाल", 0),
    (None, "Chana Dal", "weighed", 210.00, 1, "kg", "Dal", "चना दाल", 0),
    (None, "Sugar", "weighed", 110.00, 1, "kg", "Sugar", "चिनी", 0),
    (None, "Flour", "weighed", 90.00, 1, "kg", "Flour", "पीठो", 0),
    (None, "Mustard Oil (loose)", "weighed", 265.00, 1, "litre", "Other", "तोरीको तेल", 0),  # measured per litre
    (None, "LPG Cylinder Refill", "lpg", 1900.00, 0, "piece", "LPG", "ग्यास सिलिन्डर", 0),
    (None, "Exercise Copy", "stationery", 40.00, 0, "piece", None, None, 0),
    ("8901030865278", "Fair Cream 50g", "cosmetics", 180.00, 0, "piece", None, None, 0),
    (None, "Matchbox", "other", 5.00, 0, "piece", None, "सलाई", 0),
]


def seed():
    init_db()
    conn = get_store_db()
    conn.execute("DELETE FROM products")
    conn.executemany(
        """
        INSERT INTO products (barcode, name, category, price, is_weighed, unit, weighed_group, name_ne, pinned, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
