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
 * 星型: 20 頂点 (10 突点 + 内側 10 頂点) の不規則 polygon (v3)。原典は Adobe Illustrator
 * 出力で viewBox 105×118.52、bbox 中心 (52.51, 59.26)。色は brand accent #c16141。
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

/** brand accent (in-app UI: ボタン、リング、tag 等の色)。 */
const ACCENT = "#c16141";
/** in-app の背景色 (PWA / popover の dark 基調)。 */
const BG = "#262624";

// --- アプリアイコンだけ別配色 (角丸 coral + cream 星) ---
/** アプリアイコンの角丸 rect 色 (coral)。 */
const ICON_BG = "#c16141";
/** アプリアイコンの星の塗り色 (薄黄クリーム)。 */
const ICON_STAR = "#f5edd3";
/** 10 突点星 v3 の SVG path (`d` 属性)。
 * 原典の viewBox は 0 0 105 118.52、bbox 中心 (52.51, 59.26)。
 * Adobe Illustrator 出力で各突点に軽い curve が入る。
 * 各 SVG 関数で `translate(32 32) scale(STAR_SCALE) translate(-52.51 -59.26)` を適用して
 * 64x64 canvas の中央に配置する。 */
const STAR_PATH_D =
  "M58.7,40.35l24.64-27.36c.54-.6,1.49.05,1.13.77l-16.58,32.87c-.26.51.18,1.1.75.99l32.42-6.32c.76-.15,1.15.89.48,1.27l-27.71,15.96c-.48.28-.45.98.05,1.22l28.04,13.29c.72.34.39,1.42-.4,1.3l-34.65-5.08c-.58-.08-.99.54-.69,1.04l17.59,28.61c.42.69-.48,1.42-1.06.86l-22.96-22.03c-.41-.39-1.09-.15-1.16.41l-3.96,32.38c-.1.78-1.22.82-1.36.04l-5.76-32.08c-.1-.56-.81-.77-1.19-.34l-24.64,27.36c-.54.6-1.49-.05-1.13-.77l16.58-32.87c.26-.51-.18-1.1-.75-.99l-32.42,6.32c-.76.15-1.15-.89-.48-1.27l27.71-15.96c.48-.28.45-.98-.05-1.22L3.09,45.47c-.72-.34-.39-1.42.4-1.3l34.65,5.08c.58.08.99-.54.69-1.04l-17.59-28.61c-.42-.69.48-1.42,1.06-.86l22.96,22.03c.41.39,1.09.15,1.16-.41l3.96-32.38c.1-.78,1.22-.82,1.36-.04l5.76,32.08c.1.56.81.77,1.19.34Z";
/** 星のスケール。`scale * 102.6 ≈ 49` で 64x64 canvas にちょうど良い余白で収める。
 * 元 0.5 → 0.42 → 0.48 → 10 突点 v3 でも 0.48 のまま (bbox がやや広がるので結果として
 * 突点がアイコン縁ぎりぎりまで届く)。 */
const STAR_SCALE = 0.48;
const STAR_CENTER_X = 52.51;
const STAR_CENTER_Y = 59.26;

// ---------------------------------------------------------------------
// SVG ソース
// ---------------------------------------------------------------------

/** メニューバー用: 単色テンプレ。背景なし、星だけ黒。 */
function menuBarSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <g fill="black" transform="translate(32 32) scale(${STAR_SCALE}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})">
    <path d="${STAR_PATH_D}"/>
  </g>
</svg>`;
}

/** Dock / Finder / iOS Home / PWA Home screen 用: 角丸 coral 背景 + cream 星。 */
function appIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="14" fill="${ICON_BG}"/>
  <g fill="${ICON_STAR}" transform="translate(32 32) scale(${STAR_SCALE}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})">
    <path d="${STAR_PATH_D}"/>
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
