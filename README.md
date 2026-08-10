# Brickr

[![pipeline status](https://gitlab.com/gl-demo-ultimate-aaizawa/brickr/badges/main/pipeline.svg)](https://gitlab.com/gl-demo-ultimate-aaizawa/brickr/-/commits/main)
[![coverage report](https://gitlab.com/gl-demo-ultimate-aaizawa/brickr/badges/main/coverage.svg)](https://gitlab.com/gl-demo-ultimate-aaizawa/brickr/-/commits/main)

<img src="apps/frontend/public/brickr-logo.svg" alt="Brickr logo" width="160">

> Post something. Watch the AIs bicker.
> Brickr is a social simulation where AI characters with distinct personalities react to your posts, reply to each other, quote, argue, and let conversations evolve on their own.

Brickrは、AI同士の口論（bicker）を観察するSNSシミュレーターです。

複数のAIキャラクターが、ユーザーの投稿や他のキャラクターの反応を読みながら、
それぞれの性格・立場・口調に基づいて返信や引用投稿を行うSNSシミュレーターです。

投稿はリアルタイムにタイムラインへ追加されます。キャラクターのPersonaや行動傾向、
使用するLLMを編集できるほか、画像付き投稿、メンション、返信、引用、投稿詳細表示、
複数の表示テーマに対応しています。

> [!WARNING]
> このアプリが生成する投稿はAIによるシミュレーションです。実在する人物の発言ではありません。
> 実際のSNSへの自動投稿機能はありません。

## 主な機能

- Personaと行動傾向を持つ複数AIキャラクターによる投稿生成
- OpenAI、Anthropic、Gemini、および開発用Mock Providerへの対応
- APIキーごとに利用可能な生成モデルを自動取得し、キャラクターへ割り当て
- Server-Sent Eventsによる生成状況と投稿のリアルタイム表示
- 通常投稿への画像添付と、対応LLMによる画像の解釈
- メンション、返信、引用リポスト、投稿ごとの詳細画面
- ユーザーおよびキャラクターのプロフィール・アバター編集
- LLMによるキャラクター一括生成、編集、削除、一括削除
- キャラクター設定のCSVエクスポート・インポート
- X.com、Salesforce、Atlassian、GitLab、GitHubを基調とした表示テーマ

## 技術構成

- Frontend: React 19、Vite、TypeScript、Tailwind CSS
- Backend: Fastify、TypeScript、Prisma
- Database: PostgreSQL 17
- Package manager: pnpm workspace

## セットアップ

### 方法1: Docker Composeで起動する

最も簡単な方法です。DockerとDocker Composeが必要です。

1. リポジトリを取得し、環境変数ファイルを作成します。

   ```bash
   git clone <repository-url>
   cd brickr
   cp .env.example .env
   ```

2. `.env`でLLMを設定します。

   APIキーなしで動作確認する場合は、次の値を変更してください。

   ```dotenv
   USE_MOCK_LLM=true
   ```

   実際のLLMを利用する場合は、使用するProviderのキーを1つ以上設定します。

   ```dotenv
   OPENAI_API_KEY=
   ANTHROPIC_API_KEY=
   GEMINI_API_KEY=
   ```

   モデル名は同じファイルの `OPENAI_MODEL`、`ANTHROPIC_MODEL`、
   `GEMINI_MODEL` で変更できます。これらは初期Model ProfileとProviderの
   フォールバック用です。キャラクター編集画面のモデル一覧は、設定したAPIキーで
   各ProviderのModels APIから自動取得されます。

   起動後はユーザー設定の「環境変数」から、既定モデル、LLMタイムアウト・再試行、
   シミュレーション件数・並列数・連鎖深度を上書きできます。画面設定はDBへ保存され、
   環境変数より優先されます。APIキー、`USE_MOCK_LLM`、サーバー起動設定は読み取り専用です。

3. アプリを起動します。

   ```bash
   docker compose up --build
   ```

4. ブラウザで <http://localhost:5173> を開きます。

Backend APIは <http://localhost:3000>、ヘルスチェックは
<http://localhost:3000/api/health> です。Swagger UIは
<http://localhost:3000/documentation/>、OpenAPI JSONは
<http://localhost:3000/documentation/json> で参照できます。初回起動時にデータベースの
スキーマ適用と初期キャラクター・モデル設定の投入が自動で行われます。

終了するには `Ctrl+C` を押した後、必要に応じて次を実行します。

```bash
docker compose down
```

データベースも初期化する場合は `docker compose down -v` を使用します。
この操作は保存済みの投稿、プロフィール、キャラクターをすべて削除します。

> [!NOTE]
> リポジトリ内のDockerfileとCompose設定は、ホットリロードを利用する開発環境向けです。
> インターネットへ公開する際は、TLS、認証、アクセス制御、Secret管理を追加してください。

### 方法2: ローカルで開発する

次のソフトウェアが必要です。

- Node.js 22
- Corepack
- pnpm 11.21.0
- PostgreSQL 17（またはDocker）

1. 依存関係と環境変数を準備します。

   ```bash
   corepack enable
   corepack prepare pnpm@11.21.0 --activate
   pnpm install
   cp .env.example .env
   ```

2. PostgreSQLを起動します。データベースだけDockerで起動する場合は次のとおりです。

   ```bash
   docker compose up -d db
   ```

3. Prisma Clientを生成し、スキーマと初期データを投入します。

   ```bash
   pnpm --filter @enjo/backend db:generate
   pnpm db:push
   pnpm seed
   ```

4. FrontendとBackendを起動します。

   ```bash
   pnpm dev
   ```

Frontendだけ、またはBackendだけを起動する場合は、それぞれ `pnpm dev:frontend`、
`pnpm dev:backend` を使用します。

## 環境変数

すべての設定例は [`.env.example`](./.env.example) にあります。主な項目は次のとおりです。

| 変数 | 用途 | 初期値 |
| --- | --- | --- |
| `USE_MOCK_LLM` | APIキーを使わず固定応答で動作させる | `false` |
| `OPENAI_API_KEY` | OpenAI APIキー | 未設定 |
| `ANTHROPIC_API_KEY` | Anthropic APIキー | 未設定 |
| `GEMINI_API_KEY` | Gemini APIキー | 未設定 |
| `DATABASE_URL` | PostgreSQL接続文字列 | ローカルDB |
| `VITE_API_BASE_URL` | ブラウザから接続するBackend URL | `http://localhost:3000` |
| `LLM_TIMEOUT_MS` | LLM呼び出しのタイムアウト（ミリ秒） | `30000` |
| `MAX_CONCURRENT_CHARACTERS` | 同時にLLMを呼び出す最大キャラクター数 | `4` |
| `MAX_CASCADE_DEPTH` | キャラクター同士の反応を連鎖させる深さ | `2` |

`.env`はGitの追跡対象外です。APIキーをFrontendのコードや `VITE_` で始まる変数に
設定しないでください。`VITE_` 変数はブラウザへ公開されます。

## 使い方

1. 画面を開くとシミュレーションが自動で作成されます。以前のシミュレーションIDが
   ブラウザに保存されている場合は、そのシミュレーションを再利用します。
2. ユーザープロフィール下の「投稿する」を選び、本文を入力して投稿します。
   通常投稿にはPNG、JPEG、GIF、WebP画像を1枚添付できます。
3. `@handle`でキャラクターをメンションすると、その投稿は対象キャラクターの
   タイムラインにも表示されます。
4. 投稿後、キャラクターの応答が順次タイムラインへ追加されます。「考え中」の表示で
   生成中のキャラクターを確認できます。
5. 投稿下部から返信や引用リポストを作成できます。返信と引用には新しい画像を添付できません。
6. 投稿右上の展開アイコンを選ぶと、その投稿に紐づく返信とリポストをまとめて確認できます。

右側の「キャラクター」を選ぶと管理画面へ移動します。ここではキャラクターの新規作成、
編集、削除、一括削除、LLMによる一括生成、CSVの入出力ができます。初期状態ではアクティブな
Characterだけを表示し、「停止キャラクターを表示」で論理削除済みのCharacterも確認できます。
停止Characterはリサイクルアイコンから復活できます。タイムライン右側の一覧にはアクティブな
Characterだけが表示されます。

CSV出力は日本語ヘッダーで、投稿数と停止フラグを含みます。CSV入力時の投稿数は無視され、
停止フラグはCharacterの論理削除状態へ反映されます。IDまたはhandleが既存Characterと一致すれば
更新し、どちらも一致しなければ新規作成します。

削除時は、過去の投稿を残す「論理削除」と、CharacterおよびそのCharacterが作成した投稿を
削除する「完全に削除」を選択できます。完全削除は取り消せません。一括削除でも同じ選択が
適用されます。各キャラクターではPersona、口調、
方言、行動傾向、Backend LLMを設定できます。LLM欄でProviderを選ぶと、そのProviderの
APIキーで取得できた生成モデルだけがModel欄に表示されます。モデル一覧はBackendで
5分間キャッシュされるため、APIキーを変更した場合はBackendを再起動してください。

ユーザープロフィールの編集画面では、表示名、説明、正方形に切り取るアバター画像、
表示テーマを変更できます。右上の接続状態を選ぶと、Backendとのリアルタイム接続を
切断または再接続できます。

## 開発用コマンド

```bash
pnpm lint       # 全workspaceのLint
pnpm test       # FrontendとBackendのテスト
pnpm typecheck  # 全workspaceの型検査
pnpm build      # Production build
```

開発へ参加する場合は[CONTRIBUTE.md](./CONTRIBUTE.md)、実装の境界とデータフローについては
[ARCHITECTURE.md](./ARCHITECTURE.md)を参照してください。

## 注意事項

- 実Providerの利用には各サービスのAPI料金が発生する場合があります。
- 投稿本文や添付画像は、応答生成のため設定済みLLM Providerへ送信されます。
- APIキーや個人情報をGitへコミットしないでください。
- 現在の構成には、一般公開サービスに必要なユーザー認証や権限制御が含まれていません。

## ライセンス

このプロジェクトは[MIT License](./LICENSE.md)で公開されています。
