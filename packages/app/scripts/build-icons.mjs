#!/usr/bin/env node
/**
 * Vigili.app の Asset Catalog 用に 8 突星ロゴから:
 *   - MenuBarIcon (template image, 黒+透明、template flag を立てる前提)
 *   - AppIcon (角丸背景 + 星、macOS 10 サイズ + iOS 9 サイズ)
 *   - MacAppIcon (Mac-only icon set)
 *   - PWA の icon.svg + icon-192.png + icon-512.png + apple-touch-icon.png
 * を SVG → PNG 焼き出しで生成する。
 *
 * 実行: node packages/app/scripts/build-icons.mjs
 * 依存: pnpm hoisted の sharp (PWA 経由で入る)
 *
 * 星型: 16 頂点 (8 突点 + 内側 8 頂点) の polygon。原典は Adobe Illustrator 出力で
 * viewBox 105×118.52、bbox 中心 (52.5, 59.26)。色は brand accent #ea5226。
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..", "..");

// pnpm の hoisted store から sharp を直接ロードする
const pnpmStore = join(repoRoot, "node_modules/.pnpm");
const sharpEntries = readdirSync(pnpmStore).filter((e) => e.startsWith("sharp@"));
if (sharpEntries.length === 0) {
  throw new Error("sharp not found in pnpm store");
}
const sharpPkgJson = join(pnpmStore, sharpEntries[0], "node_modules/sharp/package.json");
const require = createRequire(sharpPkgJson);
const sharp = require("sharp");

// ---------------------------------------------------------------------
// 共通定数
// ---------------------------------------------------------------------

/** brand accent (星の色)。PWA Brand component と揃える。 */
const ACCENT = "#ea5226";
/** brand background (角丸の中の色)。 */
const BG = "#262624";
/** 8 突点星 (16 頂点) の polygon points。
 * 原典の viewBox は 0 0 105 118.52、bbox 中心 (52.5, 59.26)。
 * 各 SVG 関数で `translate(32 32) scale(STAR_SCALE) translate(-52.5 -59.26)` を適用して
 * 64x64 canvas の中央に配置する。 */
const STAR_POINTS =
  "59.94 45.86 89.54 23.53 67.84 53.59 105 58.73 67.95 64.65 85.38 89.44 60.22 72.54 55.18 118.52 49.17 72.66 19.57 94.98 41.27 64.93 0 59.79 41.15 53.87 23.73 29.08 48.89 45.98 53.93 0";
/** 星のスケール。`scale * 118.52 ≈ 60` が 64x64 canvas に収まる目安。 */
const STAR_SCALE = 0.5;
const STAR_CENTER_X = 52.5;
const STAR_CENTER_Y = 59.26;

// ---------------------------------------------------------------------
// SVG ソース
// ---------------------------------------------------------------------

/** メニューバー用: 単色テンプレ。背景なし、星だけ黒。 */
function menuBarSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <g fill="black" transform="translate(32 32) scale(${STAR_SCALE}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})">
    <polygon points="${STAR_POINTS}"/>
  </g>
