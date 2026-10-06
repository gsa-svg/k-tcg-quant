/** Local derivatives only. Never fetch, replace originals or modify price data. */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..", "card-img", "box");

/** Produce the small grid image when a new original is added (or explicitly refreshed). */
async function ensureBoxThumbnail(code, force = false, directory = root) {
  if (!/^(OP|EB|PRB)-\d{2}$/.test(code)) throw new Error("Invalid box code");
  const source = path.join(directory, `${code}.webp`);
  const output = path.join(directory, "thumb", `${code}.webp`);
  if (!fs.existsSync(source) || (!force && fs.existsSync(output))) return false;
  const buffer = await sharp(source).resize({ width: 220, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output) && fs.readFileSync(output).equals(buffer)) return false;
  fs.writeFileSync(output, buffer);
  return true;
}

module.exports = { ensureBoxThumbnail };
if (require.main === module) (async () => {
  let created = 0;
  for (const file of fs.readdirSync(root).filter((f) => /^(OP|EB|PRB)-\d{2}\.webp$/.test(f))) {
    if (await ensureBoxThumbnail(file.slice(0, -5))) created++;
  }
  console.log(JSON.stringify({ created }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
