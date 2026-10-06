/** Controlled local audit: no external traffic, independent Chrome profile, no data writes.
 * node tools/audit-site-quality.mjs [baseline|after] [--lighthouse]
 * Lighthouse reports are lab scores, not real-user Core Web Vitals.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'audit';
const output = path.join(root, '.planning/2026-10-06-quality/runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label.replace(/[^a-z0-9-]/gi, '')}`);
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:4351';
const server = spawn('python', ['-m', 'http.server', '4351', '--bind', '127.0.0.1', '--directory', root], { windowsHide: true, stdio: 'ignore' });
const results = [];
let browser;

/** Measure visible problems as well as resource size; retain element-level audit evidence. */
async function inspect(page, route, width) {
  const errors = [];
  const onError = (e) => errors.push(e.message);
  page.on('pageerror', onError);
  await page.setViewport({ width, height: 900 });
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })));
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    elements: document.querySelectorAll('*').length,
    resources: performance.getEntriesByType('resource').filter((r) => r.name.startsWith(location.origin)).map(({ name, decodedBodySize, duration }) => ({ name: new URL(name).pathname, bytes: decodedBodySize, ms: Math.round(duration) })),
    metrics: window.__qualityMetrics,
    imageTriggers: [...document.querySelectorAll('.hitThumb')].map((el) => ({ tag: el.tagName, tabIndex: el.tabIndex })),
  }));
  const result = { route, width, errors, accessibility, ...metrics };
  results.push(result);
  if (process.argv.includes('--assert')) {
    assert.ok(metrics.overflow <= 1, `Page overflow: ${route}/${width}`);
    assert.equal(errors.length, 0, `JS errors: ${route}/${width}`);
    assert.equal(accessibility.length, 0, `Accessibility: ${route}/${width}: ${accessibility.map((v) => v.id).join(', ')}`);
    if (route === '/compare.html') assert.ok(metrics.resources.reduce((n, r) => n + r.bytes, 0) < 250000, 'Comparison must not download the full market database');
  }
  await page.screenshot({ path: path.join(output, `${results.length}-${width}.png`), fullPage: false });
  console.log(JSON.stringify({ route, width, overflow: metrics.overflow, violations: accessibility.map((v) => `${v.id}:${v.nodes.length}`), bytes: metrics.resources.reduce((n, r) => n + r.bytes, 0), metrics: metrics.metrics, errors }));
  page.off('pageerror', onError);
}

try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(base + '/robots.txt').then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'opbox-quality-')), downloadBehavior: { policy: 'deny', downloadPath: path.join(output, 'downloads') } });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (r) => r.url().startsWith(base) || r.url().startsWith('data:') ? r.continue() : r.abort());
  await page.evaluateOnNewDocument(() => {
    window.__qualityMetrics = { cls: 0, lcp: 0, longTaskMs: 0, shifts: [] };
    new PerformanceObserver((list) => list.getEntries().forEach((e) => {
      if (!e.hadRecentInput) {
        window.__qualityMetrics.cls += e.value;
        window.__qualityMetrics.shifts.push({ value: e.value, sources: e.sources.map((s) => ({ element: s.node?.id || s.node?.className, before: s.previousRect.y, after: s.currentRect.y })) });
      }
    })).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => list.getEntries().forEach((e) => { window.__qualityMetrics.lcp = Math.round(e.startTime); })).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => list.getEntries().forEach((e) => { window.__qualityMetrics.longTaskMs += Math.round(e.duration); })).observe({ type: 'longtask', buffered: true });
  });
  for (const route of ['/?hl=en', '/?set=OP-08&hl=en', '/sets/op-01.html', '/compare.html', '/tcg-auction.html']) {
    for (const width of [375, 1440]) await inspect(page, route, width);
  }
  await page.close();
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(results, null, 2));
  if (process.argv.includes('--lighthouse')) {
    const { default: lighthouse } = await import('lighthouse');
    for (const formFactor of ['mobile', 'desktop']) {
      const desktop = formFactor === 'desktop';
      const report = await lighthouse(base + '/?hl=en', { port: Number(new URL(browser.wsEndpoint()).port), output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], blockedUrlPatterns: ['https://*'], formFactor, screenEmulation: { mobile: !desktop, width: desktop ? 1440 : 375, height: 900, deviceScaleFactor: 1, disabled: false } });
      fs.writeFileSync(path.join(output, `lighthouse-${formFactor}.json`), report.report);
      console.log(formFactor, JSON.stringify(Object.fromEntries(Object.entries(report.lhr.categories).map(([k, v]) => [k, v.score * 100]))));
    }
  }
} finally {
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  server.kill();
  console.log('REPORT', output);
}
