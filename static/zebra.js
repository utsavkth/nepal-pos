/* Zebra POS v2 — handheld cashier screen for the Zebra TC53 (/zebra).
   Scanning is DataWedge keyboard-wedge: the scanner types the barcode into
   whatever is focused and sends Enter. So the whole page revolves around one
   always-focused input (#wedge-input); no camera scanner on this screen.
   Shares the live database with the original cashier via the same APIs. */
"use strict";

const bill = []; // { product_name, name_ne, quantity, unit_price, original_price, is_weighed, unit }
let cartName = ""; // optional customer label, set when a cart is saved/resumed

function formatRs(n) {
  return "Rs. " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineTotal(line) {
  return Math.round(line.quantity * line.unit_price * 100) / 100;
}

/* Measured products can be per-kg or per-litre (decision: litre unit). */
function unitName(unit) {
  return unit === "litre" ? t("litre") : t("kg");
}
function perUnit(unit) {
  return unit === "litre" ? t("perLitre") : t("perKg");
}
function perUnitSuffix(unit) {
  return unit === "litre" ? t("perLitreSuffix") : t("perKgSuffix");
}

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

/* ---- Wedge input focus management ----
   The scanner only works while #wedge-input is focused, so after every tap or
   closed modal the focus snaps back — unless the user is genuinely typing in
   another field (Quick Add name, cart name) or a modal is open. */

const wedgeInput = document.getElementById("wedge-input");

function safeToRefocus() {
  if (document.querySelector(".modal:not([hidden])")) return false;
  const ae = document.activeElement;
  if (ae && ae !== wedgeInput && ["INPUT", "SELECT", "TEXTAREA"].includes(ae.tagName)) return false;
  return true;
}

function refocusWedge() {
  setTimeout(() => { if (safeToRefocus()) wedgeInput.focus(); }, 60);
}

document.addEventListener("click", refocusWedge);
window.addEventListener("focus", refocusWedge);

/* ---- Cart rendering (same bill semantics as the original cashier) ---- */

function renderBill() {
  const list = document.getElementById("bill-lines");
  list.innerHTML = "";
  bill.forEach((line, idx) => {
    const li = document.createElement("li");

    const thumb = productThumb(line, "bill-line-thumb");
    if (thumb) li.appendChild(thumb);

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
      : `${formatRs(line.unit_price)} ${t("each")}`;
    if (line.unit_price !== line.original_price) {
      detailText += ` (${t("was")}${formatRs(line.original_price)}${per})`;
      detail.classList.add("overridden");
    }
    detail.textContent = detailText;
    info.append(name, detail);
    li.append(info);

    // Quantity stepper for piece lines (same pattern as the main cashier).
    if (!line.is_weighed) {
      const stepper = document.createElement("div");
      stepper.className = "bill-line-stepper";
      const dec = document.createElement("button");
      dec.type = "button";
      dec.className = "bill-step";
      dec.setAttribute("aria-label", "One less " + line.product_name);
      dec.textContent = "−";
      dec.addEventListener("click", () => {
        if (line.quantity <= 1) {
          bill.splice(idx, 1);
        } else {
          line.quantity -= 1;
        }
        renderBill();
      });
      const qty = document.createElement("span");
      qty.className = "bill-step-qty";
      qty.textContent = line.quantity;
      const inc = document.createElement("button");
      inc.type = "button";
      inc.className = "bill-step";
      inc.setAttribute("aria-label", "One more " + line.product_name);
      inc.textContent = "+";
      inc.addEventListener("click", () => {
        line.quantity += 1;
        renderBill();
      });
      stepper.append(dec, qty, inc);
      li.append(stepper);
    }

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

    li.append(total, edit, remove);
    list.appendChild(li);
  });

  const total = billTotal();
  document.getElementById("bill-total").textContent = formatRs(total);
  document.getElementById("cart-empty").hidden = bill.length > 0;
  const confirmBtn = document.getElementById("confirm-sale-btn");
  confirmBtn.textContent = t("confirmSaleBtn") + (total > 0 ? " · " + formatRs(total) : "");
  confirmBtn.disabled = bill.length === 0;
  document.getElementById("save-cart-btn").disabled = bill.length === 0;
  document.getElementById("clear-bill-btn").disabled = bill.length === 0;
  document.getElementById("cart-name-label").textContent = cartName ? " — " + cartName : "";
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
    product_name: product.name,       // canonical English — saved on the sale
    name_ne: product.name_ne || null, // optional Nepali display name
    quantity: quantity,
    unit_price: product.price,
    original_price: product.price,
    is_weighed: !!product.is_weighed,
    unit: product.unit,
    image_path: product.image_path || null, // bill-line thumbnail
  });
  renderBill();
}

