#!/usr/bin/env node
/**
 * Converts the official Japanese images verified against the TCG Quant
 * references into self-hosted WebP files. This avoids CDN drift and keeps
 * card variants tied to the exact official suffix used by the data repair.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const sourceDir = path.join(root, "tmp-prb-op13-official");
const outputDir = path.join(root, "img", "jp");

const images = [
  "PRB01_OP05-119_p4.png",
  "PRB01_EB01-006_p3.png",
  "PRB01_OP01-016_p1.png",
  "PRB01_OP06-118_p2.png",
  "PRB01_OP01-120_p2.png",
  "PRB01_OP02-013_p2.png",
  "PRB01_OP05-069_p3.png",
  "PRB01_OP05-074_p5.png",
  "PRB01_OP04-083_p2.png",
  "OP13_OP13-091_p2.png",
  "OP13_OP13-119_p4.png"
];

const verifiedManualImages = [
  { sourceName: "opboxindex-prb-don-zoro-gold.jpg", outputName: "PRB01-DON-zoro-gold.webp" }
];

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const sourceName of images) {
    const sourcePath = path.join(sourceDir, sourceName);
    const outputName = sourceName.replace(/^PRB01_|^OP13_/, "").replace(/\.png$/, ".webp");
    const outputPath = path.join(outputDir, outputName);
    if (!fs.existsSync(sourcePath)) {
      if (fs.existsSync(outputPath)) {
        continue;
      }
      throw new Error(`Missing verified source image: ${sourceName}`);
    }

    await sharp(sourcePath).webp({ quality: 88 }).toFile(outputPath);
  }

  for (const { sourceName, outputName } of verifiedManualImages) {
    const sourcePath = path.join(os.tmpdir(), sourceName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing verified source image: ${sourceName}`);
    }
    await sharp(sourcePath).webp({ quality: 88 }).toFile(path.join(outputDir, outputName));
  }

  console.log(`Self-hosted ${images.length + verifiedManualImages.length} verified Japanese card images.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
