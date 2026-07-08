/* Cashier screen logic: search, quick taps, bill, quick add, price override, new sale. */
"use strict";

const bill = []; // { product_name, quantity, unit_price, original_price, is_weighed, unit }

function formatRs(n) {
  return "Rs. " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineTotal(line) {
  return Math.round(line.quantity * line.unit_price * 100) / 100;
}

/* Measured (is_weighed) products are sold per kg or per litre — the product's
   `unit` decides every label (pad, price suffixes, bill line). kg is the
   default for anything older that predates the litre unit. */
function unitName(unit) {
  return unit === "litre" ? t("litre") : t("kg");
}
function perUnit(unit) {
  return unit === "litre" ? t("perLitre") : t("perKg");
}
function perUnitSuffix(unit) {
  return unit === "litre" ? t("perLitreSuffix") : t("perKgSuffix");
}

/* Optional product photo thumbnail. Returns an <img> element when the product
   has an image_path, otherwise null so callers just show text as before. */
function productThumb(p, className = "thumb") {
  if (!p || !p.image_path) return null;
  const img = document.createElement("img");
  img.className = className;
  img.src = "/media/" + encodeURIComponent(p.image_path);
  img.alt = "";
  img.loading = "lazy";
  return img;
}

function showToast(msg, ms = 1800) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
}

/* ---- Bill rendering ---- */

function renderBill() {
  const list = document.getElementById("bill-lines");
  list.innerHTML = "";
  bill.forEach((line, idx) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "bill-line-info";
    const name = document.createElement("div");
    name.className = "bill-line-name";
    name.textContent = productDisplayName(line.product_name, line.name_ne);
    const detail = document.createElement("div");
    detail.className = "bill-line-detail";
    const per = line.is_weighed ? perUnit(line.unit) : "";
    let detailText = line.is_weighed
      ? `${line.quantity} ${unitName(line.unit)} × ${formatRs(line.unit_price)}${per}`
      : `${line.quantity} × ${formatRs(line.unit_price)}`;
    if (line.unit_price !== line.original_price) {
      detailText += ` (${t("was")}${formatRs(line.original_price)}${per})`;
      detail.classList.add("overridden");
    }
    detail.textContent = detailText;
    info.append(name, detail);

    const total = document.createElement("span");
    total.className = "bill-line-total";
    total.textContent = formatRs(lineTotal(line));

    const edit = document.createElement("button");
    edit.className = "bill-line-edit";
    edit.type = "button";
    edit.setAttribute("aria-label", "Change price of " + line.product_name);
    edit.textContent = "✎";
    edit.addEventListener("click", () => openPriceOverride(idx));

    const remove = document.createElement("button");
    remove.className = "bill-line-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + line.product_name);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      bill.splice(idx, 1);
      renderBill();
    });

    li.append(info, total, edit, remove);
    list.appendChild(li);
  });

  const total = bill.reduce((sum, l) => sum + lineTotal(l), 0);
  document.getElementById("bill-total").textContent = formatRs(total);
  document.getElementById("new-sale-btn").disabled = bill.length === 0;
  document.getElementById("clear-bill-btn").disabled = bill.length === 0;
}

function billTotal() {
  return bill.reduce((sum, l) => sum + lineTotal(l), 0);
}

function addToBill(product, quantity) {
  if (!product.is_weighed) {
    const existing = bill.find(
      (l) =>
        l.product_name === product.name &&
        l.unit_price === product.price &&
        l.unit_price === l.original_price &&
        !l.is_weighed
    );
    if (existing) {
      existing.quantity += quantity;
      renderBill();
      return;
    }
  }
  bill.push({
    product_name: product.name,     // canonical English — saved on the sale
    name_ne: product.name_ne || null, // optional Nepali display name
    quantity: quantity,
    unit_price: product.price,
    original_price: product.price,
    is_weighed: !!product.is_weighed,
    unit: product.unit,
  });
  renderBill();
}

/* ---- Search ---- */

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch("/api/products/search?q=" + encodeURIComponent(q));
      const products = await res.json();
      renderSearchResults(products);
    } catch {
      showToast(t("searchFailed"));
    }
  }, 150);
});

