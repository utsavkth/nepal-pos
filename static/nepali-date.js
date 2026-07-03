/* Bikram Sambat (Nepali) calendar + Kathmandu clock for the cashier header
   (feedback idea #9). Display-only; no backend involvement.

   Month-length data is from the medic/bikram-sambat dataset (authoritative,
   matches Nepal's published calendar). Anchor: BS 2081-01-01 = 2024-04-13 AD
   (Nepali New Year 2081), verified self-consistent with the table (it yields
   BS 2082 new year = 2025-04-14 and 2026-07-04 = 2083 Asar 20).

   Covers BS 2078–2090 (AD ~2021–2033). Extend BS_DATA before ~2033 to keep
   the date shown after then; out-of-range dates fall back to time-only. */
"use strict";

const BS_DATA = {
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

const BS_ANCHOR_YEAR = 2081;
const BS_ANCHOR_UTC = Date.UTC(2024, 3, 13); // 2081-01-01 BS = 13 April 2024 AD
const DAY_MS = 86400000;

const BS_MONTHS_EN = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadau", "Asoj",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
const BS_MONTHS_NE = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
  "कात्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_NE = ["आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहीबार", "शुक्रबार", "शनिबार"];
const DEVANAGARI = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

function toDevanagari(str) {
  return String(str).replace(/[0-9]/g, (d) => DEVANAGARI[+d]);
}

function daysInBSYear(y) {
  return BS_DATA[y].reduce((a, b) => a + b, 0);
}

/* AD-UTC ms for the first day (01-01) of a given BS year, walked from the anchor. */
function adUTCForBSYearStart(y) {
  let ms = BS_ANCHOR_UTC;
  if (y >= BS_ANCHOR_YEAR) {
    for (let yy = BS_ANCHOR_YEAR; yy < y; yy++) ms += daysInBSYear(yy) * DAY_MS;
  } else {
    for (let yy = y; yy < BS_ANCHOR_YEAR; yy++) ms -= daysInBSYear(yy) * DAY_MS;
  }
  return ms;
}

/* Gregorian (y, m 1-12, d) -> { year, month 1-12, day } in BS, or null if
   outside the embedded table range. */
function gregorianToBS(y, m, d) {
  const targetUTC = Date.UTC(y, m - 1, d);
  const years = Object.keys(BS_DATA).map(Number).sort((a, b) => a - b);
  for (const by of years) {
    const start = adUTCForBSYearStart(by);
    const end = start + daysInBSYear(by) * DAY_MS;
    if (targetUTC >= start && targetUTC < end) {
      let offset = Math.round((targetUTC - start) / DAY_MS); // 0-based day of year
      let mo = 0;
      while (offset >= BS_DATA[by][mo]) {
        offset -= BS_DATA[by][mo];
        mo++;
      }
      return { year: by, month: mo + 1, day: offset + 1 };
    }
  }
  return null;
}

/* Today's calendar date and 12-hour clock in Asia/Kathmandu, regardless of the
   device's own timezone. */
function kathmanduNowParts() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // YYYY-MM-DD
  const [y, m, d] = ymd.split("-").map(Number);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(now); // e.g. "2:45 PM"
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return { y, m, d, weekday, time };
}

/* Full header string, e.g. English "Sunday, 2083 Asar 20 · 2:45 PM",
   Nepali "आइतबार, २०८३ असार २० · २:४५ PM". */
function formatCashierHeader(lang) {
  const ne = lang === "ne";
  const { y, m, d, weekday, time } = kathmanduNowParts();
  const bs = gregorianToBS(y, m, d);
  const timeStr = ne ? toDevanagari(time) : time;
  if (!bs) return timeStr; // out of table range — show time only
  const months = ne ? BS_MONTHS_NE : BS_MONTHS_EN;
  const weekdays = ne ? WEEKDAYS_NE : WEEKDAYS_EN;
  const yr = ne ? toDevanagari(bs.year) : bs.year;
  const day = ne ? toDevanagari(bs.day) : bs.day;
  return `${weekdays[weekday]}, ${yr} ${months[bs.month - 1]} ${day} · ${timeStr}`;
}
