"""Flask app for the Nepal Grocery POS."""

import csv
import io
import os
import secrets
from datetime import date as date_cls
from functools import wraps

from flask import (
    Flask,
    Response,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

import db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

CATEGORIES = ["grocery", "weighed", "lpg", "stationery", "other"]
UNITS = ["kg", "piece", "packet", "bottle"]
MIN_PASSWORD_LEN = 8


db.init_db()


@app.template_filter("rs")
def rs_filter(value):
    return f"Rs. {value:,.2f}"


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
    products = db.get_quick_tap_products()
    groups = []
    for label in db.WEIGHED_GROUPS:
        matches = [
            p
            for p in products
            if p["category"] == "weighed" and (p["weighed_group"] or "Other") == label
        ]
        groups.append({"label": label, "products": matches})
    lpg = [p for p in products if p["category"] == "lpg"]
    return jsonify({"groups": groups, "lpg": lpg})


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
    if data.get("is_weighed"):
        weighed_group = data.get("weighed_group")
        if weighed_group not in db.WEIGHED_GROUPS:
            return jsonify({"error": "invalid_weighed_group"}), 400
        product = db.add_product(
            name=name,
            price=price,  # per kg
            barcode=barcode,
            category="weighed",
            is_weighed=1,
            unit="kg",
            weighed_group=weighed_group,
        )
    else:
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


# ---- Admin panel ----


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not db.is_admin_password_set():
            return redirect(url_for("admin_setup"))
        if not session.get("admin"):
            return redirect(url_for("admin_login", next=request.path))
        return view(*args, **kwargs)

    return wrapper


def _validate_new_password(pw, confirm):
    """Return an error string for an invalid new password, or None if valid."""
    if len(pw) < MIN_PASSWORD_LEN:
        return f"Password must be at least {MIN_PASSWORD_LEN} characters."
    if pw != confirm:
        return "Passwords do not match."
    return None


@app.route("/admin/setup", methods=["GET", "POST"])
def admin_setup():
    # Only reachable until a password exists; afterwards, go to the login form.
    if db.is_admin_password_set():
        return redirect(url_for("admin_login"))
    error = None
    if request.method == "POST":
        pw = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        error = _validate_new_password(pw, confirm)
        if not error:
            db.set_admin_password_hash(generate_password_hash(pw))
            session["admin"] = True
            flash("Admin password set. You're logged in.")
            return redirect(url_for("admin_products"))
    return render_template("admin_setup.html", error=error, min_len=MIN_PASSWORD_LEN)


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if not db.is_admin_password_set():
        return redirect(url_for("admin_setup"))
    error = None
    if request.method == "POST":
        supplied = request.form.get("password", "")
        if check_password_hash(db.get_admin_password_hash(), supplied):
            session["admin"] = True
            next_url = request.args.get("next") or url_for("admin_products")
            if not next_url.startswith("/"):
                next_url = url_for("admin_products")
            return redirect(next_url)
        error = "Wrong password."
    return render_template("admin_login.html", error=error)


@app.route("/admin/logout")
def admin_logout():
    session.pop("admin", None)
    return redirect(url_for("admin_login"))


@app.route("/admin/change-password", methods=["GET", "POST"])
@admin_required
def admin_change_password():
    error = None
    if request.method == "POST":
        current = request.form.get("current", "")
        pw = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        if not check_password_hash(db.get_admin_password_hash(), current):
            error = "Current password is wrong."
        else:
            error = _validate_new_password(pw, confirm)
            if not error:
                db.set_admin_password_hash(generate_password_hash(pw))
                flash("Password changed.")
                return redirect(url_for("admin_products"))
    return render_template("admin_change_password.html", error=error, min_len=MIN_PASSWORD_LEN)


@app.route("/admin")
@admin_required
def admin_home():
    return redirect(url_for("admin_products"))


@app.route("/admin/products")
@admin_required
def admin_products():
    query = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    if category not in CATEGORIES:
        category = ""
    products = db.get_products(query or None, category or None)
    return render_template(
        "admin_products.html",
        products=products,
        query=query,
        category=category,
        categories=CATEGORIES,
    )


def _parse_product_form():
    """Validate the product form. Returns (fields, error)."""
    name = request.form.get("name", "").strip()
    barcode = request.form.get("barcode", "").strip() or None
    category = request.form.get("category", "")
    unit = request.form.get("unit", "")
    is_weighed = 1 if request.form.get("is_weighed") else 0
    try:
        price = float(request.form.get("price", ""))
    except ValueError:
        return None, "Price must be a number."
    if not name:
        return None, "Name is required."
    if category not in CATEGORIES:
        return None, "Choose a valid category."
    if unit not in UNITS:
        return None, "Choose a valid unit."
    if price <= 0:
        return None, "Price must be greater than zero."
    weighed_group = request.form.get("weighed_group", "").strip() or None
    if weighed_group is not None and weighed_group not in db.WEIGHED_GROUPS:
        return None, "Choose a valid quick-tap group."
    return (
        {
            "name": name,
            "barcode": barcode,
            "category": category,
            "price": price,
            "is_weighed": is_weighed,
            "unit": unit,
            "weighed_group": weighed_group,
        },
        None,
    )


@app.route("/admin/products/new", methods=["GET", "POST"])
@admin_required
def admin_product_new():
    error = None
    if request.method == "POST":
        fields, error = _parse_product_form()
        if not error:
            db.add_product(**fields)
            flash(f"Added {fields['name']}.")
            return redirect(url_for("admin_products"))
    return render_template(
        "admin_product_form.html",
        product=request.form if request.method == "POST" else None,
        error=error,
        categories=CATEGORIES,
        units=UNITS,
        weighed_groups=db.WEIGHED_GROUPS,
        mode="new",
    )


@app.route("/admin/products/<int:product_id>/edit", methods=["GET", "POST"])
@admin_required
def admin_product_edit(product_id):
    product = db.get_product(product_id)
    if not product:
        return "Product not found.", 404
    error = None
    if request.method == "POST":
        fields, error = _parse_product_form()
        if not error:
            db.update_product(product_id, **fields)
            flash(f"Saved {fields['name']}.")
            return redirect(url_for("admin_products"))
        product = dict(product, **request.form)
    return render_template(
        "admin_product_form.html",
        product=product,
        error=error,
        categories=CATEGORIES,
        units=UNITS,
        weighed_groups=db.WEIGHED_GROUPS,
        mode="edit",
    )


@app.route("/admin/products/<int:product_id>/active", methods=["POST"])
@admin_required
def admin_product_active(product_id):
    product = db.get_product(product_id)
    if not product:
        return "Product not found.", 404
    make_active = request.form.get("active") == "1"
    db.set_product_active(product_id, make_active)
    flash(f"{'Reactivated' if make_active else 'Deactivated'} {product['name']}.")
    return redirect(url_for("admin_products", q=request.args.get("q", ""), category=request.args.get("category", "")))


@app.route("/admin/reports")
@admin_required
def admin_reports():
    daily = db.get_daily_totals(limit=31)

    all_days = db.get_all_daily_totals()
    weeks = {}
    months = {}
    for row in all_days:
        d = date_cls.fromisoformat(row["date"])
        iso = d.isocalendar()
        week_key = f"{iso.year}-W{iso.week:02d}"
        month_key = row["date"][:7]
        for bucket, key in ((weeks, week_key), (months, month_key)):
            entry = bucket.setdefault(key, {"sales_count": 0, "total": 0.0})
            entry["sales_count"] += row["sales_count"]
            entry["total"] += row["total"]

    weekly = [dict(period=k, **v) for k, v in sorted(weeks.items(), reverse=True)][:12]
    monthly = [dict(period=k, **v) for k, v in sorted(months.items(), reverse=True)][:12]
    return render_template(
        "admin_reports.html", daily=daily, weekly=weekly, monthly=monthly
    )


@app.route("/admin/sales/export.csv")
@admin_required
def admin_sales_export():
    rows = db.get_sales_export_rows()
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        ["sale_id", "date", "time", "product_name", "quantity", "unit_price", "line_total", "sale_total"]
    )
    for r in rows:
        writer.writerow(
            [r["sale_id"], r["date"], r["time"], r["product_name"], r["quantity"], r["unit_price"], r["line_total"], r["sale_total"]]
        )
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=sales-export.csv"},
    )


