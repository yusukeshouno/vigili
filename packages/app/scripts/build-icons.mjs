#!/usr/bin/env node
/**
 * Sentinel.app の Asset Catalog 用に PWA の 4 弁花ロゴから:
 *   - MenuBarIcon (template image, 黒+透明、template flag を立てる前提)
 *   - AppIcon (角丸背景 + 花、全 10 サイズ)
 * を SVG → PNG 焼き出しで生成する。
 *
 * 実行: node packages/app/scripts/build-icons.mjs
 * 依存: packages/pwa/node_modules/sharp (既にインストール済み)
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
// SVG ソース
// ---------------------------------------------------------------------

/** メニューバー用: 単色テンプレ。背景なし、花だけ黒。 */
function menuBarSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <g fill="black" transform="translate(32 32) scale(1.55) translate(-16 -16)">
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(90 16 16)"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(180 16 16)"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(270 16 16)"/>
    <circle cx="16" cy="16" r="1.6"/>
  </g>
</svg>`;
}

/** Dock / Finder 用: PWA と揃えた角丸ダーク背景 + 花。 */
function appIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="14" fill="#262624"/>
  <g fill="#c96442" transform="translate(32 32) scale(1.55) translate(-16 -16)">
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(90 16 16)"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(180 16 16)"/>
    <path d="M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" transform="rotate(270 16 16)"/>
    <circle cx="16" cy="16" r="1.6"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------
// 出力先
// ---------------------------------------------------------------------

const assets = join(appRoot, "Assets.xcassets");

// MenuBarIcon imageset
const menuBarSet = join(assets, "MenuBarIcon.imageset");
mkdirSync(menuBarSet, { recursive: true });

// AppIcon set (既存。中身を埋め直す)
const appIconSet = join(assets, "AppIcon.appiconset");
mkdirSync(appIconSet, { recursive: true });

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

  // Contents.json: template-rendering 指定
  const contents = {
    images: [
      {
        idiom: "universal",
        filename: "MenuBarIcon@1x.png",
        scale: "1x",
      },
      {
        idiom: "universal",
        filename: "MenuBarIcon@2x.png",
        scale: "2x",
      },
    ],
    info: { author: "xcode", version: 1 },
    properties: { "template-rendering-intent": "template" },
  };
  writeFileSync(
    join(menuBarSet, "Contents.json"),
    JSON.stringify(contents, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------
// AppIcon: macOS は 16, 32, 64, 128, 256, 512, 1024 px (1x + 2x)
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
  { size: 512, scale: 2 }, // = 1024
];

// iOS は同じ pt サイズで @2x / @3x を出す。
// iPhone のみ前提だが iOS marketing 1024 は必須 (App Store / Xcode 内の表示)。
const iosIconSpec = [
  { size: 20, scale: 2, idiom: "iphone" },  // notification @2x
  { size: 20, scale: 3, idiom: "iphone" },  // notification @3x
  { size: 29, scale: 2, idiom: "iphone" },  // settings @2x
  { size: 29, scale: 3, idiom: "iphone" },
  { size: 40, scale: 2, idiom: "iphone" },  // spotlight @2x
  { size: 40, scale: 3, idiom: "iphone" },
  { size: 60, scale: 2, idiom: "iphone" },  // app @2x
  { size: 60, scale: 3, idiom: "iphone" },  // app @3x (180x180)
  { size: 1024, scale: 1, idiom: "ios-marketing" },
];

async function buildAppIcon() {
  const images = [];

  // macOS
  for (const { size, scale } of macIconSpec) {
    const px = size * scale;
    const filename = `app-mac-${size}x${size}@${scale}x.png`;
    const out = join(appIconSet, filename);
    const svg = Buffer.from(appIconSvg(px));
    await sharp(svg).resize(px, px).png().toFile(out);
    console.log("→", out);
    images.push({
      idiom: "mac",
      size: `${size}x${size}`,
      scale: `${scale}x`,
      filename,
    });
  }

  // iOS
  for (const { size, scale, idiom } of iosIconSpec) {
    const px = size * scale;
    const filename = `app-ios-${size}x${size}@${scale}x.png`;
    const out = join(appIconSet, filename);
    const svg = Buffer.from(appIconSvg(px));
    // iOS の 1024 marketing は α が許されない (App Store 上でアートとして表示)。
    // 他もアルファ無しで OK。flatten で背景を黒に固める (角丸は iOS が自動で被せる)。
    await sharp(svg)
      .resize(px, px)
      .flatten({ background: { r: 38, g: 38, b: 36 } })
      .png()
      .toFile(out);
    console.log("→", out);
    images.push({
      idiom,
      size: `${size}x${size}`,
      scale: `${scale}x`,
      filename,
    });
  }

  const contents = {
    images,
    info: { author: "xcode", version: 1 },
  };
  writeFileSync(
    join(appIconSet, "Contents.json"),
    JSON.stringify(contents, null, 2) + "\n",
  );
}

await buildMenuBar();
await buildAppIcon();
console.log("done.");
