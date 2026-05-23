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

/** brand accent (星の色)。PWA Brand component と揃える。Claude coral (smoothed)。 */
const ACCENT = "#c16141";
/** brand background (角丸の中の色)。 */
const BG = "#262624";
/** 8 突点星 の SVG path (`d` 属性)。
 * 原典の viewBox は 0 0 105 118.52、bbox 中心 (52.5, 59.26)。
 * Adobe Illustrator 出力で各突点に滑らかな curve が入ったバージョン (v2)。
 * 各 SVG 関数で `translate(32 32) scale(STAR_SCALE) translate(-52.5 -59.26)` を適用して
 * 64x64 canvas の中央に配置する。 */
const STAR_PATH_D =
  "M60.75,45.25l25.6-19.31c.55-.42,1.26.27.85.83l-18.77,26c-.27.37-.04.89.41.95l32.16,4.45c.69.09.7,1.08.01,1.19l-32.1,5.12c-.44.07-.65.58-.4.94l15,21.35c.38.55-.27,1.22-.83.85l-21.65-14.55c-.37-.25-.87-.02-.93.42l-4.37,32.28c-.09.69-1.08.7-1.19.02l-5.2-32.16c-.07-.45-.6-.66-.96-.39l-25.6,19.31c-.55.42-1.26-.27-.85-.83l18.76-25.99c.27-.37.04-.89-.41-.95l-35.8-4.46c-.7-.09-.71-1.1-.01-1.2l35.73-5.13c.45-.06.67-.58.41-.94l-14.99-21.33c-.38-.55.27-1.22.83-.85l21.65,14.54c.37.25.88.02.93-.42l4.37-33.99c.09-.69,1.09-.7,1.19-.01l5.21,33.86c.07.45.59.66.96.39Z";
/** 星のスケール。`scale * 118.52 ≈ 50` で 64x64 canvas に余白付きで収める。
 * 0.5 だと iOS Home / Mac Dock で詰まって見えたので 0.42 に。 */
const STAR_SCALE = 0.42;
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

/** Dock / Finder / iOS Home / PWA Home screen 用: 角丸ダーク背景 + 星。 */
function appIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="14" fill="${BG}"/>
  <g fill="${ACCENT}" transform="translate(32 32) scale(${STAR_SCALE}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})">
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
