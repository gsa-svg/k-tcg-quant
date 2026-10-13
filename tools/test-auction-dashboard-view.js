// Pure rendering tests: no network, browser, or collection data required.
const assert = require('node:assert/strict');
const { weekExplorer } = require('./auction-dashboard-view');
const weeks = [
  { date: '2026-10-05', rate: 0, sold: 0, statusEn: 'Days missing', statusKo: '빠진 날 있음' },
  { date: '2026-10-12', rate: null, sold: 2, statusEn: 'So far', statusKo: '진행 중' },
];
const en = weekExplorer(weeks);
assert.match(en, /<td>0%<\/td><td>0<\/td>/, 'real zero retained');
assert.match(en, /<td>—<\/td><td>2<\/td>/, 'missing rate not zero-filled');
assert.match(en, /role="status" aria-live="polite"/);
assert.match(en, /<option value="2026-10-12" selected>/);
assert.match(en, /<th scope="col">/);
assert.match(en, /data-reading-ko="2026-10-05 · 낙찰률 0% · 0건 낙찰 · 빠진 날 있음"/);
assert.match(weekExplorer(weeks, true), />주별 수치 보기<\/span>/);
assert.match(weekExplorer([]), /No weekly samples/);
const hostile = weekExplorer([{ date: '<script>', rate: '<img>', sold: NaN, statusEn: '"<svg>', statusKo: '&' }]);
assert.ok(!hostile.includes('<script>') && !hostile.includes('<svg>') && !hostile.includes('<img>'));
assert.ok(!hostile.includes('NaN%'));
console.log('Auction dashboard view: 10 assertions passed');
