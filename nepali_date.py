"""Bikram Sambat (Nepali) calendar conversion for the admin sales reports.

Python port of the table + anchor in `static/nepali-date.js` — keep the two in
sync. Data is the authoritative medic/bikram-sambat month-length table; anchor
BS 2081-01-01 = 2024-04-13 AD (Nepali New Year 2081), verified self-consistent.
Covers BS 2078–2090 (AD ~2021–2033); dates outside the table return None.

Admin reports show BS dates in English script (romanized month names, Western
digits) — the admin panel stays English-only per CLAUDE.md decision 15; this
adds the Nepali *calendar system*, not a UI translation.
"""

from datetime import date, timedelta

BS_DATA = {
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
}

BS_ANCHOR_YEAR = 2081
BS_ANCHOR = date(2024, 4, 13)  # BS 2081-01-01

BS_MONTHS_EN = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadau", "Asoj",
                "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"]


def _days_in_year(y):
    return sum(BS_DATA[y])


def _ad_for_bs_year_start(y):
    """AD date of the first day (month 1, day 1) of BS year y."""
    d = BS_ANCHOR
    if y >= BS_ANCHOR_YEAR:
        for yy in range(BS_ANCHOR_YEAR, y):
            d += timedelta(days=_days_in_year(yy))
    else:
        for yy in range(y, BS_ANCHOR_YEAR):
            d -= timedelta(days=_days_in_year(yy))
    return d


def to_bs(greg):
    """Gregorian datetime.date -> (bs_year, bs_month 1-12, bs_day) or None."""
    for by in sorted(BS_DATA):
        start = _ad_for_bs_year_start(by)
        end = start + timedelta(days=_days_in_year(by))
        if start <= greg < end:
            offset = (greg - start).days
            mo = 0
            while offset >= BS_DATA[by][mo]:
                offset -= BS_DATA[by][mo]
                mo += 1
            return (by, mo + 1, offset + 1)
    return None


def bs_date_label(iso_str):
    """'2026-07-04' -> '2083 Asar 20', or None if out of range."""
    bs = to_bs(date.fromisoformat(iso_str))
    if not bs:
        return None
    by, bm, bd = bs
    return f"{by} {BS_MONTHS_EN[bm - 1]} {bd}"


def bs_month_key(iso_str):
    """'2026-07-04' -> ('2083-03', '2083 Asar') for grouping/sorting, or None."""
    bs = to_bs(date.fromisoformat(iso_str))
    if not bs:
        return None
    by, bm, _ = bs
    return (f"{by}-{bm:02d}", f"{by} {BS_MONTHS_EN[bm - 1]}")
