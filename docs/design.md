# Flick — 設計書

2026-10-18 / 承認済み

## 目的
開いた瞬間にメモでき、フリックだけでタスクの状態を動かせるモバイルファーストのタスク管理 Web アプリ。

## 要件
- 起動直後から入力欄にフォーカス。JS 読み込み前に打った文字も保持する
- タスクのステータスは 3 段階: `todo`（未着手）→ `doing`（進行中）→ `done`（完了）
  - 右フリック: 次へ / 左フリック: 前へ / `todo` で左フリック: アーカイブ（取り消し可能）
- 白ベースのリキッドグラス UI、アニメーション多用（`prefers-reduced-motion` では抑制）
- 初回ロードは全画面スケルトン。入力欄だけは常に使える
- キャッチコピーなし。ログイン画面はアプリ名と「Google でログイン」のみ
- 認証は Google のみ
- AI（Workers AI）
  1. 整理: 生メモ → 誤変換・話し言葉を整形 → 複数タスクに分解 → 期限抽出
  2. サブタスク提案
  3. 今日やること 3 つ（理由付き）
  - 1 ユーザー 1 日あたりの回数上限あり

## アーキテクチャ
単一の Cloudflare Worker が API（Hono）と静的アセット（Vite ビルドの React SPA）を配信する。

```
ブラウザ (React SPA + Service Worker + localStorage キャッシュ)
   │  /api/*            │ その他
   ▼                    ▼
Worker (Hono) ──── Static Assets
   ├─ D1  (users / sessions / tasks / ai_usage)
   └─ Workers AI
```

### データモデル（D1）
- `users(id, google_sub UNIQUE, email, name, picture, created_at)`
- `sessions(id_hash PK, user_id, expires_at)` — Cookie にはランダムトークン、DB には SHA-256 ハッシュのみ保存
- `tasks(id PK(クライアント生成 UUID), user_id, title, status, parent_id, due_date, position, created_at, updated_at, archived_at)`
- `ai_usage(user_id, day, count)`

### API
| メソッド | パス | 内容 |
|---|---|---|
| GET | /api/auth/google | Google へリダイレクト（state + PKCE） |
| GET | /api/auth/callback | コード交換 → ユーザー作成 → セッション Cookie |
| POST | /api/auth/logout | セッション削除 |
| GET | /api/auth/dev-login | **DEV_AUTH=1 のときのみ**テスト用ログイン |
| GET | /api/me | ログイン中のユーザー |
| GET | /api/tasks | 自分のタスク一覧（アーカイブ除く） |
| PUT | /api/tasks/:id | 作成または更新（冪等、updated_at が新しい方が勝つ） |
| POST | /api/ai/organize | 生メモ → タスク案 |
| POST | /api/ai/subtasks | タスク → サブタスク案 |
| POST | /api/ai/today | 今日やること 3 つ |

### 同期
クライアントは楽観的更新。変更は localStorage のキュー（outbox）に入れて順次 PUT。オフラインでも入力でき、復帰後に送信される。ID はクライアント生成なので再送しても重複しない。

### 認証のセキュリティ
- OAuth: Authorization Code + PKCE + state（Arctic）
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`、30 日
- 変更系 API は `Origin` ヘッダーを検査して CSRF を防ぐ
- 全タスク操作は `user_id` で絞り込み、他人のタスクに触れない

## テスト
- Vitest + `@cloudflare/vitest-pool-workers`: 認証ガード、タスク CRUD、他ユーザー分離、AI 応答の整形（AI はモック）、回数上限
- Playwright（iPhone エミュレーション）: 起動直後のフォーカス、JS 前入力の保持、メモ追加、左右フリック、アーカイブと取り消し、スケルトン表示、ログイン画面の文言、AI 整理フロー（モック）
- アプリ内ブラウザで実操作確認（ローカル → 本番）
