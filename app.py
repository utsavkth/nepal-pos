"""Flask app for the Nepal Grocery POS."""

import csv
import hashlib
import io
import os
import secrets
import uuid
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
    send_from_directory,
    session,
    url_for,
)
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.security import check_password_hash, generate_password_hash

import db
import nepali_date

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

# Product photos live on the HDD next to the databases (data/images/), not in
# the DB — see the "future phase — product images" note in CLAUDE.md. Only the
# filename is stored on the product row; the file is served via /media/<name>.
IMAGES_DIR = os.path.join(db.DATA_DIR, "images")
os.makedirs(IMAGES_DIR, exist_ok=True)
# Cap the upload so a huge photo can't exhaust memory before we resize it.
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024  # 12 MB
IMAGE_MAX_PX = 400  # thumbnails; keeps the cashier fast over Tailscale

CATEGORIES = ["grocery", "weighed", "lpg", "stationery", "cosmetics", "other"]
UNITS = ["kg", "litre", "piece", "packet", "bottle"]
# Units a measured (is_weighed) product can use — drives the quantity pad label.
MEASURE_UNITS = ["kg", "litre"]
# Categories offered for a fixed-price Quick Add (weighed items are categorised
# by the weighed-group picker instead). Extend CATEGORIES / this list to add more.
QUICK_ADD_CATEGORIES = ["grocery", "cosmetics", "stationery", "lpg", "other"]
MIN_PASSWORD_LEN = 8


db.init_db()


@app.template_filter("rs")
def rs_filter(value):
    return f"Rs. {value:,.2f}"


# ---- Static asset cache-busting -------------------------------------------
# The shop's browsers cache style.css/cashier.js hard, so UI updates used to
# need a manual hard refresh after every deploy. Appending a short content
# hash (?v=...) to every url_for('static', ...) URL makes each deploy's
# changed assets fetch fresh automatically, while unchanged files keep their
# cached copy. Hash is keyed by mtime so it's recomputed only when the file
# actually changes on disk.

_static_hash_cache = {}


def _static_file_version(filename):
    path = os.path.join(app.static_folder, filename)
    try:
        mtime = int(os.stat(path).st_mtime)
    except OSError:
        return None
    cached = _static_hash_cache.get(filename)
    if cached and cached[0] == mtime:
        return cached[1]
    with open(path, "rb") as f:
        digest = hashlib.md5(f.read()).hexdigest()[:8]
    _static_hash_cache[filename] = (mtime, digest)
    return digest


@app.url_defaults
def _static_cache_bust(endpoint, values):
    if endpoint == "static" and "filename" in values:
        version = _static_file_version(values["filename"])
        if version:
            values["v"] = version


# ---- Product images -------------------------------------------------------


def _save_product_image(file_storage, product_id):
    """Resize/compress an uploaded photo to a small thumbnail and save it under
    IMAGES_DIR. Returns the stored filename, or None if the file wasn't a valid
    image. A unique filename per save avoids stale browser caches on re-upload."""
    try:
        img = Image.open(file_storage.stream)
        img = ImageOps.exif_transpose(img)  # honour phone photo orientation
    except (UnidentifiedImageError, OSError):
        return None
    img.thumbnail((IMAGE_MAX_PX, IMAGE_MAX_PX))
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    token = uuid.uuid4().hex[:8]
    if has_alpha:  # keep transparency (e.g. background-removed PNGs)
        filename = f"{product_id}-{token}.png"
        img.convert("RGBA").save(os.path.join(IMAGES_DIR, filename), "PNG", optimize=True)
    else:
        filename = f"{product_id}-{token}.jpg"
        img.convert("RGB").save(os.path.join(IMAGES_DIR, filename), "JPEG", quality=82, optimize=True)
    return filename


def _delete_product_image(filename):
    """Remove an image file from disk, ignoring if it's already gone."""
    if not filename:
        return
    try:
        os.remove(os.path.join(IMAGES_DIR, filename))
    except OSError:
        pass


def _handle_product_image_form(product_id, existing_image):
    """Apply the image part of a submitted product form: a new upload replaces the
    old photo; ticking 'remove_image' clears it. No-op if neither was supplied."""
    if request.form.get("remove_image"):
        _delete_product_image(existing_image)
        db.set_product_image(product_id, None)
        return
    file = request.files.get("image")
    if file and file.filename:
        saved = _save_product_image(file, product_id)
        if saved:
            _delete_product_image(existing_image)
            db.set_product_image(product_id, saved)


@app.route("/media/<path:filename>")
def product_image(filename):
    """Serve a product photo from the HDD images directory."""
    return send_from_directory(IMAGES_DIR, filename)


@app.route("/favicon.ico")
def favicon():
    # Browsers request /favicon.ico unconditionally; serve the brand icon
    # instead of a 404 (templates also declare it via <link rel="icon">).
    return send_from_directory(app.static_folder, "favicon.svg")


@app.route("/")
def cashier():
    return render_template("cashier.html")