function renderSearchResults(products) {
  searchResults.innerHTML = "";
  searchResults.hidden = false;
  if (products.length === 0) {
    // Not found — offer to add it. If the typed text looks like a barcode
    // (8+ digits, e.g. a number typed in because the camera wouldn't scan),
    // open Quick Add with that barcode attached so the product still gets it.
    const q = searchInput.value.trim();
    const li = document.createElement("li");
    li.className = "no-results add-not-found";
    li.textContent = t("noResults");
    li.addEventListener("click", () => {
      searchInput.value = "";
      searchResults.hidden = true;
      searchResults.innerHTML = "";
      if (/^\d{8,}$/.test(q)) {
        openQuickAdd(q); // treat as a barcode
      } else {
        openQuickAdd(null, q); // treat as a product name
      }
    });
    searchResults.appendChild(li);
    return;
  }
  products.forEach((p) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = productDisplayName(p.name, p.name_ne);
    const price = document.createElement("span");
    price.className = "result-price";
    price.textContent = formatRs(p.price) + (p.is_weighed ? perUnit(p.unit) : "");
    const thumb = productThumb(p, "result-thumb");
    if (thumb) li.appendChild(thumb);
    li.append(name, price);
    li.addEventListener("click", () => {
      if (p.is_weighed) {
        openWeightPad(p);
      } else {
        addToBill(p, 1);
      }
      searchInput.value = "";
      searchResults.hidden = true;
      searchResults.innerHTML = "";
    });
    searchResults.appendChild(li);
  });
}

/* ---- Quick-tap buttons: weighed-goods category buttons + LPG one-tap ---- */

/* Simple inline SVG icons for the category tiles. Unlike emoji (which didn't
   render on the shop's devices) these draw identically everywhere. They inherit
   colour via currentColor, set per tile type in the CSS. */
const TAP_ICONS = {
  Rice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z"/><path d="M7 8.6c.4-.8 1.2-1.1 2-.9M11 7.4c.5-.8 1.4-1.1 2.2-.8"/></svg>',
  Dal: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><ellipse cx="8.5" cy="10" rx="3.1" ry="2.05"/><ellipse cx="15" cy="9" rx="3.1" ry="2.05"/><ellipse cx="12" cy="15" rx="3.1" ry="2.05"/></svg>',
  Sugar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5.5" y="5.5" width="13" height="13" rx="1.6"/><path d="M5.5 11h13M11 5.5v13"/></svg>',
  Flour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7.5c-1.2 0-2 1-2.4 2.8L4.6 19h14.8l-1-8.7C18 8.5 17.2 7.5 16 7.5Z"/><path d="M8.4 7.5h7.2"/></svg>',
  Other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5h15l-1.4 9H5.9Z"/><path d="M8.6 9.5 10.5 4.6M15.4 9.5 13.5 4.6"/></svg>',
  LPG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5v8.6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1Z"/><path d="M10.4 5.4V4h3.2v1.4"/></svg>',
};
function tapIcon(label) {
  return TAP_ICONS[label] || TAP_ICONS.Other;
}

/* The "media" square on a tile: the product photo when it has one, otherwise a
   white letter badge (first letter, dark-on-white) so every tile looks
   consistent whether or not a photo has been added. Emoji were dropped — they
   render inconsistently across the shop's devices (Chromebook + older iPhones,
   where several didn't show at all). */
function tapMedia(product) {
  const media = document.createElement("span");
  media.className = "tap-media";
  if (product && product.image_path) {
    const img = document.createElement("img");
    img.className = "tap-media-img";
    img.src = "/media/" + encodeURIComponent(product.image_path);
    img.alt = "";
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    const name = product && product.name ? product.name.trim() : "";
    media.classList.add("letter");
    media.textContent = name ? name.charAt(0).toUpperCase() : "•";
  }
  return media;
}

