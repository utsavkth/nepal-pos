/* Bilingual UI (decision 15): English/Nepali toggle for interface chrome ONLY.
   Product names and stored data are never translated; money stays "Rs. 1,250.00"
   in both languages; numerals stay Western digits. Choice persists per device
   in localStorage under "pos_lang". No framework, no server round-trip. */
"use strict";

const I18N = {
  en: {
    admin: "⚙ Admin",
    scan: "📷 SCAN",
    searchPlaceholder: "Search item…",
    quickAddBtn: "+ Quick Add item",
    bill: "Bill",
    clear: "Clear",
    total: "Total",
    newSale: "NEW SALE",
    confirmSaleTitle: "Confirm sale",
    confirmSaleText: "Confirm this sale?",
    confirmSave: "Confirm & save",
    cancel: "Cancel",
    add: "ADD",
    change: "CHANGE",
    saveAdd: "SAVE & ADD",
    close: "Close",
    kg: "kg",
    perKg: "/kg",
    quickAddTitle: "Quick Add",
    name: "Name",
    soldByWeight: "Sold by weight (per kg)",
    showAsButton: "Show as a button on the sales screen",
    weighedCategory: "Weighed category",
    category: "Category",
    price: "Price (Rs.)",
    pricePerKg: "Price per kg (Rs.)",
    changePriceNew: "new price in Rs.",
    perKgSuffix: " per kg",
    currentPrice: "Current price: ",
    normalPrice: "normal ",
    scanBarcodeTitle: "Scan barcode",
    flipCamera: "🔄 Flip camera",
    startingCamera: "Starting camera…",
    switchingCamera: "Switching camera…",
    pointCamera: "Point the camera at the barcode",
    httpsNeeded: "Camera needs a secure (HTTPS) connection. Open the https:// address.",
    noScanner: "No barcode scanner available in this browser.",
    cameraDenied: "Camera permission was denied. Allow camera access in the browser settings.",
    noCamera: "No camera found on this device.",
    cameraFailed: "Could not start the camera. Close other apps using it and try again.",
    oneVariety: "1 variety",
    varieties: "varieties",
    noVarieties1: "No ",
    noVarieties2: " items yet — add one in Admin or Quick Add.",
    noResults: "No items found — use Quick Add",
    newBarcode1: "New barcode: ",
    newBarcode2: " — will be saved with this item.",
    notInSystem: "Not in the system yet — add it now",
    added: " added",
    savedAndAdded: " saved and added",
    savedEnterWeight: " saved — enter the weight",
    saleSaved: "Sale saved — ",
    billCleared: "Bill cleared",
    was: "was ",
    enterNamePrice: "Enter a name and a price",
    searchFailed: "Search failed — check connection",
    lookupFailed: "Lookup failed — check connection",
    couldNotSaveItem: "Could not save item",
    couldNotSaveSale: "Could not save sale — try again",
    couldNotLoadQuick: "Could not load quick buttons",
    langToggle: "नेपाली",
    groupRice: "Rice", groupDal: "Dal", groupSugar: "Sugar", groupFlour: "Flour", groupOther: "Other",
    catGrocery: "Grocery", catCosmetics: "Cosmetics", catStationery: "Stationery", catLpg: "LPG", catOther: "Other",
  },
  ne: {
    admin: "⚙ एडमिन",
    scan: "📷 स्क्यान",
    searchPlaceholder: "सामान खोज्नुहोस्…",
    quickAddBtn: "+ नयाँ सामान थप्नुहोस्",
    bill: "बिल",
    clear: "खाली गर्नुहोस्",
    total: "जम्मा",
    newSale: "नयाँ बिक्री",
    confirmSaleTitle: "बिक्री पक्का गर्नुहोस्",
    confirmSaleText: "यो बिक्री पक्का गर्ने?",
    confirmSave: "पक्का गरी सुरक्षित",
    cancel: "रद्द",
    add: "थप्नुहोस्",
    change: "परिवर्तन",
    saveAdd: "सुरक्षित गरी थप्नुहोस्",
    close: "बन्द गर्नुहोस्",
    kg: "केजी",
    perKg: "/केजी",
    quickAddTitle: "नयाँ सामान",
    name: "नाम",
    soldByWeight: "तौलेर बेचिने (प्रति केजी)",
    showAsButton: "बिक्री स्क्रिनमा बटनको रूपमा देखाउनुहोस्",
    weighedCategory: "तौल श्रेणी",
    category: "श्रेणी",
    price: "मूल्य (रु.)",
    pricePerKg: "प्रति केजी मूल्य (रु.)",
    changePriceNew: "नयाँ मूल्य (रु.)",
    perKgSuffix: " प्रति केजी",
    currentPrice: "अहिलेको मूल्य: ",
    normalPrice: "साधारण ",
    scanBarcodeTitle: "बारकोड स्क्यान गर्नुहोस्",
    flipCamera: "🔄 क्यामेरा फेर्नुहोस्",
    startingCamera: "क्यामेरा खुल्दैछ…",
    switchingCamera: "क्यामेरा फेरिँदैछ…",
    pointCamera: "क्यामेरा बारकोडतिर देखाउनुहोस्",
    httpsNeeded: "क्यामेराका लागि सुरक्षित (HTTPS) जडान चाहिन्छ। https:// ठेगाना खोल्नुहोस्।",
    noScanner: "यो ब्राउजरमा बारकोड स्क्यानर छैन।",
    cameraDenied: "क्यामेरा अनुमति दिइएन। ब्राउजर सेटिङमा क्यामेरा खोल्नुहोस्।",
    noCamera: "यो यन्त्रमा क्यामेरा फेला परेन।",
    cameraFailed: "क्यामेरा खुलेन। क्यामेरा चलाइरहेका अरू एप बन्द गरी फेरि प्रयास गर्नुहोस्।",
    oneVariety: "1 प्रकार",
    varieties: "प्रकार",
    noVarieties1: "",
    noVarieties2: "मा अहिले केही छैन — एडमिन वा नयाँ सामानबाट थप्नुहोस्।",
    noResults: "फेला परेन — नयाँ सामान थप्नुहोस्",
    newBarcode1: "नयाँ बारकोड: ",
    newBarcode2: " — यही सामानसँग सुरक्षित हुनेछ।",
    notInSystem: "सूचीमा छैन — अहिले थप्नुहोस्",
    added: " थपियो",
    savedAndAdded: " सुरक्षित भयो र थपियो",
    savedEnterWeight: " सुरक्षित भयो — तौल हाल्नुहोस्",
    saleSaved: "बिक्री सुरक्षित — ",
    billCleared: "बिल खाली भयो",
    was: "पहिले ",
    enterNamePrice: "नाम र मूल्य हाल्नुहोस्",
    searchFailed: "खोज्न सकिएन — इन्टरनेट जाँच्नुहोस्",
    lookupFailed: "खोज्न सकिएन — इन्टरनेट जाँच्नुहोस्",
    couldNotSaveItem: "सुरक्षित गर्न सकिएन",
    couldNotSaveSale: "बिक्री सुरक्षित भएन — फेरि प्रयास गर्नुहोस्",
    couldNotLoadQuick: "छिटो बटनहरू लोड भएनन्",
    langToggle: "English",
    groupRice: "चामल", groupDal: "दाल", groupSugar: "चिनी", groupFlour: "पीठो", groupOther: "अन्य",
    catGrocery: "किराना", catCosmetics: "सौन्दर्य सामग्री", catStationery: "स्टेशनरी", catLpg: "ग्यास", catOther: "अन्य",
  },
};

let currentLang = localStorage.getItem("pos_lang") === "ne" ? "ne" : "en";

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) ?? I18N.en[key] ?? key;
}

/* Display-only label for a weighed group value (stored values stay English). */
function groupLabel(group) {
  return t("group" + group) || group;
}

/* Product display name: the optional per-product Nepali name when the Nepali
   toggle is on and one is set, else the canonical English name. Display only —
   the English name is what gets stored on the sale. */
function productDisplayName(englishName, nepaliName) {
  return currentLang === "ne" && nepaliName ? nepaliName : englishName;
}

/* Translate all static markup: elements with data-i18n get textContent,
   data-i18n-placeholder gets the placeholder attribute. */
function applyStaticTranslations() {
  document.documentElement.lang = currentLang === "ne" ? "ne" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

function setLang(lang) {
  currentLang = lang === "ne" ? "ne" : "en";
  localStorage.setItem("pos_lang", currentLang);
  applyStaticTranslations();
  // dynamic renderers (bill, quick taps) listen and re-render themselves
  window.dispatchEvent(new CustomEvent("pos:langchange"));
}

function toggleLang() {
  setLang(currentLang === "ne" ? "en" : "ne");
}

document.addEventListener("DOMContentLoaded", applyStaticTranslations);
