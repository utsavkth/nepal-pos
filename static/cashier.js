/* Cashier screen logic: search, quick taps, bill, quick add, price override, new sale. */
"use strict";

const bill = []; // { product_name, quantity, unit_price, original_price, is_weighed, unit }

function formatRs(n) {
  return "Rs. " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lineTotal(line) {
  return Math.round(line.quantity * line.unit_price * 100) / 100;
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
    name.textContent = line.product_name;
    const detail = document.createElement("div");
    detail.className = "bill-line-detail";
    const per = line.is_weighed ? "/kg" : "";
    let detailText = line.is_weighed
      ? `${line.quantity} kg × ${formatRs(line.unit_price)}${per}`
      : `${line.quantity} × ${formatRs(line.unit_price)}`;
    if (line.unit_price !== line.original_price) {
      detailText += ` (was ${formatRs(line.original_price)}${per})`;
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
    product_name: product.name,
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
      showToast("Search failed — check connection");
    }
  }, 150);
});

function renderSearchResults(products) {
  searchResults.innerHTML = "";
  searchResults.hidden = false;
  if (products.length === 0) {
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = "No items found — use Quick Add";
    searchResults.appendChild(li);
    return;
  }
  products.forEach((p) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = p.name;
    const price = document.createElement("span");
    price.className = "result-price";
    price.textContent = formatRs(p.price) + (p.is_weighed ? "/kg" : "");
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

async function loadQuickTaps() {
  try {
    const res = await fetch("/api/products/quick-taps");
    const data = await res.json();
    const container = document.getElementById("quick-taps");
    container.innerHTML = "";
    data.groups.forEach((group) => {
      // "Other" only earns a button once something is actually in it
      if (group.label === "Other" && group.products.length === 0) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tap-weighed";
      const name = document.createElement("span");
      name.textContent = group.label;
      const sub = document.createElement("span");
      sub.className = "tap-price";
      sub.textContent =
        group.products.length === 1
          ? "1 variety"
          : group.products.length + " varieties";
      btn.append(name, sub);
      btn.addEventListener("click", () => openVarietyList(group));
      container.appendChild(btn);
    });
    data.lpg.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tap-lpg";
      const name = document.createElement("span");
      name.textContent = p.name;
      const price = document.createElement("span");
      price.className = "tap-price";
      price.textContent = formatRs(p.price);
      btn.append(name, price);
      btn.addEventListener("click", () => {
        addToBill(p, 1);
        showToast(p.name + " added");
      });
      container.appendChild(btn);
    });
  } catch {
    showToast("Could not load quick buttons");
  }
}

/* ---- Variety picker (category button -> specific product -> weight pad) ---- */

const varietyModal = document.getElementById("variety-modal");

function openVarietyList(group) {
  document.getElementById("variety-title").textContent = group.label;
  const list = document.getElementById("variety-list");
  list.innerHTML = "";
  if (group.products.length === 0) {
    const li = document.createElement("li");
    li.className = "variety-empty";
    li.textContent = "No " + group.label + " items yet — add one in Admin or Quick Add.";
    list.appendChild(li);
  }
  group.products.forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const name = document.createElement("span");
    name.textContent = p.name;
    const price = document.createElement("span");
    price.className = "result-price";
    price.textContent = formatRs(p.price) + "/kg";
    btn.append(name, price);
    btn.addEventListener("click", () => {
      varietyModal.hidden = true;
      openWeightPad(p);
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
    product.name + " — " + formatRs(product.price) + "/kg";
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
  const per = line.is_weighed ? "/kg" : "";
  document.getElementById("price-title").textContent = line.product_name;
  document.getElementById("price-current").textContent =
    "Current price: " + formatRs(line.unit_price) + per +
    (line.unit_price !== line.original_price
      ? " (normal " + formatRs(line.original_price) + per + ")"
      : "");
  document.getElementById("price-unit-suffix").textContent = line.is_weighed ? " per kg" : "";
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
const quickAddPriceLabel = document.getElementById("quick-add-price-label");

quickAddWeighed.addEventListener("change", () => {
  // Weighed items use the weighed-group picker; fixed items use the category picker.
  quickAddGroupField.hidden = !quickAddWeighed.checked;
  quickAddCategoryField.hidden = quickAddWeighed.checked;
  quickAddPriceLabel.textContent = quickAddWeighed.checked
    ? "Price per kg (Rs.)"
    : "Price (Rs.)";
});

function openQuickAdd(barcode = null) {
  quickAddBarcode = barcode;
  const note = document.getElementById("quick-add-barcode-note");
  if (barcode) {
    note.textContent = "New barcode: " + barcode + " — will be saved with this item.";
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  document.getElementById("quick-add-name").value = "";
  document.getElementById("quick-add-price").value = "";
  quickAddWeighed.checked = false;
  quickAddGroupField.hidden = true;
  quickAddCategoryField.hidden = false;
  quickAddPriceLabel.textContent = "Price (Rs.)";
  document.getElementById("quick-add-group").value = "Rice";
  document.getElementById("quick-add-category").value = "grocery";
  quickAddModal.hidden = false;
  document.getElementById("quick-add-name").focus();
}

document.getElementById("quick-add-btn").addEventListener("click", () => openQuickAdd());
document.getElementById("quick-add-cancel").addEventListener("click", () => {
  quickAddModal.hidden = true;
});

document.getElementById("quick-add-save").addEventListener("click", async () => {
  const name = document.getElementById("quick-add-name").value.trim();
  const price = parseFloat(document.getElementById("quick-add-price").value);
  if (!name || !(price > 0)) {
    showToast("Enter a name and a price");
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
        weighed_group: quickAddWeighed.checked
          ? document.getElementById("quick-add-group").value
          : null,
        category: quickAddWeighed.checked
          ? null
          : document.getElementById("quick-add-category").value,
      }),
    });
    if (!res.ok) throw new Error();
    const product = await res.json();
    quickAddModal.hidden = true;
    loadQuickTaps(); // a new weighed variety should appear on its category button
    if (product.is_weighed) {
      showToast(product.name + " saved — enter the weight");
      openWeightPad(product);
    } else {
      addToBill(product, 1);
      showToast(product.name + " saved and added");
    }
  } catch {
    showToast("Could not save item");
  }
});

/* ---- Scanner ---- */

/* Called with every successfully decoded barcode. A not-found barcode
   auto-opens Quick Add with the barcode attached — staff never have to
   notice the miss and open the form themselves. */
async function handleScannedBarcode(barcode) {
  try {
    const res = await fetch("/api/products/barcode/" + encodeURIComponent(barcode));
    if (res.status === 404) {
      showToast("Not in the system yet — add it now", 2200);
      openQuickAdd(barcode);
      return;
    }
    const product = await res.json();
    if (product.is_weighed) {
      openWeightPad(product);
    } else {
      addToBill(product, 1);
      showToast(product.name + " added");
    }
  } catch {
    showToast("Lookup failed — check connection");
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
  showToast("Bill cleared");
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
    showToast("Sale saved — " + formatRs(sale.total), 2500);
  } catch {
    showToast("Could not save sale — try again");
  } finally {
    okBtn.disabled = false;
  }
}

/* ---- Init ---- */

loadQuickTaps();
renderBill();
