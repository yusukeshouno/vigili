/**
 * Regenerate app icon PNGs from the SVG template using rsvg-convert.
 * Run: node packages/app/scripts/gen-icons.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "/Users/shounoyusuke/Dropbox (個人)/sentinel";
const APPICONSET = `${REPO}/packages/app/Assets.xcassets/AppIcon.appiconset`;
const MACAPPICONSET = `${REPO}/packages/app/Assets.xcassets/MacAppIcon.appiconset`;
const RSVG = "/opt/homebrew/bin/rsvg-convert";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="230" fill="#c16141"/>
  <g fill="#f5edd3" transform="translate(512 512) scale(4.29) translate(-52.5 -59.26)">
    <path d="M57.7,43.49l27.2-32.6c.46-.55,1.32.04.97.67l-20.55,37.15c-.25.45.16.98.66.86l37.4-9.01c.68-.16,1.03.79.41,1.1l-33.5,16.96c-.45.23-.43.88.04,1.07l33.56,14.01c.66.27.36,1.26-.34,1.13l-36.59-7.24c-.5-.1-.88.44-.62.88l19.69,33.27c.36.61-.45,1.22-.94.71l-26.51-27.77c-.35-.37-.98-.15-1.02.36l-2.96,37.88c-.06.71-1.08.74-1.18.03l-5.07-37.64c-.07-.51-.71-.7-1.04-.3l-27.2,32.6c-.46.55-1.32-.04-.97-.67l20.55-37.15c.25-.45-.16-.98-.66-.86L1.62,77.95c-.68.16-1.03-.79-.41-1.1l33.5-16.96c.45-.23.43-.88-.04-1.07L1.11,44.81c-.66-.27-.36-1.26.34-1.13l36.59,7.24c.5.1.88-.44.62-.88L18.98,16.78c-.36-.61.45-1.22.94-.71l26.51,27.77c.35.37.98.15,1.02-.36l2.96-37.88c.06-.71,1.08-.74,1.18-.03l5.07,37.64c.07.51.71.7,1.04.3Z"/>
  </g>
</svg>`;

const TMPL = join(tmpdir(), "vigili-icon-template.svg");
writeFileSync(TMPL, SVG);

function convert(size) {
  return new Promise((resolve, reject) => {
    const out = join(tmpdir(), `vigili-icon-${size}.png`);
    const p = spawn(RSVG, ["-w", size, "-h", size, TMPL, "-o", out]);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`rsvg exit ${code} for ${size}`))
    );
    p.on("error", reject);
  });
}

async function main() {
  const log = (m) => console.log(`[gen-icons] ${m}`);

  const ios = [
    [40, "app-ios-20x20@2x.png"],
    [60, "app-ios-20x20@3x.png"],
    [58, "app-ios-29x29@2x.png"],
    [87, "app-ios-29x29@3x.png"],
    [80, "app-ios-40x40@2x.png"],
    [120, "app-ios-40x40@3x.png"],
    [120, "app-ios-60x60@2x.png"],
    [180, "app-ios-60x60@3x.png"],
    [1024, "app-ios-1024x1024@1x.png"],
  ];

  const mac = [
    [16,   "app-mac-16x16@1x.png"],
    [32,   "app-mac-16x16@2x.png"],
    [32,   "app-mac-32x32@1x.png"],
    [64,   "app-mac-32x32@2x.png"],
    [128,  "app-mac-128x128@1x.png"],
    [256,  "app-mac-128x128@2x.png"],
    [256,  "app-mac-256x256@1x.png"],
    [512,  "app-mac-256x256@2x.png"],
    [512,  "app-mac-512x512@1x.png"],
    [1024, "app-mac-512x512@2x.png"],
  ];

  const sizes = [...new Set([...ios.map(([s]) => s), ...mac.map(([s]) => s)])];
  const cache = {};
  for (const size of sizes) {
    log(`rendering ${size}x${size}…`);
    cache[size] = await convert(size);
  }

  for (const [size, name] of ios) {
    copyFileSync(cache[size], `${APPICONSET}/${name}`);
  }
  log(`iOS icons written (${ios.length})`);

  for (const [size, name] of mac) {
    copyFileSync(cache[size], `${APPICONSET}/${name}`);
    copyFileSync(cache[size], `${MACAPPICONSET}/${name}`);
  }
  log(`Mac icons written (${mac.length * 2})`);
  log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