/* ---- Barcode lookup (the proven scan flow, fed by the wedge input) ----
   Found -> add to cart (or weight pad if is_weighed). Not found -> Quick Add
   auto-opens with the barcode attached, same as the original cashier. */

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

/* ---- Wedge input: scans (digits + Enter) and manual name search ---- */

const searchResults = document.getElementById("search-results");
let searchTimer = null;

function clearWedge() {
  wedgeInput.value = "";
  searchResults.hidden = true;
  searchResults.innerHTML = "";
}

wedgeInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const value = wedgeInput.value.trim();
  if (!value) return;
  // Grocery barcodes (EAN-13/UPC/EAN-8) are all digits; DataWedge types the
  // code then sends Enter, which lands here. Anything with letters is a human
  // typing a product name, so run the name search instead.
  if (/^\d{4,}$/.test(value)) {
    clearWedge();
    handleScannedBarcode(value);
  } else {
    runNameSearch(value);
  }
});

wedgeInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = wedgeInput.value.trim();
  // All-digit input is (probably) a scan in progress — don't search mid-scan,
  // the Enter keydown will resolve it as a barcode.
  if (!q || /^\d+$/.test(q)) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }
  searchTimer = setTimeout(() => runNameSearch(q), 150);
});

async function runNameSearch(q) {
  try {
    const res = await fetch("/api/products/search?q=" + encodeURIComponent(q));
    const products = await res.json();
    renderSearchResults(products, q);
  } catch {
    showToast(t("searchFailed"));
  }
}

function renderSearchResults(products, q) {
  searchResults.innerHTML = "";
  searchResults.hidden = false;
  if (products.length === 0) {
    const li = document.createElement("li");
    li.className = "no-results add-not-found";
    li.textContent = t("noResults");
    li.addEventListener("click", () => {
      clearWedge();
      openQuickAdd(null, q);
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
      clearWedge();
      if (p.is_weighed) {
        openWeightPad(p);
      } else {
        addToBill(p, 1);
      }
    });
    searchResults.appendChild(li);
  });
}

/* ---- Quick-tap group buttons (decision 19: user-defined, DB-driven) ---- */

const TAP_ICONS = {
  Rice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z"/><path d="M7 8.6c.4-.8 1.2-1.1 2-.9M11 7.4c.5-.8 1.4-1.1 2.2-.8"/></svg>',
  Dal: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><ellipse cx="8.5" cy="10" rx="3.1" ry="2.05"/><ellipse cx="15" cy="9" rx="3.1" ry="2.05"/><ellipse cx="12" cy="15" rx="3.1" ry="2.05"/></svg>',
  Sugar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5.5" y="5.5" width="13" height="13" rx="1.6"/><path d="M5.5 11h13M11 5.5v13"/></svg>',
  Flour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7.5c-1.2 0-2 1-2.4 2.8L4.6 19h14.8l-1-8.7C18 8.5 17.2 7.5 16 7.5Z"/><path d="M8.4 7.5h7.2"/></svg>',
  Other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5h15l-1.4 9H5.9Z"/><path d="M8.6 9.5 10.5 4.6M15.4 9.5 13.5 4.6"/></svg>',
  LPG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5v8.6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1Z"/><path d="M10.4 5.4V4h3.2v1.4"/></svg>',
};

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
      btn.append(media, name);
      btn.addEventListener("click", () => openVarietyList(group));
      container.appendChild(btn);
    });
    (data.pinned || []).forEach((p) => {
      container.appendChild(productTapTile(p, "tap-pinned"));
    });
  } catch {
    showToast(t("couldNotLoadQuick"));
  }
}

/* ---- Variety picker ---- */

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
  refocusWedge();
});

/* ---- Weight pad ---- */

const weightModal = document.getElementById("weight-modal");
let weightProduct = null;
let weightStr = "";

/* Preset chips above the numpad (same as the main cashier): common amounts
   in the product's unit fill the readout in one tap. */