</svg>`;
}

/** Dock / Finder / iOS Home / PWA Home screen 用: 角丸ダーク背景 + 星。 */
function appIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="14" fill="${BG}"/>
  <g fill="${ACCENT}" transform="translate(32 32) scale(${STAR_SCALE}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})">
    <polygon points="${STAR_POINTS}"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------
// 出力先
// ---------------------------------------------------------------------

const assets = join(appRoot, "Assets.xcassets");
const menuBarSet = join(assets, "MenuBarIcon.imageset");
mkdirSync(menuBarSet, { recursive: true });
const appIconSet = join(assets, "AppIcon.appiconset");
mkdirSync(appIconSet, { recursive: true });
const macAppIconSet = join(assets, "MacAppIcon.appiconset");
mkdirSync(macAppIconSet, { recursive: true });
const pwaPublic = join(repoRoot, "packages/pwa/public");

// ---------------------------------------------------------------------
// MenuBarIcon: 16x16 + 32x32 PNG (template flag は Contents.json で指定)
// ---------------------------------------------------------------------

async function buildMenuBar() {
  for (const size of [16, 32]) {
    const out = join(menuBarSet, `MenuBarIcon@${size === 16 ? "1x" : "2x"}.png`);
    const svg = Buffer.from(menuBarSvg(size));
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log("→", out);
  }
  const contents = {
    images: [
      { idiom: "universal", filename: "MenuBarIcon@1x.png", scale: "1x" },
      { idiom: "universal", filename: "MenuBarIcon@2x.png", scale: "2x" },
    ],
    info: { author: "xcode", version: 1 },
    properties: { "template-rendering-intent": "template" },
  };
  writeFileSync(join(menuBarSet, "Contents.json"), JSON.stringify(contents, null, 2) + "\n");
}

// ---------------------------------------------------------------------
// AppIcon (legacy combined): macOS 10 + iOS 9
// ---------------------------------------------------------------------

const macIconSpec = [
  { size: 16, scale: 1 },
  { size: 16, scale: 2 },
  { size: 32, scale: 1 },
  { size: 32, scale: 2 },
  { size: 128, scale: 1 },
  { size: 128, scale: 2 },
  { size: 256, scale: 1 },
  { size: 256, scale: 2 },
  { size: 512, scale: 1 },
  { size: 512, scale: 2 },
];

const iosIconSpec = [
  { size: 20, scale: 2, idiom: "iphone" },
  { size: 20, scale: 3, idiom: "iphone" },
  { size: 29, scale: 2, idiom: "iphone" },
  { size: 29, scale: 3, idiom: "iphone" },
  { size: 40, scale: 2, idiom: "iphone" },
  { size: 40, scale: 3, idiom: "iphone" },
  { size: 60, scale: 2, idiom: "iphone" },
  { size: 60, scale: 3, idiom: "iphone" },
  { size: 1024, scale: 1, idiom: "ios-marketing" },
];

async function buildAppIcon() {
  const images = [];
  for (const { size, scale } of macIconSpec) {
    const px = size * scale;
    const filename = `app-mac-${size}x${size}@${scale}x.png`;
    const out = join(appIconSet, filename);
    const svg = Buffer.from(appIconSvg(px));
    await sharp(svg).resize(px, px).png().toFile(out);
    console.log("→", out);
    images.push({ idiom: "mac", size: `${size}x${size}`, scale: `${scale}x`, filename });
  }
  for (const { size, scale, idiom } of iosIconSpec) {
    const px = size * scale;
    const filename = `app-ios-${size}x${size}@${scale}x.png`;
    const out = join(appIconSet, filename);
    const svg = Buffer.from(appIconSvg(px));
    await sharp(svg)
      .resize(px, px)
      .flatten({ background: { r: 38, g: 38, b: 36 } })
      .png()
      .toFile(out);
    console.log("→", out);
    images.push({ idiom, size: `${size}x${size}`, scale: `${scale}x`, filename });
  }
  writeFileSync(
    join(appIconSet, "Contents.json"),
    JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------
// MacAppIcon (Mac-only set, used by some Mac targets)
// ---------------------------------------------------------------------

async function buildMacAppIcon() {
  const images = [];
  for (const { size, scale } of macIconSpec) {
    const px = size * scale;
    const filename = `app-mac-${size}x${size}@${scale}x.png`;
    const out = join(macAppIconSet, filename);
    const svg = Buffer.from(appIconSvg(px));
    await sharp(svg).resize(px, px).png().toFile(out);
    console.log("→", out);
    images.push({ idiom: "mac", size: `${size}x${size}`, scale: `${scale}x`, filename });
  }
  writeFileSync(
    join(macAppIconSet, "Contents.json"),
    JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------
// PWA: icon.svg + icon-192.png + icon-512.png + apple-touch-icon.png
// ---------------------------------------------------------------------

async function buildPwaIcons() {
  writeFileSync(join(pwaPublic, "icon.svg"), appIconSvg(512) + "\n");
  console.log("→", join(pwaPublic, "icon.svg"));
  for (const [size, name] of [
    [192, "icon-192.png"],
    [512, "icon-512.png"],
    [180, "apple-touch-icon.png"],
  ]) {
    const out = join(pwaPublic, name);
    const svg = Buffer.from(appIconSvg(size));
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log("→", out);
  }
}

await buildMenuBar();
await buildAppIcon();
await buildMacAppIcon();
await buildPwaIcons();
console.log("done.");
