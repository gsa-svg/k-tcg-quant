// Local-only UI regression suite. No external requests or eBay quota consumption.
// Run: node tools/test-uiux.mjs. Screenshots/logs use a unique ignored job folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const job = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, ".planning", "2026-09-30-uiux", "runs", job);
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "opbox-uiux-"));
const downloads = path.join(output, "downloads");
fs.mkdirSync(downloads);
const base = "http://127.0.0.1:4347";
const server = spawn("python", ["-m", "http.server", "4347", "--bind", "127.0.0.1", "--directory", root], { windowsHide: true, stdio: "ignore" });
const ping = () => new Promise((resolve) => http.get(base + "/robots.txt", (r) => { r.resume(); resolve(r.statusCode === 200); }).on("error", () => resolve(false)));
const results = [], errors = [];
let browser;

/** Verify geometry and actual on-screen SVG font size, not viewBox units. */
async function measure(page) {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll(".opbcPane")].filter((p) => p.getBoundingClientRect().width > 0);
    const labels = panes.flatMap((pane) => [...pane.querySelectorAll(".opbcAx")].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest(".opbcDateTag")).map((el) => {
      const svg = el.ownerSVGElement, scale = svg.getBoundingClientRect().width / 680;
      return Number.parseFloat(getComputedStyle(el).fontSize) * scale;
    }));
    return {
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      clipped: panes.some((p) => { const r = p.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }),
      minLabel: labels.length ? Math.min(...labels) : null,
      cardWidth: document.querySelector(".packChip")?.getBoundingClientRect().width,
      auctionDisplay: document.querySelector(".aucList") && getComputedStyle(document.querySelector(".aucList")).display,
      navOverflow: (() => { const n = document.querySelector(".topbar .nav"); return n ? n.scrollWidth - n.clientWidth : 0; })(),
    };
  });
}

try {
  for (let i = 0; i < 30 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(await ping(), "local server started");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, userDataDir: profile, downloadBehavior: { policy: "deny", downloadPath: downloads } });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (r.url().startsWith(base) || r.url().startsWith("data:")) return r.continue();
    if (r.url().startsWith("https://opbox-deals.gsa-834.workers.dev/")) {
      const items = Array.from({ length: 5 }, (_, i) => ({ title: "UI fixture · One Piece OP-13 Japanese sealed booster box " + (i + 1), kind: "box", url: "https://www.ebay.com/itm/123456789000", currentBid: 100 + i, currency: "USD", bidCount: 4, contested: true, country: "JP", endsAt: new Date(Date.now() + 7200000).toISOString() }));
      return r.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ generatedAt: new Date().toISOString(), items }) });
    }
    return r.abort();
  });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  for (const route of ["/?set=OP-08&hl=en", "/sets/op-01.html", "/sets/op-01-english.html", "/tcg-auction.html"]) {
    for (const [width, height] of [[320, 900], [375, 900], [768, 900], [844, 390], [1440, 900]]) {
      errors.length = 0;
      await page.setViewport({ width, height });
      await page.goto(base + route, { waitUntil: "networkidle0" });
      await page.evaluate(() => document.fonts.ready);
      const stats = await measure(page);
      results.push({ route, ...stats, errors: [...errors] });
      assert.equal(errors.length, 0, errors.join("\n"));
      assert.ok(stats.scroll <= width + 1, "horizontal page overflow: " + JSON.stringify(stats));
      assert.equal(stats.clipped, false, "chart panel clipped");
      if (stats.minLabel != null) assert.ok(stats.minLabel >= 11.8, "chart label below 12px: " + JSON.stringify(stats));
      if (route.startsWith("/?") && width <= 560) assert.equal(stats.auctionDisplay, "flex", "mobile auction carousel");
      if (route.startsWith("/?") && width === 1440) {
        assert.ok(stats.cardWidth >= 230, "desktop card width");
        assert.ok(stats.navOverflow <= 1, "desktop navigation must fit");
        await page.$eval("#packList", (el) => el.scrollIntoView());
        await page.screenshot({ path: path.join(output, "desktop-cards.png") });
      }
      if (route.startsWith("/?") && width === 375) {
        await page.select("#quickSetSelect", "EB-03");
        await page.click("#quickSet button");
        assert.match(page.url(), /set=EB-03/);
        assert.equal(await page.$eval(".langTab.active", (el) => el.dataset.lang), "extra");
        await page.select("#quickSetSelect", "OP-08");
        await page.click("#quickSet button");
        await page.goBack();
        await page.waitForFunction(() => document.querySelector("#quickSetSelect").value === "EB-03");
        await page.goForward();
        await page.waitForFunction(() => document.querySelector("#quickSetSelect").value === "OP-08");
        await page.$eval('.opbcGridWrap:not([hidden]) svg', (el) => el.focus());
        await page.keyboard.press("Home");
        const first = await page.$eval(".opbcGridWrap:not([hidden]) .opbcReadout", (el) => el.textContent);
        await page.keyboard.press("End");
        const last = await page.$eval(".opbcGridWrap:not([hidden]) .opbcReadout", (el) => el.textContent);
        assert.notEqual(first, last, "keyboard chart selects different dates");
        await page.$eval(".opbcGridWrap:not([hidden])", (el) => el.scrollIntoView());
        await page.screenshot({ path: path.join(output, "mobile-chart.png") });
        await page.$eval(".packHero", (el) => el.scrollIntoView());
        await page.screenshot({ path: path.join(output, "mobile-home.png") });
        await page.click("#displayLangToggle");
        assert.equal(await page.$eval("#quickSet label span", (el) => el.textContent), "찾고 싶은 박스 세트");
        await page.click("#displayLangToggle");
      }
      if (route === "/tcg-auction.html" && width === 375) {
        const pinned = await page.$eval(".tgTableScroll", (el) => {
          const cell = el.querySelector("tbody th");
          const before = cell.getBoundingClientRect().left;
          el.scrollLeft = 400;
          return Math.abs(cell.getBoundingClientRect().left - before);
        });
        assert.ok(pinned < 1, "game label stays pinned");
        await page.focus(".opBars");
        await page.keyboard.press("Home");
        const first = await page.$eval("#trendReadout", (el) => el.textContent);
        await page.keyboard.press("End");
        assert.notEqual(first, await page.$eval("#trendReadout", (el) => el.textContent));
        await page.$eval("#tgTableTitle", (el) => el.scrollIntoView());
        await page.screenshot({ path: path.join(output, "mobile-table.png") });
      }
    }
  }
  console.log(JSON.stringify({ status: "PASS", combinations: results.length, output }, null, 2));
} catch (error) {
  results.push({ failure: error.message });
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  await browser?.close();
  server.kill();
}