const WEIGHT_PRESETS = [
  { value: 0.5, str: "0.5", label: "½" },
  { value: 1, str: "1", label: "1" },
  { value: 2, str: "2", label: "2" },
  { value: 5, str: "5", label: "5" },
];

function renderWeightPresets() {
  const row = document.getElementById("weight-presets");
  row.innerHTML = "";
  const unit = unitName(weightProduct.unit);
  WEIGHT_PRESETS.forEach((preset) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.textContent = preset.label + " " + unit;
    if (parseFloat(weightStr) === preset.value) chip.classList.add("selected");
    chip.addEventListener("click", () => {
      weightStr = preset.str;
      updateWeightDisplay();
    });
    row.appendChild(chip);
  });
}

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
  renderWeightPresets(); // keep the matching chip highlighted as digits change
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
      const parts = next.split(".");
      if (parts[0].length > 3 || (parts[1] || "").length > 3) return;
      weightStr = next;
    }
    updateWeightDisplay();
  });
});

document.getElementById("weight-cancel").addEventListener("click", () => {
  weightModal.hidden = true;
  refocusWedge();
});

document.getElementById("weight-ok").addEventListener("click", () => {
  const kg = parseFloat(weightStr);
  if (kg > 0) {
    addToBill(weightProduct, kg);
    weightModal.hidden = true;
    refocusWedge();
  }
});

/* ---- Price override (this sale only) ---- */

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
  refocusWedge();
});

document.getElementById("price-ok").addEventListener("click", () => {
  const newPrice = parseFloat(priceStr);
  if (priceLineIndex !== null && !Number.isNaN(newPrice)) {
    bill[priceLineIndex].unit_price = newPrice;
    renderBill();
    priceModal.hidden = true;
    refocusWedge();
  }
});

