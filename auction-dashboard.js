// Progressive enhancement for static auction pages. No requests or tracking.
(() => {
  'use strict';
  const isKo = () => document.documentElement.lang === 'ko';

  /** Preserve unrelated URL parameters when sharing a selected view. */
  function remember(key, value) {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  }

  /** Sort the existing, server-rendered rows. Missing values always stay last. */
  function mountSort() {
    const select = document.querySelector('#gameSort');
    const table = document.querySelector('#gameTable');
    if (!select || !table) return;
    const rows = [...table.tBodies[0].rows];
    const keys = [...select.options].map(o => o.value);
    function apply() {
      const key = select.value;
      const value = row => row.dataset[key] === '' ? null : Number(row.dataset[key]);
      const sorted = rows.slice().sort((a, b) => {
        const av = value(a), bv = value(b);
        if (av == null) return bv == null ? 0 : 1;
        return bv == null ? -1 : bv - av;
      });
      table.tBodies[0].append(...sorted);
      table.querySelectorAll('th[data-sort]').forEach(th => {
        if (th.dataset.sort === key) th.setAttribute('aria-sort', 'descending');
        else th.removeAttribute('aria-sort');
      });
    }
    const requested = new URLSearchParams(location.search).get('sort');
    if (keys.includes(requested)) select.value = requested;
    select.addEventListener('change', () => { apply(); remember('sort', select.value); });
    select.closest('.marketToolbar').hidden = false;
    apply();
  }

  /** Expose exact weekly values via native select, including incomplete periods. */
  function mountWeek(explorer) {
    const select = explorer.querySelector('select');
    if (!select) return;
    const rows = [...explorer.querySelectorAll('[data-week]')];
    const bars = [...explorer.closest('section').querySelectorAll('.cols .col')];
    const reading = explorer.querySelector('.weekReading');
    function apply() {
      const index = rows.findIndex(row => row.dataset.week === select.value);
      if (index < 0) return;
      reading.dataset.en = rows[index].dataset.readingEn;
      reading.dataset.ko = rows[index].dataset.readingKo;
      reading.textContent = isKo() ? reading.dataset.ko : reading.dataset.en;
      bars.forEach((bar, i) => bar.classList.toggle('selectedWeek', i === index));
      rows.forEach((row, i) => row.classList.toggle('selectedWeek', i === index));
    }
    const requested = new URLSearchParams(location.search).get('week');
    if (rows.some(row => row.dataset.week === requested)) select.value = requested;
    select.addEventListener('change', () => { apply(); remember('week', select.value); });
    document.addEventListener('opboxlang', apply);
    explorer.querySelector('.weekPicker').hidden = false;
    apply();
  }

  mountSort();
  document.querySelectorAll('[data-week-explorer]').forEach(mountWeek);
})();