@app.route("/admin/import", methods=["GET", "POST"])
@admin_required
def admin_import():
    """Bulk product import. CSV columns: barcode,name,category,price,is_weighed,unit."""
    result = None
    errors = []
    if request.method == "POST":
        file = request.files.get("file")
        if not file or not file.filename:
            errors.append("Choose a CSV file first.")
        else:
            try:
                text = file.read().decode("utf-8-sig")
            except UnicodeDecodeError:
                text = ""
                errors.append("File is not valid UTF-8 text.")
            if not errors:
                reader = csv.DictReader(io.StringIO(text))
                expected = {"barcode", "name", "category", "price", "is_weighed", "unit"}
                if not reader.fieldnames or not expected.issubset(set(reader.fieldnames)):
                    errors.append(
                        "CSV header must be: barcode,name,category,price,is_weighed,unit"
                    )
                else:
                    inserted = updated = 0
                    for line_no, row in enumerate(reader, start=2):
                        name = (row.get("name") or "").strip()
                        barcode = (row.get("barcode") or "").strip() or None
                        category = (row.get("category") or "").strip()
                        unit = (row.get("unit") or "").strip()
                        raw_weighed = (row.get("is_weighed") or "").strip().lower()
                        is_weighed = 1 if raw_weighed in ("1", "true", "yes") else 0
                        try:
                            price = float(row.get("price") or "")
                        except ValueError:
                            errors.append(f"Line {line_no}: bad price.")
                            continue
                        if not name or category not in CATEGORIES or unit not in UNITS or price <= 0:
                            errors.append(f"Line {line_no}: missing name, or invalid category/unit/price.")
                            continue
                        outcome = db.import_product_row(barcode, name, category, price, is_weighed, unit)
                        if outcome == "updated":
                            updated += 1
                        else:
                            inserted += 1
                    result = {"inserted": inserted, "updated": updated, "failed": len(errors)}
    return render_template("admin_import.html", result=result, errors=errors)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
