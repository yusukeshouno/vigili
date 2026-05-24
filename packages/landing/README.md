# @vigili/landing

vigili.io のランディングページ。Next.js 15 (App Router) + Tailwind v4。

## 構成

```
src/
├── app/
│   ├── layout.tsx        # <html> + global metadata + globals.css
│   ├── page.tsx          # 1 ページ縦スクロール。?lang=ja で日本語切替
│   └── globals.css       # PWA と同じ @theme トークン
├── components/
│   ├── TopBar.tsx        # ロゴ + 言語トグル + Get notified
│   ├── Hero.tsx          # 大見出し + waitlist form
│   ├── WaitlistForm.tsx  # client component、submitWaitlist server action 呼び出し
│   ├── Section.tsx       # eyebrow + title + body の共通ラッパー
│   ├── WhySection.tsx    # 解きたい問題 3 つ
│   ├── HowSection.tsx    # 3 ステップ
│   ├── SecuritySection.tsx
│   ├── Footer.tsx
│   └── StarMark.tsx      # 8 突点星ロゴ (Sources/Shared/StarPath.swift と同形)
└── lib/
    ├── copy.ts           # EN / JA の全文言、ここだけ変えれば文言更新可
    └── waitlist.ts       # server action — env WAITLIST_WEBHOOK_URL に POST
```

## ローカルで動かす

```bash
pnpm install
pnpm --filter @vigili/landing dev      # http://localhost:3739
```

`?lang=ja` を付けると日本語版。

## Waitlist の配線

server action `submitWaitlist` は環境変数 `WAITLIST_WEBHOOK_URL` に JSON POST します:

```json
{
  "email": "you@example.com",
  "lang": "en",
  "user_agent": "...",
  "received_at": "2026-05-24T01:23:45.000Z"
}
```

設定例:
- **Notion**: Database API endpoint
- **Slack**: Incoming webhook
- **Resend / Loops / ConvertKit**: それぞれの subscribe API
- **自前**: 任意の `POST /webhook` を受ける関数

`WAITLIST_WEBHOOK_URL` 未設定だと、stderr に warn ログを出すだけで 200 を返す
(LP は動くがデータは保存されない)。Vercel デプロイ時に必ず設定すること。

## Vercel へのデプロイ

`vigili.io` を Vercel プロジェクトに紐付ける想定。

1. Vercel で新規プロジェクト、リポジトリを連携
2. Root Directory: monorepo ルートのまま (`vercel.json` がビルドコマンドを指定)
3. Environment Variables:
   - `WAITLIST_WEBHOOK_URL` = (任意の webhook URL)
4. Production Domain: `vigili.io` (Apex + `www` 両方)
5. `relay.vigili.io` の subdomain は別 (VPS) なので DNS は触らない

## 文言を変える

`src/lib/copy.ts` の `en` / `ja` オブジェクトだけ編集。
セクションを増減したい時は `src/app/page.tsx` で並びを変える。

## デザイントークン

`src/app/globals.css` の `@theme` ブロック。PWA と完全に揃えてある:

- 背景 `#262624` + cream text
- accent `#c16141` (smoothed coral)
- border は `rgba(250,247,242,0.08)` の温かいクリーム
- 表示フォントは system (SF Pro)。LP では bundled font は使わない (FOIT 回避 + 軽量化)
