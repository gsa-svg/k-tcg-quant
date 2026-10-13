// Shared presentation only. No data fetching, aggregation, or price inference.
const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const count = value => Number.isFinite(value) ? value.toLocaleString("en-US") : "—";

/** Render a touch/keyboard alternative to hover-only weekly chart titles. */
function weekExplorer(weeks, ko = false) {
  const text = (en, kr) => `<span data-ko="${esc(kr)}">${esc(ko ? kr : en)}</span>`;
  if (!weeks.length) return `<p class="nt">${text("No weekly samples", "주별 표본 없음")}</p>`;
  const rows = weeks.map(w => {
    const rate = Number.isFinite(w.rate) ? `${w.rate}%` : "—";
    const en = `${w.date} · ${rate} sold · ${count(w.sold)} sales${w.statusEn ? ` · ${w.statusEn}` : ""}`;
    const kr = `${w.date} · 낙찰률 ${rate} · ${count(w.sold)}건 낙찰${w.statusKo ? ` · ${w.statusKo}` : ""}`;
    return { ...w, rateText: rate, en, kr };
  });
  const latest = rows[rows.length - 1];
  return `<div class="weekExplorer" data-week-explorer>
    <div class="weekPicker" hidden><label for="chartWeek">${text("Week starting", "주 시작일")}</label>
      <select id="chartWeek" name="week" aria-controls="weekReading">${rows.map((w, i) => `<option value="${esc(w.date)}"${i === rows.length - 1 ? " selected" : ""}>${esc(w.date)}</option>`).join("")}</select>
    </div>
    <p id="weekReading" class="weekReading" role="status" aria-live="polite" data-en="${esc(latest.en)}" data-ko="${esc(latest.kr)}">${esc(ko ? latest.kr : latest.en)}</p>
    <details class="marketDetails"><summary>${text("Weekly numbers", "주별 수치 보기")}</summary>
      <table class="weekData"><caption>${text("Week starting · UTC · observed auctions", "주 시작일 · UTC · 수집 표본")}</caption>
        <thead><tr><th scope="col">${text("Week", "주")}</th><th scope="col">${text("Sell rate", "낙찰률")}</th><th scope="col">${text("Sold", "낙찰")}</th><th scope="col">${text("Period", "기간")}</th></tr></thead>
        <tbody>${rows.map(w => `<tr data-week="${esc(w.date)}" data-reading-en="${esc(w.en)}" data-reading-ko="${esc(w.kr)}"><th scope="row">${esc(w.date)}</th><td>${w.rateText}</td><td>${count(w.sold)}</td><td>${text(w.statusEn || "—", w.statusKo || "—")}</td></tr>`).join("")}</tbody>
      </table>
    </details>
  </div>`;
}

module.exports = { weekExplorer };
