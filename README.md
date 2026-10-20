# Flick

開いた瞬間メモでき、フリックでタスクのステータスを動かすモバイルファーストのタスク管理 Web アプリ。

- 右フリック: 未着手 → 進行中 → 完了 / 左フリック: ひとつ戻す（未着手ならアーカイブ、取り消し可）
- 「今日」画面がホーム。その日最初に開くと、全タスクから今日やるものをタップで選ぶ（期限が今日までのものは自動で入る。日の切り替わりは 04:00）
- タスクごとのメモ（自動保存）とファイル添付（写真は自動圧縮、1 ファイル 10MB・1 人 100MB まで）、Google ドライブからリンクで添付
- AI（Workers AI）: メモの整理とタスク分解・期限抽出 / サブタスク提案（タスクのメモも参照） / 朝の選択画面での「AI おすすめ」
- Google ログインのみ
- PWA（ホーム画面に追加可、オフラインでもメモ可能）

## 技術構成と選定理由

| 領域 | 採用 | 理由 |
|---|---|---|
| ホスティング | Cloudflare Workers + Static Assets | API と画面を 1 つの Worker で配信。エッジ配信で初回表示が速く、無料枠が大きい。デプロイが `wrangler deploy` 1 回で済む |
| API | [Hono](https://hono.dev/) | Workers 向けに設計された軽量フレームワーク。型付きルーティングと `app.request()` によるテストのしやすさ |
| 添付ファイル | Workers KV | カード登録なしの無料プランで使え、上限を超えても課金されずエラーになるだけ。1 ファイル 25MB まで保存でき、写真を端末側で圧縮すれば 1GB の無料枠で十分。危険なファイル形式はサンドボックス付きのダウンロードとして返す |
| Google ドライブ | Google Picker + `drive.file` スコープ | Google 公式の選択画面で、ログイン中と同じアカウントのドライブから選べる。`drive.file` は「選んだファイルだけ」にアクセスする最小権限で、Google の区分でも非機密。リフレッシュトークンは AES-GCM で暗号化して D1 に保存。ファイルはリンクとして添付するので容量を使わない |
| DB | Cloudflare D1 | Workers から直接使える SQLite。タスク管理の規模には十分で、無料枠内で運用できる |
| AI | Workers AI（整理: `@cf/openai/gpt-oss-120b` / サブタスク・今日: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`） | Worker のバインディングから直接呼べて API キー管理が不要。2026-10 に 7 モデルを実測し、相対日付（明日・来週月曜など）が正確だった gpt-oss-120b を整理に、約 1 秒と速い Llama 3.3 をその他に採用。日付計算はカレンダー表をプロンプトに渡して補助。モデルは `AI_MODEL` / `AI_MODEL_FAST` で差し替え可能 |
| 認証 | Google OIDC（[Arctic](https://arcticjs.dev/)）+ D1 セッション | Google だけなら大型の認証ライブラリは不要。Authorization Code + PKCE + state、HttpOnly Cookie、セッショントークンは SHA-256 ハッシュのみ保存 |
| 画面 | React 19 + Vite + TypeScript | 部品化しやすく、ビルドが速い。型で AI 生成コードのミスを減らす |
| アニメーション | [Motion](https://motion.dev/) | フリックのドラッグ追従・速度判定・スプリング・レイアウトアニメーション・出入りアニメーションを 1 つでまかなえる |
| リキッドグラス | 自作 CSS + SVG フィルター | `backdrop-filter` のすりガラスに、Chromium では `feDisplacementMap` による屈折を重ねる。白ベースでの見え方を細かく調整するため自作 |
| 瞬間起動 | 入力欄を `index.html` に直書き + localStorage キャッシュ + PWA | JS が届く前から入力でき、打った内容は保存される。2 回目以降は Service Worker から即表示 |
| テスト | Vitest + `@cloudflare/vitest-plugin` / Playwright | API は本番と同じ Workers ランタイムで検証。画面はスマホサイズでのフリック操作まで自動テスト |

## 開発

```bash
npm install
cp .dev.vars.example .dev.vars   # DEV_AUTH=1 / AI_MOCK=1 でローカル完結
npm run db:migrate:local
npm run dev                      # http://localhost:5173/api/auth/dev-login でテストユーザーとしてログイン
```

本物の Workers AI を使う場合は `npx wrangler login` のあと `.dev.vars` の `AI_MOCK` を消し、`CF_REMOTE=1 npm run dev`。

## テスト

```bash
npm test          # API（Workers ランタイム上）
npm run e2e       # 画面（本番ビルド + Chromium のスマホ表示）
npm run typecheck
```

## デプロイ

```bash
npx wrangler d1 create flick            # 出力された database_id を wrangler.jsonc に記入
npm run db:migrate:remote
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy
```

`wrangler.jsonc` の `GOOGLE_CLIENT_ID` に OAuth クライアント ID を設定する。Google Cloud Console の承認済みリダイレクト URI は `https://<本番ドメイン>/api/auth/callback`。

`DEV_AUTH` と `AI_MOCK` は本番に設定しないこと（`.dev.vars` のみ）。
