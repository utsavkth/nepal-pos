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
    bill: "Current Sale",
    clear: "Clear",
    total: "Total",
    item: "item",
    items: "items",
    each: "each",
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
    litre: "litre",
    perLitre: "/litre",
    quickAddTitle: "Quick Add",
    name: "Name",
    soldByWeight: "Sold loose — weighed or measured",
    measuredIn: "Measured in",
    showAsButton: "Show as a button on the sales screen",
    weighedCategory: "Weighed category",
    category: "Category",
    price: "Price (Rs.)",
    pricePerKg: "Price per kg (Rs.)",
    pricePerLitre: "Price per litre (Rs.)",
    changePriceNew: "new price in Rs.",
    perKgSuffix: " per kg",
    perLitreSuffix: " per litre",
    currentPrice: "Current price: ",
    normalPrice: "normal ",
    scanBarcodeTitle: "Scan barcode",
    flipCamera: "🔄 Flip camera",
    cantScan: "Can't scan? Type the barcode number:",
    barcodePlaceholder: "Barcode number",
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
    noResults: "Not found — tap to add this product",
    newBarcode1: "New barcode: ",
    newBarcode2: " — will be saved with this item.",
    notInSystem: "Not in the system yet — add it now",
    added: " added",
    savedAndAdded: " saved and added",
    savedEnterWeight: " saved — enter the weight",
    savedEnterVolume: " saved — enter the litres",
    saleSaved: "Sale saved — ",
    saleSavedTitle: "Sale saved",
    customerPaid: "Customer paid",
    optionalTag: "(optional)",
    customAmount: "Custom",
    setAmount: "Set amount",
    changeDue: "Change",
    stillOwed: "Still owed",
    owedNote: "Amount paid is less than the total",
    billCleared: "Bill cleared",
    was: "was ",
    enterNamePrice: "Enter a name and a price",
    dupTitle: "Possible duplicate",
    dupBody: "This product looks like it's already in the system. Add it anyway?",
    dupAddAnyway: "Add anyway",
    dupAlreadyExists: "already in the system",
    searchFailed: "Search failed — check connection",
    lookupFailed: "Lookup failed — check connection",
    couldNotSaveItem: "Could not save item",
    couldNotSaveSale: "Could not save sale — try again",
    couldNotLoadQuick: "Could not load quick buttons",
    langToggle: "नेपाली",
    groupRice: "Rice", groupDal: "Dal", groupSugar: "Sugar", groupFlour: "Flour", groupOther: "Other", groupLPG: "LPG",
    catGrocery: "Grocery", catCosmetics: "Cosmetics", catStationery: "Stationery", catLpg: "LPG", catOther: "Other",
    /* Zebra POS v2 (handheld cashier at /zebra) */
    wedgePlaceholder: "Scan barcode or type name…",
    cart: "Cart",
    saveCart: "SAVE CART",
    confirmSaleBtn: "CONFIRM SALE",
    savedCarts: "Saved carts:",
    cartNameTitle: "Save this cart",
    cartNameLabel: "Customer / cart name",
    save: "SAVE",
    cartSaved: "Cart saved — ",
    cartResumed: " brought back",
    finishCartFirst: "Save or clear the current cart first",
    emptyCart: "Scan an item to start",
    payment: "Payment",
    payHint: "Customer scans this QR with their banking app, or pays cash.",
    paymentReceived: "PAYMENT RECEIVED",
    back: "Back",
    qrMissing: "Fonepay QR image not installed yet — save the photo as static/fonepay-static-qr.jpg.",
  },
  ne: {
    admin: "⚙ एडमिन",
    scan: "📷 स्क्यान",
    searchPlaceholder: "सामान खोज्नुहोस्…",
    quickAddBtn: "+ नयाँ सामान थप्नुहोस्",
    bill: "बिल",
    clear: "खाली गर्नुहोस्",
    total: "जम्मा",
    item: "वटा",
    items: "वटा",
    each: "प्रति गोटा",
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
    litre: "लिटर",
    perLitre: "/लिटर",
    quickAddTitle: "नयाँ सामान",
    name: "नाम",
    soldByWeight: "खुला बेचिने — तौलेर वा नापेर",
    measuredIn: "नाप्ने एकाइ",
    showAsButton: "बिक्री स्क्रिनमा बटनको रूपमा देखाउनुहोस्",
    weighedCategory: "तौल श्रेणी",
    category: "श्रेणी",
    price: "मूल्य (रु.)",
    pricePerKg: "प्रति केजी मूल्य (रु.)",
    pricePerLitre: "प्रति लिटर मूल्य (रु.)",
    changePriceNew: "नयाँ मूल्य (रु.)",
    perKgSuffix: " प्रति केजी",
    perLitreSuffix: " प्रति लिटर",
    currentPrice: "अहिलेको मूल्य: ",
    normalPrice: "साधारण ",
    scanBarcodeTitle: "बारकोड स्क्यान गर्नुहोस्",
    flipCamera: "🔄 क्यामेरा फेर्नुहोस्",
    cantScan: "स्क्यान भएन? बारकोड नम्बर टाइप गर्नुहोस्:",
    barcodePlaceholder: "बारकोड नम्बर",
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
    noResults: "फेला परेन — यो सामान थप्न ट्याप गर्नुहोस्",
    newBarcode1: "नयाँ बारकोड: ",
    newBarcode2: " — यही सामानसँग सुरक्षित हुनेछ।",
    notInSystem: "सूचीमा छैन — अहिले थप्नुहोस्",
    added: " थपियो",
    savedAndAdded: " सुरक्षित भयो र थपियो",
    savedEnterWeight: " सुरक्षित भयो — तौल हाल्नुहोस्",
    savedEnterVolume: " सुरक्षित भयो — लिटर हाल्नुहोस्",
    saleSaved: "बिक्री सुरक्षित — ",
    saleSavedTitle: "बिक्री सुरक्षित भयो",
    customerPaid: "ग्राहकले तिरेको",
    optionalTag: "(वैकल्पिक)",
    customAmount: "अरू रकम",
    setAmount: "रकम राख्नुहोस्",
    changeDue: "फिर्ता",
    stillOwed: "बाँकी",
    owedNote: "तिरेको रकम जम्माभन्दा कम छ",
    billCleared: "बिल खाली भयो",
    was: "पहिले ",
    enterNamePrice: "नाम र मूल्य हाल्नुहोस्",
    dupTitle: "उस्तै सामान लाग्यो",
    dupBody: "यो सामान पहिले नै सूचीमा भएको जस्तो छ। जे भए पनि थप्ने?",
    dupAddAnyway: "जे भए पनि थप्नुहोस्",
    dupAlreadyExists: "पहिले नै सूचीमा छ",
    searchFailed: "खोज्न सकिएन — इन्टरनेट जाँच्नुहोस्",
    lookupFailed: "खोज्न सकिएन — इन्टरनेट जाँच्नुहोस्",
    couldNotSaveItem: "सुरक्षित गर्न सकिएन",
    couldNotSaveSale: "बिक्री सुरक्षित भएन — फेरि प्रयास गर्नुहोस्",
    couldNotLoadQuick: "छिटो बटनहरू लोड भएनन्",
    langToggle: "English",
    groupRice: "चामल", groupDal: "दाल", groupSugar: "चिनी", groupFlour: "पीठो", groupOther: "अन्य", groupLPG: "ग्यास",
    catGrocery: "किराना", catCosmetics: "सौन्दर्य सामग्री", catStationery: "स्टेशनरी", catLpg: "ग्यास", catOther: "अन्य",
    /* Zebra POS v2 (handheld cashier at /zebra) */
    wedgePlaceholder: "बारकोड स्क्यान वा नाम टाइप गर्नुहोस्…",
    cart: "कार्ट",
    saveCart: "कार्ट राख्नुहोस्",
    confirmSaleBtn: "बिक्री पक्का गर्नुहोस्",
    savedCarts: "राखिएका कार्टहरू:",
    cartNameTitle: "यो कार्ट राख्नुहोस्",
    cartNameLabel: "ग्राहक / कार्टको नाम",
    save: "राख्नुहोस्",
    cartSaved: "कार्ट राखियो — ",
    cartResumed: " फिर्ता ल्याइयो",
    finishCartFirst: "पहिले अहिलेको कार्ट राख्नुहोस् वा खाली गर्नुहोस्",
    emptyCart: "सुरु गर्न सामान स्क्यान गर्नुहोस्",
    payment: "भुक्तानी",
    payHint: "ग्राहकले आफ्नो बैंकिङ एपले यो QR स्क्यान गर्नुहोस्, वा नगद तिर्नुहोस्।",
    paymentReceived: "भुक्तानी भयो",
    back: "पछाडि",
    qrMissing: "Fonepay QR फोटो अझै राखिएको छैन — static/fonepay-static-qr.jpg मा राख्नुहोस्।",
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
