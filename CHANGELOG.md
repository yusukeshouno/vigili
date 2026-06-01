# Changelog

パッケージ追加の理由を一行で残す（CLAUDE.md 規約）。

## Unreleased

- `jose` (packages/relay): Sign in with Apple の identity token を検証するため。Apple JWKS の取得・鍵ローテーション・RS256 署名検証・claim 検証を自前実装するより安全。`pnpm-lock.yaml` に既に transitive 依存として存在するため追加ダウンロードは発生しない。