/* Build a one-tap product tile (LPG or pinned) that adds the item on tap. */
function productTapTile(p, colorClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tap " + colorClass;
  const name = document.createElement("span");
  name.className = "tap-name";
  name.textContent = productDisplayName(p.name, p.name_ne);
  const price = document.createElement("span");
  price.className = "tap-sub";
  price.textContent = formatRs(p.price);
  btn.append(tapMedia(p), name, price);
  btn.addEventListener("click", () => {
    addToBill(p, 1);
    showToast(productDisplayName(p.name, p.name_ne) + t("added"));
  });
  return btn;
}

async function loadQuickTaps() {
  try {
    const res = await fetch("/api/products/quick-taps");
    const data = await res.json();
    populateQuickAddGroups(data.all_groups || []);
    const container = document.getElementById("quick-taps");
    container.innerHTML = "";
    // User-defined groups. Weighed groups (green) open a variety list then the
    // weight pad; fixed groups (orange) open a list you tap to add. A known name
    // gets an SVG icon; anything custom gets a letter badge.
    data.groups.forEach((group) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tap " + (group.is_weighed ? "tap-weighed" : "tap-lpg");
      const media = document.createElement("span");
      const icon = TAP_ICONS[group.name];
      if (icon) {
        media.className = "tap-media icon";
        media.innerHTML = icon;
      } else {
        media.className = "tap-media letter";
        media.textContent = (group.name || "?").trim().charAt(0).toUpperCase();
      }
      const name = document.createElement("span");
      name.className = "tap-name";
      name.textContent = productDisplayName(group.name, group.name_ne);
      const sub = document.createElement("span");
      sub.className = "tap-sub";
      const n = group.products.length;
      sub.textContent = n === 1 ? t("oneVariety") : n + " " + t("varieties");
      btn.append(media, name, sub);
      btn.addEventListener("click", () => openVarietyList(group));
      container.appendChild(btn);
    });
    // Pinned products — one-tap fixed-price buttons the shop chose to show here.
    (data.pinned || []).forEach((p) => {
      container.appendChild(productTapTile(p, "tap-pinned"));
    });
  } catch {
    showToast(t("couldNotLoadQuick"));
  }
}

/* ---- Variety picker (category button -> specific product -> weight pad) ---- */

const varietyModal = document.getElementById("variety-modal");

function openVarietyList(group) {
  const label = productDisplayName(group.name, group.name_ne);
  document.getElementById("variety-title").textContent = label;
  const list = document.getElementById("variety-list");
  list.innerHTML = "";
  if (group.products.length === 0) {
    const li = document.createElement("li");
    li.className = "variety-empty";
    li.textContent = t("noVarieties1") + label + t("noVarieties2");
    list.appendChild(li);
  }
  group.products.forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const name = document.createElement("span");
    name.textContent = productDisplayName(p.name, p.name_ne);
    const price = document.createElement("span");
    price.className = "result-price";
    price.textContent = formatRs(p.price) + (p.is_weighed ? perUnit(p.unit) : "");
    const thumb = productThumb(p, "variety-thumb");
    if (thumb) btn.appendChild(thumb);
    btn.append(name, price);
    btn.addEventListener("click", () => {
      varietyModal.hidden = true;
      if (p.is_weighed) {
        openWeightPad(p);
      } else {
        // Fixed-price item (e.g. a gas cylinder): straight onto the bill.
        addToBill(p, 1);
        showToast(productDisplayName(p.name, p.name_ne) + t("added"));
      }
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
  varietyModal.hidden = false;
}

document.getElementById("variety-cancel").addEventListener("click", () => {
  varietyModal.hidden = true;
});

/* ---- Weight pad ---- */

const weightModal = document.getElementById("weight-modal");
let weightProduct = null;
let weightStr = "";

function openWeightPad(product) {
  weightProduct = product;
  weightStr = "";
  document.getElementById("weight-title").textContent =
    productDisplayName(product.name, product.name_ne) + " — " + formatRs(product.price) + perUnit(product.unit);
  document.getElementById("weight-unit").textContent = unitName(product.unit);
  updateWeightDisplay();
  weightModal.hidden = false;
}

function updateWeightDisplay() {
  const kg = parseFloat(weightStr) || 0;
  document.getElementById("weight-value").textContent = weightStr || "0";
  document.getElementById("weight-line-total").textContent =
    formatRs(Math.round(kg * weightProduct.price * 100) / 100);
  document.getElementById("weight-ok").disabled = kg <= 0;
}

document.querySelectorAll("#weight-modal .numpad button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    if (key === "del") {
      weightStr = weightStr.slice(0, -1);
    } else if (key === ".") {
      if (!weightStr.includes(".")) weightStr = (weightStr || "0") + ".";
    } else {
      const next = weightStr + key;
      // max 3 decimals, keep the number sane
      const parts = next.split(".");
      if (parts[0].length > 3 || (parts[1] || "").length > 3) return;
      weightStr = next;
    }
    updateWeightDisplay();
  });
});