/* ---- Quick Add (auto-opens on a not-found scan, barcode attached) ---- */

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
  refocusWedge();
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
        weighed_group: quickAddWeighed.checked ? quickAddGroupSelect.value : null,
        category: quickAddWeighed.checked ? null : quickAddCategorySelect.value,
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
    loadQuickTaps();
    if (product.is_weighed) {
      showToast(productDisplayName(product.name, product.name_ne) +
        (product.unit === "litre" ? t("savedEnterVolume") : t("savedEnterWeight")));
      openWeightPad(product);
    } else {
      addToBill(product, 1);
      showToast(productDisplayName(product.name, product.name_ne) + t("savedAndAdded"));
      refocusWedge();
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

/* ---- Saved (parked) carts ----
   Serve-two-customers-at-once: park the running cart under a customer name,
   start fresh, tap the chip to bring it back. Stored per device in
   localStorage — parked carts are unfinished business, never sent to the
   server (only a confirmed sale is saved, same as the original cashier). */

const PARKED_KEY = "zebra_parked_carts";

function getParkedCarts() {
  try {
    return JSON.parse(localStorage.getItem(PARKED_KEY)) || [];
  } catch {
    return [];
  }
}

function setParkedCarts(carts) {
  localStorage.setItem(PARKED_KEY, JSON.stringify(carts));
  renderParkedCarts();
}

function renderParkedCarts() {
  const carts = getParkedCarts();
  document.getElementById("parked-row").hidden = carts.length === 0;
  const chips = document.getElementById("parked-chips");
  chips.innerHTML = "";
  carts.forEach((cart, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "z-parked-chip";
    const total = cart.lines.reduce((s, l) => s + lineTotal(l), 0);
    chip.textContent = cart.name + " · " + formatRs(total);
    chip.addEventListener("click", () => resumeParkedCart(idx));
    chips.appendChild(chip);
  });
}

function resumeParkedCart(index) {
  if (bill.length > 0) {
    showToast(t("finishCartFirst"));
    return;
  }
  const carts = getParkedCarts();
  const cart = carts.splice(index, 1)[0];
  if (!cart) return;
  setParkedCarts(carts);
  cartName = cart.name;
  bill.push(...cart.lines);
  renderBill();
  showToast(cart.name + t("cartResumed"));
}

const cartNameModal = document.getElementById("cart-name-modal");

document.getElementById("save-cart-btn").addEventListener("click", () => {
  if (bill.length === 0) return;
  document.getElementById("cart-name-input").value = cartName;
  cartNameModal.hidden = false;
  document.getElementById("cart-name-input").focus();
});

document.getElementById("cart-name-cancel").addEventListener("click", () => {
  cartNameModal.hidden = true;
  refocusWedge();
});

document.getElementById("cart-name-save").addEventListener("click", () => {
  const name = document.getElementById("cart-name-input").value.trim()
    || t("cart") + " " + (getParkedCarts().length + 1);
  const carts = getParkedCarts();
  carts.push({ name, lines: bill.slice(), savedAt: Date.now() });
  setParkedCarts(carts);
  bill.length = 0;
  cartName = "";
  renderBill();
  cartNameModal.hidden = true;
  showToast(t("cartSaved") + name);
  refocusWedge();
});

/* ---- Clear cart (one tap, no save) ---- */

document.getElementById("clear-bill-btn").addEventListener("click", () => {
  if (bill.length === 0) return;
  bill.length = 0;
  cartName = "";
  renderBill();
  showToast(t("billCleared"));
});

/* ---- Checkout: payment step, then save the sale ----
   CONFIRM SALE opens the payment screen (which doubles as the decision-11
   confirmation guard); the sale is only saved once staff tap PAYMENT RECEIVED
   after visually confirming the customer's Fonepay payment (or taking cash). */

const paymentModal = document.getElementById("payment-modal");

/* Render the QR the customer scans to pay `saleTotal`.

   TODO(fonepay-dynamic-qr) — SWAP POINT: this is the ONLY place the QR comes
   from. Today it shows the shop's static Fonepay QR (a photo of the real
   terminal QR saved at static/fonepay-static-qr.jpg — never generate one
   programmatically, only Fonepay's system can produce valid QR data). Once
   Fonepay Dynamic QR API credentials arrive (blocked on the bank/Fonepay,
   tracked in Notion), replace the body of this function with a call to a new
   backend endpoint that requests a per-sale dynamic QR for `saleTotal`, and
   have the webhook-based payment confirmation enable/auto-trigger the
   PAYMENT RECEIVED button. The rest of the checkout flow stays unchanged. */
function renderPaymentQr(saleTotal) {
  document.getElementById("payment-total").textContent = formatRs(saleTotal);
  const area = document.getElementById("payment-qr-area");
  area.innerHTML = "";
  const img = document.createElement("img");
  img.className = "z-payment-qr";
  img.src = "/static/fonepay-static-qr.jpg";
  img.alt = "Fonepay QR";
  img.addEventListener("error", () => {
    // The real QR photo hasn't been dropped into static/ yet — say so instead
    // of showing a broken image. Staff can still take cash and confirm.
    area.innerHTML = "";
    const note = document.createElement("p");
    note.className = "z-qr-missing";
    note.textContent = t("qrMissing");
    area.appendChild(note);
  });
  area.appendChild(img);
}

document.getElementById("confirm-sale-btn").addEventListener("click", () => {
  if (bill.length === 0) return;
  renderPaymentQr(billTotal());
  paymentModal.hidden = false;
});

document.getElementById("payment-back").addEventListener("click", () => {
  paymentModal.hidden = true;
  refocusWedge();
});

document.getElementById("payment-received").addEventListener("click", finalizeSale);

async function finalizeSale() {
  if (bill.length === 0) {
    paymentModal.hidden = true;
    return;
  }
  const items = bill.map((l) => ({
    product_name: l.product_name,
    quantity: l.quantity,
    unit_price: l.unit_price,
  }));
  const okBtn = document.getElementById("payment-received");
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
    cartName = "";
    renderBill();
    paymentModal.hidden = true;
    showToast(t("saleSaved") + formatRs(sale.total), 2500);
    refocusWedge();
  } catch {
    showToast(t("couldNotSaveSale"));
  } finally {
    okBtn.disabled = false;
  }
}

/* ---- Language toggle (decision 15) ---- */

document.getElementById("lang-toggle").addEventListener("click", toggleLang);

window.addEventListener("pos:langchange", () => {
  renderBill();
  loadQuickTaps();
  renderParkedCarts();
  updateQuickAddPickers();
  updateHeaderClock();
});

/* ---- Header: Bikram Sambat date + Kathmandu time (decision 16) ---- */

function updateHeaderClock() {
  document.getElementById("header-datetime").textContent = formatCashierHeader(currentLang);
}
updateHeaderClock();
setInterval(updateHeaderClock, 15000);

/* ---- Init ---- */

loadQuickTaps();
renderParkedCarts();
renderBill();
wedgeInput.focus();