@app.route("/zebra")
def zebra():
    """Zebra POS v2 — companion cashier UI for the Zebra TC53 handheld.
    Same database and APIs as the main cashier; scanning is DataWedge
    keyboard-wedge into an always-focused input instead of the camera."""
    return render_template("zebra.html")


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
    """Cashier quick-tap buttons: user-defined groups (each with its products)
    plus the individually-pinned products. all_groups lists every active group
    (including empty ones) so Quick Add can offer them."""
    return jsonify({
        "groups": db.get_cashier_groups(),
        "pinned": db.get_pinned_products(),
        "all_groups": db.get_groups(active_only=True),
    })


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
    # Guard against accidental duplicates (same barcode or same name) unless the
    # user has seen the warning and chosen to add it anyway.
    if not data.get("force"):
        dup = db.find_duplicate_product(name, barcode)
        if dup:
            return jsonify({
                "error": "duplicate",
                "existing": {"name": dup["name"], "price": dup["price"], "barcode": dup["barcode"]},
            }), 409
    if data.get("is_weighed"):
        weighed_group = data.get("weighed_group")
        weighed_names = [g["name"] for g in db.get_groups(active_only=True) if g["is_weighed"]]
        if weighed_group not in weighed_names:
            return jsonify({"error": "invalid_weighed_group"}), 400
        unit = data.get("unit") or "kg"
        if unit not in MEASURE_UNITS:
            return jsonify({"error": "invalid_unit"}), 400
        product = db.add_product(
            name=name,
            price=price,  # per kg or per litre
            barcode=barcode,
            category="weighed",
            is_weighed=1,
            unit=unit,
            weighed_group=weighed_group,
        )
    else:
        category = data.get("category") or "other"
        if category not in QUICK_ADD_CATEGORIES:
            category = "other"
        product = db.add_product(
            name=name, price=price, barcode=barcode, category=category,
            pinned=1 if data.get("pinned") else 0,
        )
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
    # Category is filtered server-side (the dropdown auto-submits); the text
    # search is applied live in the browser (static/admin-products.js), so the
    # list here is filtered by category only and `query` just seeds the box.
    products = db.get_products(None, category or None)
    dup_extra_count = sum(len(g["remove"]) for g in db.find_duplicate_groups())
    return render_template(
        "admin_products.html",
        products=products,
        query=query,
        category=category,
        categories=CATEGORIES,
        dup_extra_count=dup_extra_count,
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
    if weighed_group is not None and weighed_group not in db.group_names():
        return None, "Choose a valid quick-tap group."
    name_ne = request.form.get("name_ne", "").strip() or None
    pinned = 1 if request.form.get("pinned") else 0
    return (
        {
            "name": name,
            "barcode": barcode,
            "category": category,
            "price": price,
            "is_weighed": is_weighed,
            "unit": unit,
            "weighed_group": weighed_group,
            "name_ne": name_ne,
            "pinned": pinned,
        },
        None,
    )


@app.route("/admin/products/new", methods=["GET", "POST"])
@admin_required
def admin_product_new():
    error = None
    duplicate = None
    if request.method == "POST":
        fields, error = _parse_product_form()
        if not error:
            # Warn on a likely duplicate unless "add anyway" was ticked.
            if not request.form.get("confirm_duplicate"):
                duplicate = db.find_duplicate_product(fields["name"], fields["barcode"])
            if not duplicate:
                product = db.add_product(**fields)
                _handle_product_image_form(product["id"], None)
                flash(f"Added {fields['name']}.")
                return redirect(url_for("admin_products"))
    return render_template(
        "admin_product_form.html",
        product=request.form if request.method == "POST" else None,
        error=error,
        duplicate=duplicate,
        categories=CATEGORIES,
        units=UNITS,
        groups=db.get_groups(active_only=True),
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
            _handle_product_image_form(product_id, product["image_path"])
            flash(f"Saved {fields['name']}.")
            return redirect(url_for("admin_products"))
        product = dict(product, **request.form)
    return render_template(
        "admin_product_form.html",
        product=product,
        error=error,
        categories=CATEGORIES,
        units=UNITS,
        groups=db.get_groups(active_only=True),
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


@app.route("/admin/products/<int:product_id>/delete", methods=["POST"])
@admin_required
def admin_product_delete(product_id):
    product = db.get_product(product_id)
    if not product:
        return "Product not found.", 404
    db.delete_product(product_id)
    _delete_product_image(product.get("image_path"))
    flash(f"Permanently deleted {product['name']}.")
    return redirect(url_for("admin_products", q=request.args.get("q", ""), category=request.args.get("category", "")))


@app.route("/admin/duplicates")
@admin_required
def admin_duplicates():
    groups = db.find_duplicate_groups()
    extra_count = sum(len(g["remove"]) for g in groups)
    return render_template("admin_duplicates.html", groups=groups, extra_count=extra_count)


@app.route("/admin/duplicates/cleanup", methods=["POST"])
@admin_required
def admin_duplicates_cleanup():
    removed = db.remove_duplicate_products()
    flash(f"Removed {removed} duplicate {'copy' if removed == 1 else 'copies'} (kept one of each).")
    return redirect(url_for("admin_products"))


# ---- Cashier button groups (user-defined) ----


def _parse_group_form(group_id=None):
    name = request.form.get("name", "").strip()
    name_ne = request.form.get("name_ne", "").strip() or None
    is_weighed = 1 if request.form.get("is_weighed") else 0
    try:
        sort_order = int(request.form.get("sort_order", "0") or 0)
    except ValueError:
        return None, "Order must be a whole number."
    if not name:
        return None, "Name is required."
    existing = db.get_group_by_name(name)
    if existing and existing["id"] != group_id:
        return None, f'A group named "{name}" already exists.'
    return {"name": name, "name_ne": name_ne, "is_weighed": is_weighed, "sort_order": sort_order}, None


@app.route("/admin/groups")
@admin_required
def admin_groups():
    return render_template(
        "admin_groups.html", groups=db.get_groups(), counts=db.group_product_counts()
    )


@app.route("/admin/groups/new", methods=["GET", "POST"])
@admin_required
def admin_group_new():
    error = None
    if request.method == "POST":
        fields, error = _parse_group_form()
        if not error:
            db.add_group(**fields)
            flash(f"Added group {fields['name']}.")
            return redirect(url_for("admin_groups"))
    return render_template(
        "admin_group_form.html",
        group=request.form if request.method == "POST" else None,
        error=error,
        mode="new",
    )


@app.route("/admin/groups/<int:group_id>/edit", methods=["GET", "POST"])
@admin_required
def admin_group_edit(group_id):
    group = db.get_group(group_id)
    if not group:
        return "Group not found.", 404
    error = None
    if request.method == "POST":
        fields, error = _parse_group_form(group_id=group_id)
        if not error:
            db.update_group(group_id, **fields)
            flash(f"Saved group {fields['name']}.")
            return redirect(url_for("admin_groups"))
        group = dict(group, **request.form)
    return render_template("admin_group_form.html", group=group, error=error, mode="edit")


@app.route("/admin/groups/<int:group_id>/active", methods=["POST"])
@admin_required
def admin_group_active(group_id):
    group = db.get_group(group_id)
    if not group:
        return "Group not found.", 404
    make_active = request.form.get("active") == "1"
    db.set_group_active(group_id, make_active)
    flash(f"{'Showing' if make_active else 'Hid'} group {group['name']}.")
    return redirect(url_for("admin_groups"))


@app.route("/admin/groups/<int:group_id>/delete", methods=["POST"])
@admin_required
def admin_group_delete(group_id):
    group = db.get_group(group_id)
    if not group:
        return "Group not found.", 404
    db.delete_group(group_id)
    flash(f"Deleted group {group['name']} — its products were kept, just un-grouped.")
    return redirect(url_for("admin_groups"))


@app.route("/admin/reports")
@admin_required
def admin_reports():
    daily = db.get_daily_totals(limit=31)
    for r in daily:
        r["bs"] = nepali_date.bs_date_label(r["date"])  # BS date shown per day

    all_days = db.get_all_daily_totals()
    weeks = {}
    months = {}
    months_bs = {}  # grouped by Bikram Sambat month (e.g. "2083 Asar")
    for row in all_days:
        d = date_cls.fromisoformat(row["date"])
        iso = d.isocalendar()
        week_key = f"{iso.year}-W{iso.week:02d}"
        month_key = row["date"][:7]
        for bucket, key in ((weeks, week_key), (months, month_key)):
            entry = bucket.setdefault(key, {"sales_count": 0, "total": 0.0})
            entry["sales_count"] += row["sales_count"]
            entry["total"] += row["total"]
        bs_key = nepali_date.bs_month_key(row["date"])
        if bs_key:
            sort_key, label = bs_key
            entry = months_bs.setdefault(sort_key, {"sales_count": 0, "total": 0.0, "period": label})
            entry["sales_count"] += row["sales_count"]
            entry["total"] += row["total"]

    weekly = [dict(period=k, **v) for k, v in sorted(weeks.items(), reverse=True)][:12]
    monthly = [dict(period=k, **v) for k, v in sorted(months.items(), reverse=True)][:12]
    monthly_bs = [v for _, v in sorted(months_bs.items(), reverse=True)][:12]
    return render_template(
        "admin_reports.html", daily=daily, weekly=weekly, monthly=monthly, monthly_bs=monthly_bs
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
                        name_ne = (row.get("name_ne") or "").strip() or None  # optional column
                        raw_pinned = (row.get("pinned") or "").strip().lower()  # optional column
                        pinned = 1 if raw_pinned in ("1", "true", "yes") else 0
                        outcome = db.import_product_row(barcode, name, category, price, is_weighed, unit, name_ne=name_ne, pinned=pinned)
                        if outcome == "updated":
                            updated += 1
                        else:
                            inserted += 1
                    result = {"inserted": inserted, "updated": updated, "failed": len(errors)}
    return render_template("admin_import.html", result=result, errors=errors)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
