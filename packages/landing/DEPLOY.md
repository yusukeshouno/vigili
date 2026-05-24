# Vigili Landing — 公開手順

`vigili.io` ルートに LP を出すまでの一筆書き。所要時間 30〜60 分。

`relay.vigili.io` (Cloud Relay) は VPS で別に動いているので DNS は触らない。

---

## 0. 前提

- `vigili.io` ドメインを所有 (Squarespace / Cloudflare / Namecheap 等のレジストラに登録済み)
- GitHub に `yusukeshouno/vigili` repo がある (現在 private 想定)
- Vercel アカウント (個人 Hobby プランで OK、無料)
- (推奨) Resend アカウント — メール収集用

---

## 1. Resend を準備 (waitlist 収集先)

1. https://resend.com にサインアップ
2. **Domains** → Add Domain → `vigili.io` を追加。DNS に SPF / DKIM レコードを足す。
   - launch まで送らない場合は後回しでも可、Audiences API は domain verify 不要。
3. **Audiences** → "Create Audience" → `Vigili Launch Waitlist` 等の名前で作成
4. Audience の **General Settings** から ID をコピー (`aud_xxxx...` 形式)
5. **API Keys** → Full access キーを 1 つ発行、`re_xxxx...` をコピー

`RESEND_API_KEY` と `RESEND_AUDIENCE_ID` の 2 つができれば OK。

---

## 2. Vercel プロジェクトを作る

1. https://vercel.com/new → Import Git Repository → `yusukeshouno/vigili` を選択
2. **Project Name**: `vigili-landing` 等 (URL の prefix にもなる)
3. **Framework Preset**: Next.js (自動検出)
4. **Root Directory**: `./` のまま (monorepo の root)
   - `vercel.json` (packages/landing 配下) が `buildCommand` / `outputDirectory` を上書きする
5. **Environment Variables** に下記を追加 (Production / Preview 両方):
   - `RESEND_API_KEY` = (Resend からコピーした key)
   - `RESEND_AUDIENCE_ID` = (Audience ID)
   - 代わりに / 並行で webhook 路線を使うなら `WAITLIST_WEBHOOK_URL` も可
6. **Deploy** を押す → 1 分弱でビルド完了
7. Vercel のサジェストする `vigili-landing-xxxx.vercel.app` を開いて疎通確認

> ⚠️ `vercel.json` の `outputDirectory` を Vercel が読み損ねるケースがあったら、
> Vercel UI の "Build & Development Settings" を以下で上書きする:
>
> - Build Command: `pnpm --filter @vigili/landing build`
> - Output Directory: `packages/landing/.next`
> - Install Command: `pnpm install --frozen-lockfile`

---

## 3. DNS を vigili.io ルートに紐付ける

Vercel project → **Settings → Domains** で `vigili.io` を Add domain。
Vercel が DNS の指示を出してくれる。レジストラ側で:

- **Apex (`vigili.io`)** → A record `76.76.21.21` (Vercel の anycast)
- **`www.vigili.io`** → CNAME `cname.vercel-dns.com`

(Cloudflare の場合は CNAME flattening が効くので Apex を CNAME にしても OK)

`relay.vigili.io` の A レコードはそのまま (`153.126.136.207`) — Vercel は触らない。

伝播確認:

```bash
dig +short vigili.io
# → 76.76.21.21
dig +short relay.vigili.io
# → 153.126.136.207  (元のまま)
```

Vercel ダッシュボードで両ドメイン横に緑のチェック ✓ が出るのを待つ (5〜30 分)。

---

## 4. 動作確認

```bash
# トップが返ること
curl -fsSL https://vigili.io/ | head -20

# JA 切替が効くこと
curl -fsSL 'https://vigili.io/?lang=ja' | grep -o 'スマホ'

# OG 画像が出ること
open 'https://vigili.io/opengraph-image'

# robots / sitemap
curl https://vigili.io/robots.txt
curl https://vigili.io/sitemap.xml

# Privacy ページ
curl -fsSL https://vigili.io/privacy | head -5
```

**Twitter / Slack でのプレビュー**: https://cards-dev.twitter.com/validator や
Slack に URL を貼って OG が出るか確認。

**Vercel Analytics**: Vercel Dashboard → Analytics タブで visit が刻まれる。

**Waitlist の動作**: 自分のメールアドレスで submit → Resend Dashboard の
Audiences で contacts に増えていることを確認。

---

## 5. 公開後の継続運用

- 文言を変えたい: `packages/landing/src/lib/copy.ts` の `en` / `ja` 編集 → push → Vercel 自動デプロイ
- セクション増減: `packages/landing/src/app/page.tsx` の並び順を変える
- 新ページを足す: `packages/landing/src/app/<route>/page.tsx` を追加 (Next.js App Router)
- launch 時のメール送信:
  ```bash
  curl -X POST https://api.resend.com/emails \
    -H "authorization: Bearer $RESEND_API_KEY" \
    -H "content-type: application/json" \
    -d '{
      "from": "Vigili <hello@vigili.io>",
      "to": "audiences:<RESEND_AUDIENCE_ID>",
      "subject": "Vigili is live.",
      "html": "..."
    }'
  ```

---

## 6. ハマりどころ

- **Vercel build fails: "Cannot find module @vigili/shared"**
  → landing は @vigili/shared に依存しない。もし将来依存させたら、
  workspace ルートで `pnpm install` してから `pnpm --filter @vigili/landing build` の順を守る。
  vercel.json の installCommand と buildCommand で既にそうなっている。
- **OG 画像が出ない**
  → `/opengraph-image` が edge runtime で動くため、Vercel のリージョン設定に注意。
  `vercel.json` の `regions: ["nrt1"]` は Edge functions も含む。
- **Resend 422 "Contact already exists"**
  → 同じ email で 2 度 submit したとき。waitlist.ts では 422 を成功扱いにしているので
  ユーザには「✓」が出る。Resend 側で重複は自動排除されている。
- **`?lang=ja` が効かない**
  → page.tsx の searchParams が Next.js 15 で Promise になった。fetch を意識した
  キャッシュ動作のため。実装は対応済み。
