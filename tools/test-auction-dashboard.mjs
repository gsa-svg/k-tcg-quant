// Local UI regression only: no external requests, collection calls, or sends.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline');
const job = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, '.planning', '2026-10-13-auction-ui', job);
fs.mkdirSync(path.join(output, 'downloads'), { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opbox-auction-ui-'));
const base = 'http://127.0.0.1:4357';
const server = spawn('python', ['-m', 'http.server', '4357', '--bind', '127.0.0.1', '--directory', root], { windowsHide: true, stdio: 'ignore' });
const results = [], errors = [];
let browser;

/** Native controls must expose the same values on touch and keyboard. */
async function verifyWeek(page) {
  const dates = await page.$$eval('#chartWeek option', nodes => nodes.map(n => n.value));
  assert.ok(dates.length > 1);
  await page.select('#chartWeek', dates[0]);
  assert.ok((await page.$eval('#weekReading', n => n.textContent)).includes(dates[0]));
  assert.equal(await page.$eval('.cols .selectedWeek', n => [...n.parentElement.children].indexOf(n)), 0);
  assert.equal(new URL(page.url()).searchParams.get('week'), dates[0]);
  await page.focus('#chartWeek');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('#chartWeek', n => n.value), dates[1]);
  await page.focus('.weekExplorer summary');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('.weekExplorer details', n => n.open), true);
  assert.equal(await page.$$eval('.weekData tbody tr', rows => rows.length), dates.length);
  await page.click('.weekExplorer summary');
  await page.select('#chartWeek', dates.at(-1));
}

async function verifySort(page) {
  for (const key of ['rate', 'delta', 'price', 'closing']) {
    await page.select('#gameSort', key);
    const values = await page.$$eval('#gameTable tbody tr', (rows, k) => rows.map(row => row.dataset[k] === '' ? null : Number(row.dataset[k])), key);
    const finite = values.filter(n => n != null);
    assert.deepEqual(finite, finite.slice().sort((a, b) => b - a), `${key}: descending`);
    const firstMissing = values.indexOf(null);
    assert.ok(firstMissing < 0 || values.slice(firstMissing).every(n => n == null), 'missing values last');
    assert.equal(await page.$eval('#gameTable th[aria-sort]', n => n.dataset.sort), key);
  }
  await page.select('#gameSort', 'price');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#gameSort', n => n.value), 'price', 'shared URL restores sorting');
  // Exercise a missing price without modifying any fixture or production data.
  await page.$eval('#gameTable tbody tr', row => { row.dataset.savedPrice = row.dataset.price; row.dataset.price = ''; row.id = 'missing-price'; });
  await page.select('#gameSort', 'price');
  assert.equal(await page.$eval('#gameTable tbody tr:last-child', row => row.id), 'missing-price');
  await page.$eval('#missing-price', row => { row.dataset.price = row.dataset.savedPrice; row.removeAttribute('id'); });
  await page.select('#gameSort', 'rate');
}

try {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base + '/robots.txt')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: profile, downloadBehavior: { policy: 'deny', downloadPath: path.join(output, 'downloads') } });
  const page = await browser.newPage();
  page.on('pageerror', err => errors.push(err.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort());
  for (const file of ['tcg-auction.html', 'auction.html', 'ko/auction.html']) {
    for (const width of [375, 768, 1440]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.goto(base + '/' + file, { waitUntil: 'networkidle0' });
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(geometry.scroll <= width + 1, `${file} ${width}: no page overflow`);
      if (!baseline && width === 375 && file !== 'tcg-auction.html') {
        assert.ok(await page.$eval('#boardScroll', el => el.scrollWidth <= el.clientWidth + 1), 'mobile price board fits without sideways scrolling');
      }
      if (!baseline) {
        await verifyWeek(page);
        if (file === 'tcg-auction.html') await verifySort(page);
        await page.addScriptTag({ content: axe.source });
        const audit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
        fs.writeFileSync(path.join(output, file.replaceAll('/', '-') + '-' + width + '-axe.json'), JSON.stringify(audit, null, 2));
        assert.deepEqual(audit, [], `${file} ${width}: WCAG automated checks`);
      }
      await page.screenshot({ path: path.join(output, file.replaceAll('/', '-') + '-' + width + '.png'), fullPage: true });
      if (!baseline) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, file.replaceAll('/', '-') + '-' + width + '-head.png') });
        await (await page.$('.wk')).screenshot({ path: path.join(output, file.replaceAll('/', '-') + '-' + width + '-chart.png') });
      }
      results.push({ file, width, ...geometry });
    }
    if (!baseline) {
      await page.setViewport({ width: 375, height: 900, deviceScaleFactor: 1 });
      if (!file.startsWith('ko/')) {
        await page.click('#langToggle');
        assert.equal(await page.$eval('html', n => n.lang), 'ko');
        assert.ok((await page.$eval('#weekReading', n => n.textContent)).includes('낙찰률'));
        if (file === 'auction.html') {
          await page.click('[data-tab="sales"]');
          assert.equal(await page.$eval('#boardSales', n => n.hidden), false);
          await page.click('#moreCards');
          assert.equal(await page.$eval('#moreCards', n => n.getAttribute('aria-expanded')), 'true');
        }
        await page.screenshot({ path: path.join(output, file + '-ko-375.png'), fullPage: true });
        await page.click('#langToggle');
      }
      // Text-only 200% enlargement is stricter than scaling the entire screenshot.
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('main, main *')];
        const sizes = nodes.map(n => parseFloat(getComputedStyle(n).fontSize));
        nodes.forEach((n, i) => n.style.fontSize = sizes[i] * 2 + 'px');
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file}: 200% text no page overflow`);
      await page.screenshot({ path: path.join(output, file.replaceAll('/', '-') + '-text200.png'), fullPage: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, file.replaceAll('/', '-') + '-text200-head.png') });
      await page.setJavaScriptEnabled(false);
      await page.goto(base + '/' + file, { waitUntil: 'networkidle0' });
      await page.click('.weekExplorer summary');
      assert.equal(await page.$eval('.weekExplorer details', n => n.open), true, 'native table works without JS');
      assert.ok(await page.$eval('.weekPicker', n => n.hidden), 'no dead JS-only control');
      await page.setJavaScriptEnabled(true);
      results.push({ file, locale: 'ko', textZoom: 200, noJavaScript: true });
    }
  }
  if (process.argv.includes('--lighthouse')) {
    await page.close();
    const { default: lighthouse } = await import('lighthouse');
    const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js');
    for (const route of ['/tcg-auction.html', '/auction.html']) {
      for (const formFactor of ['mobile', 'desktop']) {
        const desktop = formFactor === 'desktop';
        const report = await lighthouse(base + route, { port: Number(new URL(browser.wsEndpoint()).port), output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], blockedUrlPatterns: ['https://*'], formFactor, screenEmulation: { mobile: !desktop, width: desktop ? 1440 : 375, height: 900, deviceScaleFactor: 1, disabled: false } }, desktop ? desktopConfig : undefined);
        const scores = Object.fromEntries(Object.entries(report.lhr.categories).map(([key, value]) => [key, value.score * 100]));
        fs.writeFileSync(path.join(output, route.slice(1) + '-' + formFactor + '-lighthouse.json'), report.report);
        results.push({ route, formFactor, scores });
        console.log(JSON.stringify({ route, formFactor, scores }));
      }
    }
  }
  assert.deepEqual(errors, [], 'no browser exceptions');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ baseline, results, errors }, null, 2));
  console.log(JSON.stringify({ output, checks: results.length, errors }));
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.log'), String(error.stack));
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
