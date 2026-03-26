# カレンダーアプリ セットアップ手順

## 1. Supabaseのセットアップ

### 1-1. アカウント作成
1. https://supabase.com にアクセス
2. 「Start your project」でGitHubアカウントでサインアップ

### 1-2. プロジェクト作成
1. 「New project」をクリック
2. プロジェクト名: `calendar-app`（任意）
3. パスワードを設定（保管しておく）
4. リージョン: `Northeast Asia (Tokyo)` を選択
5. 「Create new project」をクリック（1〜2分かかります）

### 1-3. データベースのセットアップ
1. 左サイドバーの「SQL Editor」をクリック
2. 「New query」をクリック
3. `supabase-schema.sql` の内容をすべてコピーして貼り付け
4. 「Run」ボタンを押して実行

### 1-4. APIキーを取得
1. 左サイドバーの「Settings」→「API」をクリック
2. 以下をメモ:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGci...`（長い文字列）

---

## 2. 環境変数の設定

プロジェクトフォルダに `.env.local` ファイルを作成（`.env.local.example` をコピー）:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

---

## 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開く

---

## 4. 本番デプロイ（Vercel）

### 4-1. Vercelアカウント作成
1. https://vercel.com にアクセス
2. GitHubアカウントでサインアップ

### 4-2. GitHubにプッシュ
```bash
git init
git add .
git commit -m "Initial commit"
```
GitHubで新しいリポジトリを作成してプッシュ

### 4-3. Vercelにデプロイ
1. Vercelダッシュボードで「Add New Project」
2. GitHubリポジトリを選択
3. 「Environment Variables」に以下を追加:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. 「Deploy」をクリック

デプロイ完了後、発行されたURLからアクセス可能。スマホのブラウザで開いて「ホーム画面に追加」でアプリとして使えます。

---

## 使い方

- **月/週/日ボタン**: ビューを切り替え
- **＜ ＞ボタン**: 前後に移動
- **カレンダーアイコン**: 今日に戻る
- **＋ボタン**: 予定を追加
- **予定をタップ**: 詳細表示・編集・削除
- **日付をタップ**: 日ビューに移動 / 日ビュー時は予定追加