document.getElementById("weight-cancel").addEventListener("click", () => {
  weightModal.hidden = true;
});

document.getElementById("weight-ok").addEventListener("click", () => {
  const kg = parseFloat(weightStr);
  if (kg > 0) {
    addToBill(weightProduct, kg);
    weightModal.hidden = true;
  }
});

/* ---- Price override (this sale only — never touches the stored product price) ---- */

const priceModal = document.getElementById("price-modal");
let priceLineIndex = null;
let priceStr = "";

function openPriceOverride(index) {
  priceLineIndex = index;
  priceStr = "";
  const line = bill[index];
  const per = line.is_weighed ? perUnit(line.unit) : "";
  document.getElementById("price-title").textContent = productDisplayName(line.product_name, line.name_ne);
  document.getElementById("price-current").textContent =
    t("currentPrice") + formatRs(line.unit_price) + per +
    (line.unit_price !== line.original_price
      ? " (" + t("normalPrice") + formatRs(line.original_price) + per + ")"
      : "");
  document.getElementById("price-unit-suffix").textContent = line.is_weighed ? perUnitSuffix(line.unit) : "";
  updatePriceDisplay();
  priceModal.hidden = false;
}

function updatePriceDisplay() {
  document.getElementById("price-value").textContent = priceStr || "0";
  // allow 0 (free / full discount); disable only while empty
  document.getElementById("price-ok").disabled = priceStr === "";
}

document.querySelectorAll("#price-modal .numpad button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    if (key === "del") {
      priceStr = priceStr.slice(0, -1);
    } else if (key === ".") {
      if (!priceStr.includes(".")) priceStr = (priceStr || "0") + ".";
    } else {
      const next = priceStr + key;
      const parts = next.split(".");
      if (parts[0].length > 5 || (parts[1] || "").length > 2) return;
      priceStr = next;
    }
    updatePriceDisplay();
  });
});

document.getElementById("price-cancel").addEventListener("click", () => {
  priceModal.hidden = true;
});

document.getElementById("price-ok").addEventListener("click", () => {
  const newPrice = parseFloat(priceStr);
  if (priceLineIndex !== null && !Number.isNaN(newPrice)) {
    bill[priceLineIndex].unit_price = newPrice;
    renderBill();
    priceModal.hidden = true;
  }
});

/* ---- Quick Add ---- */

const quickAddModal = document.getElementById("quick-add-modal");
let quickAddBarcode = null;

const quickAddWeighed = document.getElementById("quick-add-weighed");
const quickAddGroupField = document.getElementById("quick-add-group-field");
const quickAddCategoryField = document.getElementById("quick-add-category-field");
const quickAddGroupSelect = document.getElementById("quick-add-group");
const quickAddCategorySelect = document.getElementById("quick-add-category");
const quickAddPriceLabel = document.getElementById("quick-add-price-label");
const quickAddUnitField = document.getElementById("quick-add-unit-field");
const quickAddUnitSelect = document.getElementById("quick-add-unit");

/* Fill the Quick Add weighed-group dropdown from the active weighed groups, so a
   new variety can be filed under any group the shop has created (not a fixed
   list). Called whenever quick-taps load / the language changes. */
