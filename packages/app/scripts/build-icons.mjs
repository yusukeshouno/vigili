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
 * 星型: 20 頂点 (10 突点 + 内側 10 頂点) の不規則 polygon (v4 — sharper spikes)。原典
 * は Adobe Illustrator 出力で viewBox 105×118.52、bbox 中心 (52.5, 59.26)。色は brand
 * accent #c16141。
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
/** 10 突点星 v4 (sharper spikes) の SVG path (`d` 属性)。
 * 原典の viewBox は 0 0 105 118.52、bbox 中心 (52.5, 59.26)。bbox y 5.57..112.95、
 * 前 v3 よりも 縦に長い (= 突点が伸びてる)。
 * 各 SVG 関数で `translate(32 32) scale(STAR_SCALE) translate(-52.5 -59.26)` を適用して
 * 64x64 canvas の中央に配置する。 */
const STAR_PATH_D =
  "M57.7,43.49l27.2-32.6c.46-.55,1.32.04.97.67l-20.55,37.15c-.25.45.16.98.66.86l37.4-9.01c.68-.16,1.03.79.41,1.1l-33.5,16.96c-.45.23-.43.88.04,1.07l33.56,14.01c.66.27.36,1.26-.34,1.13l-36.59-7.24c-.5-.1-.88.44-.62.88l19.69,33.27c.36.61-.45,1.22-.94.71l-26.51-27.77c-.35-.37-.98-.15-1.02.36l-2.96,37.88c-.06.71-1.08.74-1.18.03l-5.07-37.64c-.07-.51-.71-.7-1.04-.3l-27.2,32.6c-.46.55-1.32-.04-.97-.67l20.55-37.15c.25-.45-.16-.98-.66-.86L1.62,77.95c-.68.16-1.03-.79-.41-1.1l33.5-16.96c.45-.23.43-.88-.04-1.07L1.11,44.81c-.66-.27-.36-1.26.34-1.13l36.59,7.24c.5.1.88-.44.62-.88L18.98,16.78c-.36-.61.45-1.22.94-.71l26.51,27.77c.35.37.98.15,1.02-.36l2.96-37.88c.06-.71,1.08-.74,1.18-.03l5.07,37.64c.07.51.71.7,1.04.3Z";
/** 星のスケール。v4 は突点が伸びたので、 STAR_SCALE を 0.48 → 0.44 に少し下げて
 * 64x64 canvas の中で突点が縁に当たらないよう余白を確保する。 */
const STAR_SCALE = 0.44;
const STAR_CENTER_X = 52.5;
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
