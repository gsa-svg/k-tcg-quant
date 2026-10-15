/** Offline regression for thumbnail generation and retired duplicate comparison UI. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// sharp 는 update-market-data 워크플로 러너(npm ci 없음)에 없다 — 없으면 이 테스트만 건너뛴다(2026-10-16, check.js --pre 가 전 테스트를 돌리게 되면서).
let sharp;
try { sharp = require('sharp'); } catch { console.log('skip test-quality-assets: sharp 미설치'); process.exit(0); }
const { ensureBoxThumbnail } = require('./generate-box-thumbnails');
const root = path.resolve(__dirname, '..');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opbox-thumbnail-test-'));
  const source = await sharp({ create: { width: 690, height: 720, channels: 4, background: '#112233' } }).webp().toBuffer();
  fs.writeFileSync(path.join(directory, 'OP-17.webp'), source);
  assert.equal(await ensureBoxThumbnail('OP-17', false, directory), true);
  const thumb = path.join(directory, 'thumb/OP-17.webp');
  assert.equal((await sharp(thumb).metadata()).width, 220);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'OP-17.webp')), source, 'original remains unchanged');
  assert.equal(await ensureBoxThumbnail('OP-17', false, directory), false, 'idempotent');
  assert.equal(await ensureBoxThumbnail('OP-17', true, directory), false, 'forced regeneration unchanged');
  assert.equal(await ensureBoxThumbnail('OP-18', false, directory), false, 'missing original is not invented');
  await assert.rejects(ensureBoxThumbnail('../escape', true, directory));
  const html = fs.readFileSync(path.join(root, 'compare.html'), 'utf8');
  assert.doesNotMatch(html, /src="packs\.js|__opPackData|id="compareTable"/);
  assert.match(html, /class="setComparisonScroll" role="region" tabindex="0"/);
  assert.match(html, /<th scope="row" class="ctSet"><a href="\/sets\//);
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/onepiece-packs.json'), 'utf8'));
  for (const set of Object.values(data.sets)) {
    if (set.box?.startsWith('/card-img/box/')) assert.ok(fs.existsSync(path.join(root, set.box.slice(1).replace('/box/', '/box/thumb/'))), `Missing thumbnail: ${set.box}`);
  }
  console.log('Quality asset tests passed: local thumbnails, source preservation, all grid images, comparison budgets');
})().catch((error) => { console.error(error); process.exitCode = 1; });