function populateQuickAddGroups(allGroups) {
  const weighed = (allGroups || []).filter((g) => g.is_weighed);
  const prev = quickAddGroupSelect.value;
  quickAddGroupSelect.innerHTML = "";
  weighed.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.name;
    opt.textContent = productDisplayName(g.name, g.name_ne);
    quickAddGroupSelect.appendChild(opt);
  });
  if (prev && weighed.some((g) => g.name === prev)) quickAddGroupSelect.value = prev;
}

/* Both pickers stay visible; the one that doesn't apply is greyed out.
   Weighed ticked -> weighed category active, regular category disabled.
   Unticked -> the reverse. */
function updateQuickAddPickers() {
  const weighed = quickAddWeighed.checked;
  quickAddGroupSelect.disabled = !weighed;
  quickAddUnitSelect.disabled = !weighed;
  quickAddCategorySelect.disabled = weighed;
  quickAddGroupField.classList.toggle("field-disabled", !weighed);
  quickAddUnitField.classList.toggle("field-disabled", !weighed);
  quickAddCategoryField.classList.toggle("field-disabled", weighed);
  quickAddPriceLabel.textContent = weighed
    ? (quickAddUnitSelect.value === "litre" ? t("pricePerLitre") : t("pricePerKg"))
    : t("price");
  // Pinning is for fixed-price items only (weighed items get category buttons).
  const pinnedInput = document.getElementById("quick-add-pinned");
  document.getElementById("quick-add-pinned-field").classList.toggle("field-disabled", weighed);
  pinnedInput.disabled = weighed;
  if (weighed) pinnedInput.checked = false;
}

quickAddWeighed.addEventListener("change", updateQuickAddPickers);
quickAddUnitSelect.addEventListener("change", updateQuickAddPickers);

function openQuickAdd(barcode = null, prefillName = "") {
  quickAddBarcode = barcode;
  const note = document.getElementById("quick-add-barcode-note");
  if (barcode) {
    note.textContent = t("newBarcode1") + barcode + t("newBarcode2");
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  document.getElementById("quick-add-name").value = prefillName;
  document.getElementById("quick-add-price").value = "";
  quickAddWeighed.checked = false;
  quickAddUnitSelect.value = "kg";
  if (quickAddGroupSelect.options.length) quickAddGroupSelect.selectedIndex = 0;
  quickAddCategorySelect.value = "grocery";
  document.getElementById("quick-add-pinned").checked = false;
  updateQuickAddPickers();
  quickAddModal.hidden = false;
  document.getElementById("quick-add-name").focus();
}

document.getElementById("quick-add-btn").addEventListener("click", () => openQuickAdd());
document.getElementById("quick-add-cancel").addEventListener("click", () => {
  quickAddModal.hidden = true;
});

const duplicateModal = document.getElementById("duplicate-modal");

async function saveQuickAddProduct(force) {
  const name = document.getElementById("quick-add-name").value.trim();
  const price = parseFloat(document.getElementById("quick-add-price").value);
  if (!name || !(price > 0)) {
    showToast(t("enterNamePrice"));
    return;
  }
  try {
    const res = await fetch("/api/products/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        price,
        barcode: quickAddBarcode,
        is_weighed: quickAddWeighed.checked,
        unit: quickAddWeighed.checked ? quickAddUnitSelect.value : null,
        weighed_group: quickAddWeighed.checked
          ? document.getElementById("quick-add-group").value
          : null,
        category: quickAddWeighed.checked
          ? null
          : document.getElementById("quick-add-category").value,
        pinned: !quickAddWeighed.checked && document.getElementById("quick-add-pinned").checked,
        force: !!force,
      }),
    });
    if (res.status === 409) {
      const data = await res.json();
      showDuplicateWarning(data.existing);
      return;
    }
    if (!res.ok) throw new Error();
    const product = await res.json();
    duplicateModal.hidden = true;
    quickAddModal.hidden = true;
    loadQuickTaps(); // a new weighed variety should appear on its category button
    if (product.is_weighed) {
      showToast(productDisplayName(product.name, product.name_ne) +
        (product.unit === "litre" ? t("savedEnterVolume") : t("savedEnterWeight")));
      openWeightPad(product);
    } else {
      addToBill(product, 1);
      showToast(productDisplayName(product.name, product.name_ne) + t("savedAndAdded"));
    }
  } catch {
    showToast(t("couldNotSaveItem"));
  }
}

