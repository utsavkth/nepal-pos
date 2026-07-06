/* Admin product list — live, as-you-type search (client-side) plus instant
   category filtering. Text search filters the rows already on the page with no
   reload; changing the category reloads with that category applied server-side,
   carrying the current search text along so it isn't lost. */
"use strict";
(function () {
  const form = document.getElementById("admin-filter");
  const search = document.getElementById("admin-search");
  const category = document.getElementById("admin-category");
  const rows = Array.prototype.slice.call(document.querySelectorAll("tbody tr[data-search]"));
  const noMatches = document.getElementById("no-matches");
  const clear = document.getElementById("admin-clear");

  function applyFilter() {
    const q = (search ? search.value : "").trim().toLowerCase();
    let visible = 0;
    rows.forEach((tr) => {
      const show = !q || (tr.dataset.search || "").indexOf(q) !== -1;
      tr.hidden = !show;
      if (show) visible++;
    });
    if (noMatches) noMatches.hidden = !(rows.length && visible === 0);
  }

  if (search) {
    search.addEventListener("input", applyFilter);
    applyFilter(); // re-apply a value seeded after a category reload
  }
  // Changing the category reloads with just that category (server-side).
  if (category) category.addEventListener("change", () => { if (form) form.submit(); });
  // Enter shouldn't reload the page — the list already filters live.
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); applyFilter(); });
  // "Clear" resets both without a round-trip (unless there's a server-side
  // category applied, in which case the link's href reloads to the full list).
  if (clear && category && !category.value) {
    clear.addEventListener("click", (e) => {
      e.preventDefault();
      if (search) { search.value = ""; search.focus(); }
      applyFilter();
    });
  }
})();
