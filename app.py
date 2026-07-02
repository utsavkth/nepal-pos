"""Flask app for the Nepal Grocery POS."""

from flask import Flask, jsonify, render_template, request

import db

app = Flask(__name__)

db.init_db()


@app.route("/")
def cashier():
    return render_template("cashier.html")


@app.route("/api/products/search")
def api_search_products():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])
    return jsonify(db.search_products(query))


@app.route("/api/products/barcode/<barcode>")
def api_product_by_barcode(barcode):
    product = db.get_product_by_barcode(barcode)
    if product is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify(product)


@app.route("/api/products/quick-taps")
def api_quick_taps():
    return jsonify(db.get_quick_tap_products())


@app.route("/api/products/quick-add", methods=["POST"])
def api_quick_add():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    try:
        price = float(data.get("price"))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_price"}), 400
    if not name or price <= 0:
        return jsonify({"error": "name_and_positive_price_required"}), 400
    barcode = (data.get("barcode") or "").strip() or None
    product = db.add_product(name=name, price=price, barcode=barcode)
    return jsonify(product), 201


@app.route("/api/sales", methods=["POST"])
def api_save_sale():
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not items:
        return jsonify({"error": "items_required"}), 400
    cleaned = []
    for item in items:
        try:
            quantity = float(item["quantity"])
            unit_price = float(item["unit_price"])
            name = str(item["product_name"]).strip()
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "invalid_item"}), 400
        if not name or quantity <= 0 or unit_price < 0:
            return jsonify({"error": "invalid_item"}), 400
        cleaned.append(
            {
                "product_name": name,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": round(quantity * unit_price, 2),
            }
        )
    sale = db.save_sale(cleaned)
    return jsonify(sale), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