function showDuplicateWarning(existing) {
  document.getElementById("dup-existing").textContent =
    `${existing.name} — ${formatRs(existing.price)}` +
    (existing.barcode ? ` · ${existing.barcode}` : "") + ` (${t("dupAlreadyExists")})`;
  duplicateModal.hidden = false;
}

document.getElementById("quick-add-save").addEventListener("click", () => saveQuickAddProduct(false));
document.getElementById("dup-cancel").addEventListener("click", () => { duplicateModal.hidden = true; });
document.getElementById("dup-add-anyway").addEventListener("click", () => {
  duplicateModal.hidden = true;
  saveQuickAddProduct(true);
});

/* ---- Scanner ---- */

/* Called with every successfully decoded barcode. A not-found barcode
   auto-opens Quick Add with the barcode attached — staff never have to
   notice the miss and open the form themselves. */
async function handleScannedBarcode(barcode) {
  try {
    const res = await fetch("/api/products/barcode/" + encodeURIComponent(barcode));
    if (res.status === 404) {
      showToast(t("notInSystem"), 2200);
      openQuickAdd(barcode);
      return;
    }
    const product = await res.json();
    if (product.is_weighed) {
      openWeightPad(product);
    } else {
      addToBill(product, 1);
      showToast(productDisplayName(product.name, product.name_ne) + t("added"));
    }
  } catch {
    showToast(t("lookupFailed"));
  }
}

document.getElementById("scan-btn").addEventListener("click", () => {
  startScanner(handleScannedBarcode);
});

/* ---- Clear bill (one tap, no save) ---- */

document.getElementById("clear-bill-btn").addEventListener("click", () => {
  if (bill.length === 0) return;
  bill.length = 0;
  renderBill();
  showToast(t("billCleared"));
});

/* ---- New sale (confirmation guards against accidental taps) ---- */

const confirmModal = document.getElementById("confirm-modal");

document.getElementById("new-sale-btn").addEventListener("click", () => {
  if (bill.length === 0) return;
  document.getElementById("confirm-amount").textContent = formatRs(billTotal());
  confirmModal.hidden = false;
});

document.getElementById("confirm-cancel").addEventListener("click", () => {
  confirmModal.hidden = true;
});

document.getElementById("confirm-ok").addEventListener("click", finalizeSale);

async function finalizeSale() {
  if (bill.length === 0) {
    confirmModal.hidden = true;
    return;
  }
  const items = bill.map((l) => ({
    product_name: l.product_name,
    quantity: l.quantity,
    unit_price: l.unit_price,
  }));
  const okBtn = document.getElementById("confirm-ok");
  okBtn.disabled = true;
  try {
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error();
    const sale = await res.json();
    bill.length = 0;
    renderBill();
    confirmModal.hidden = true;
    showToast(t("saleSaved") + formatRs(sale.total), 2500);
  } catch {
    showToast(t("couldNotSaveSale"));
  } finally {
    okBtn.disabled = false;
  }
}

/* ---- Language toggle (decision 15: chrome only, persists per device) ---- */

document.getElementById("lang-toggle").addEventListener("click", toggleLang);

window.addEventListener("pos:langchange", () => {
  renderBill();
  loadQuickTaps();
  updateQuickAddPickers();
  updateHeaderClock();
});

/* ---- Cashier header: Bikram Sambat date + 12-hour Kathmandu time (decision 16) ---- */

function updateHeaderClock() {
  document.getElementById("header-datetime").textContent = formatCashierHeader(currentLang);
}
updateHeaderClock();
setInterval(updateHeaderClock, 15000); // ticks the minute over without a reload

/* ---- Init ---- */

loadQuickTaps();
renderBill();
