#!/usr/bin/env bash
# notarize-dmg.sh — Vigili Mac を Developer ID で署名・公証・DMG 化するスクリプト。
#
# 事前に必要なもの:
#   1. Developer ID Application 証明書が Keychain に入っていること
#      (Xcode → Settings → Accounts → Manage Certificates で生成)
#   2. App Store Connect API Key を発行して環境変数に設定:
#      NOTARY_KEY_ID    例: ABCD123456
#      NOTARY_KEY_PATH  例: /path/to/AuthKey_ABCD123456.p8
#      NOTARY_ISSUER    例: 69a6de7e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# 使い方:
#   cd packages/app
#   NOTARY_KEY_ID=... NOTARY_KEY_PATH=... NOTARY_ISSUER=... ./scripts/notarize-dmg.sh
#
set -euo pipefail

APP_NAME="Vigili"
SCHEME="Vigili"
TEAM_ID="2DG598WNT9"
BUNDLE_ID="io.vigili.app"
ARCHIVE_PATH="/tmp/${APP_NAME}.xcarchive"
EXPORT_DIR="/tmp/${APP_NAME}-export"
APP_PATH="${EXPORT_DIR}/${APP_NAME}.app"
DMG_DIR="/tmp/${APP_NAME}-dmg"
DMG_PATH="$(pwd)/build/${APP_NAME}.dmg"

# API Key の確認
: "${NOTARY_KEY_ID:?Set NOTARY_KEY_ID}"
: "${NOTARY_KEY_PATH:?Set NOTARY_KEY_PATH}"
: "${NOTARY_ISSUER:?Set NOTARY_ISSUER}"

mkdir -p "$(pwd)/build"

echo "==> [1/6] xcodegen generate"
xcodegen generate

echo "==> [2/6] Archive (Release)"
xcodebuild archive \
  -scheme "${SCHEME}" \
  -configuration Release \
  -archivePath "${ARCHIVE_PATH}" \
  -destination "generic/platform=macOS" \
  CODE_SIGN_IDENTITY="Developer ID Application" \
  DEVELOPMENT_TEAM="${TEAM_ID}" \
  | xcpretty --simple || true

echo "==> [3/6] Export (Developer ID)"
xcodebuild -exportArchive \
  -archivePath "${ARCHIVE_PATH}" \
  -exportPath "${EXPORT_DIR}" \
  -exportOptionsPlist "$(pwd)/ExportOptions-DevID.plist"

echo "==> [4/6] Notarize"
xcrun notarytool submit "${APP_PATH}" \
  --key "${NOTARY_KEY_PATH}" \
  --key-id "${NOTARY_KEY_ID}" \
  --issuer "${NOTARY_ISSUER}" \
  --wait \
  --output-format json | tee /tmp/notarize-result.json

STATUS=$(python3 -c "import json,sys; print(json.load(open('/tmp/notarize-result.json'))['status'])")
if [ "${STATUS}" != "Accepted" ]; then
  echo "✗ Notarization failed: ${STATUS}"
  exit 1
fi
echo "✓ Notarization accepted"

echo "==> [5/6] Staple"
xcrun stapler staple "${APP_PATH}"

echo "==> [6/6] Create DMG"
rm -rf "${DMG_DIR}"
mkdir -p "${DMG_DIR}"
cp -R "${APP_PATH}" "${DMG_DIR}/"
# Applications ショートカット
ln -s /Applications "${DMG_DIR}/Applications"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${DMG_DIR}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

# DMG 自体も公証 (macOS 13+ では推奨)
xcrun notarytool submit "${DMG_PATH}" \
  --key "${NOTARY_KEY_PATH}" \
  --key-id "${NOTARY_KEY_ID}" \
  --issuer "${NOTARY_ISSUER}" \
  --wait

xcrun stapler staple "${DMG_PATH}"

echo ""
echo "✓ 完成: ${DMG_PATH}"
echo "  サイズ: $(du -sh "${DMG_PATH}" | cut -f1)"
