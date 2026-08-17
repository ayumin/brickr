# コントリビューションガイド

Brickrへのコントリビューションを検討いただき、ありがとうございます。
この文書では、開発環境の準備から設計上の約束、テスト、Pull Requestまでの流れを説明します。

システム全体の構造を先に把握したい場合は、[ARCHITECTURE.md](./ARCHITECTURE.md)を参照してください。
プロダクト仕様の詳細は[CLAUDE.md](./CLAUDE.md)、利用者向けのセットアップは
[README.md](./README.md)にあります。

## 行動指針

- 相手の知識や経験を決めつけず、具体的で検証可能な議論をしてください。
- 人ではなくコード、仕様、観測された挙動について議論してください。
- AI生成物、SNS、炎上という題材を扱うため、実在人物への攻撃や差別的なPersonaを追加しないでください。
- セキュリティ情報、APIキー、個人情報をIssue、Pull Request、ログへ投稿しないでください。

## コントリビューションの種類

次のような変更を歓迎します。

- 不具合修正と再現テスト
- アクセシビリティ、操作性、レスポンシブ表示の改善
- LLM Provider間の互換性と失敗処理の改善
- Room、投稿、ScheduledEvent、スレッド処理のテスト追加
- セットアップ、運用、アーキテクチャ文書の改善
- 小さく明確な性能改善

大規模な依存関係の追加、データモデルの全面変更、認証方式、分散実行基盤などは、
実装前にIssueで目的と設計を相談してください。

## 開発環境

### 必要なソフトウェア

- Node.js 22
- Corepack
- pnpm 11.21.0
- PostgreSQL 17、またはDockerとDocker Compose

### 初期セットアップ

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install
cp .env.example .env
```

APIキーを使用しない開発では、`.env`を次のように変更してください。

```dotenv
USE_MOCK_LLM=true
```

Signupは招待制なので、最初の管理者を作る場合はSeed前に`ADMIN_EMAIL`と`ADMIN_PASSWORD`も
設定してください。`ADMIN_EMAIL`が空の場合、管理者Bootstrapはスキップされます。

PostgreSQLだけをDockerで起動し、migrationと初期データを準備します。

```bash
docker compose up -d db
pnpm --filter @brickr/backend db:generate
pnpm db:reset
```

FrontendとBackendを起動し、別terminalでworkerを起動します。

```bash
pnpm dev
```

```bash
pnpm --filter @brickr/backend worker
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:3000>
- Health check: <http://localhost:3000/api/health>

すべてをDockerで動かす場合は、`docker compose up --build`を使用できます。

## リポジトリ構成

```text
apps/
├── backend/       Fastify API、Room/Cast、worker、LLM、Prisma
└── frontend/      React UI、REST/SSE Client、表示用の派生ロジック
packages/
└── shared/        FrontendとBackendで共有するDTO、Event、定数
```

重要な入口は次のとおりです。

| 領域 | ファイル | 役割 |
| --- | --- | --- |
| Backend起動 | `apps/backend/src/server.ts` | Fastifyの起動と終了処理 |
| Backend構成 | `apps/backend/src/services.ts` | RepositoryとServiceの組み立て |
| REST API | `apps/backend/src/api/routes.ts` | RouteとDomain ErrorのHTTP変換 |
| 入力検証 | `apps/backend/src/api/schemas.ts` | Zodによる境界検証 |
| API仕様 | `apps/backend/src/api/openapi.ts` | OpenAPI 3.0とSwagger UI設定 |
| 認証Context | `apps/backend/src/auth/auth-context.ts` | Session解決とUser/Admin Guard |
| Account/招待 | `apps/backend/src/auth/` | Signup/Login、Session、Admin、InviteCode |
| Handle | `apps/backend/src/handles/` | User/Character共有Namespace |
| Room処理 | `apps/backend/src/simulation/` | Room、membership、分析、投稿生成 |
| 非同期worker | `apps/backend/src/worker/` | ScheduledEvent claim・実行・再試行 |
| LLM抽象化 | `apps/backend/src/llm/provider.ts` | Provider共通契約 |
| 実行設定 | `apps/backend/src/settings/` | 環境変数とDB Overrideの合成 |
| DB Schema | `apps/backend/prisma/schema.prisma` | PostgreSQLのデータモデル |
| Frontend起動 | `apps/frontend/src/App.tsx` | SessionとRoom routeの初期化 |
| Frontend Route | `apps/frontend/src/routes.ts` | URL生成と静的Path優先のRoute match |
| 主要画面 | `apps/frontend/src/features/feed/FeedScreen.tsx`, `apps/frontend/src/features/rooms/RoomScreen.tsx`, `apps/frontend/src/features/rooms/PostDetailScreen.tsx` | 統合Feed・個別Room・投稿詳細のUI統合 |
| API Client | `apps/frontend/src/services/api-client.ts` | Frontend唯一のRESTアクセス層 |
| SSE Client | `apps/frontend/src/services/sse-client.ts` | EventSourceの薄いラッパー |

## 開発の進め方

1. Issueまたは再現手順から、変更の目的と完了条件を明確にします。
2. 関係する仕様を`CLAUDE.md`と`ARCHITECTURE.md`で確認します。
3. 小さな変更単位で実装し、同じ責務のテストを追加します。
4. 対象パッケージのテストと型検査を先に実行します。
5. 最後にリポジトリ全体を検証し、必要な文書を更新します。
6. 一つのコミットには一つの理解可能な目的を持たせます。

ブランチ名の例:

```text
feat/provider-model-catalog
fix/sse-reconnect-state
docs/local-development
```

コミットメッセージの例:

```text
feat(characters): add provider model selection
fix(posts): preserve quoted post context
test(simulation): cover partial provider failures
docs: explain local database setup
```

## 設計上の約束

### FrontendとBackendの境界

- FrontendからLLM Providerを直接呼び出さないでください。
- APIキーはBackendの環境変数だけで扱います。
- React Componentから直接`fetch`せず、`services/api-client.ts`へ追加してください。
- SSEの接続処理は`services/sse-client.ts`へ閉じ込めてください。
- FrontendとBackend間のDTOは`packages/shared`へ置いてください。
- Domain ModelとAPI DTOを同一視しないでください。Personaや内部確率は通常APIへ返しません。
- REST ClientはCookieを送る`credentials: "include"`を維持し、SSEも同じSession Cookieを使用します。

### Backendの責務分離

- Routeは入力検証、Service呼び出し、HTTPレスポンス変換に限定します。
- Application/Domain判断はServiceまたは純粋関数へ置きます。
- PrismaへのアクセスはRepositoryへ閉じ込めます。
- Provider SDK固有の型やエラーを`llm/`の外へ漏らさないでください。
- `services.ts`をComposition Rootとして保ち、別の場所で依存を直接構築しないでください。
- Routeの`requireUser`/`requireAdmin`だけに依存せず、Owner固有の認可はServiceでも確認してください。

### 認証、所有権、handle

- Read APIを公開するか、User/Admin/Ownerへ制限するかを明示し、401と403を分けてください。
- Password、Session生Token、BirthdateはDTOやLogへ出さないでください。Sessionはhashだけを保存します。
- UserとCharacterのhandleは`handles` Tableの共有Namespaceです。予約語、正規化、競合処理を
  Frontend、Zod Schema、Domainで不一致にしないでください。
- User作成CastとRoomには`createdByUserId`を設定し、Owner/Adminだけが管理できます。
  `createdByUserId = null`のSeed CharacterはSystem所有で、Adminだけが変更できます。
- Signup、InviteCode消費、handle確保のように途中状態を残せない操作はTransaction境界を維持してください。
- 停止UserはLoginと既存Session解決の両方で拒否し、Admin自身を停止・再開する境界ケースもテストしてください。

### Roomと非同期イベント

- Postは必ず`roomId`を持ち、横断Feedを投稿先として扱わないでください。
- 遅延・自律処理はScheduledEventへ登録し、API process内のfire-and-forgetを増やさないでください。
- worker claimは原子的に行い、lock timeout、retry、cancel規則を維持してください。
- Character単位の失敗で、他CharacterやUser postを失敗させないでください。
- 同時実行数、cascade深度、投稿数には必ず上限を持たせてください。

### 投稿とスレッド

- User Post、Character Post、Reply、Quoteは同じPost Modelを使います。
- Replyは`replyTo`、引用リポストは`quoteOf`で表現します。
- Quoteを別の永続Modelとして追加しないでください。
- 投稿詳細のReplyは子孫を含めて平坦化し、Repostは直接引用だけを扱います。
- URLやMentionの表示に`dangerouslySetInnerHTML`を使用しないでください。

### UI

- UIのアイコンには`components/Icon.tsx`経由でBootstrap Iconsを使用します。
- アイコン用途に絵文字を使用しないでください。
- 新しい色は固定値ではなく、`index.css`のTheme Tokenを使用してください。
- Modalは処理中でない限り、閉じる操作と背景クリックの両方に対応させます。
- 非同期処理にはLoading、空状態、失敗理由、再試行の必要性を検討してください。
- 100件を超える一覧では既存のページネーションまたは「さらに表示」の規則に合わせます。

### TypeScript

- Strict modeを維持し、`any`を使用しないでください。
- 外部入力は`unknown`として受け、境界で検証または絞り込みを行います。
- BackendのESM相対importには`.js`拡張子を付けます。
- 型だけのimportには`import type`を使用します。
- 不要な型アサーションより、純粋関数と明示的なDomain Typeを優先します。

## 変更種別ごとの手順

### REST APIを追加する

1. `packages/shared`にRequest/Response DTOを追加します。
2. `apps/backend/src/api/schemas.ts`にZod Schemaを追加します。
3. Schemaの正常系・境界値・拒否ケースをテストします。
4. `apps/backend/src/api/openapi.ts`へPath、Request、Response、Errorを追加します。
5. Domain ServiceとRepositoryへ必要な処理を追加します。
6. Public/User/Admin/OwnerのAccess levelを決め、認証必須ならOpenAPIの`cookieAuth`、401/403 Response、
   `sessionProtectedOperationIds`の契約テストへ反映します。
7. `api/routes.ts`でRouteを登録し、Domain ErrorをHTTP Errorへ変換します。
8. `apps/frontend/src/services/api-client.ts`に型付きメソッドを追加します。
9. API一覧や重要なフローが変わる場合は文書を更新します。

### データベースSchemaを変更する

1. `apps/backend/prisma/schema.prisma`を変更します。
2. RepositoryとMapperを更新します。
3. `pnpm --filter @brickr/backend db:generate`でPrisma Clientを再生成します。
4. 開発DBで`pnpm db:push`を実行します。
5. Seedが再実行可能であることを確認します。
6. 既存データへの影響、nullability、削除時の挙動をPull Requestに記載します。

`db:push` Scriptは`--accept-data-loss`付きの開発用です。対象Databaseを確認してから実行してください。
公開運用へ移行する場合は、履歴を持つMigration運用を別途導入してください。

### LLM Providerを追加・変更する

1. `LLMProvider` Interfaceの範囲で実装します。
2. Provider固有のMessage、画像、structured outputを内部で変換します。
3. SDK Errorを`LLMError`へ正規化し、retryableかどうかを明示します。
4. `AbortSignal`を生成とモデル一覧取得の両方へ渡します。
5. モデル一覧はCharacterの投稿生成に利用できるものだけを返します。
6. APIキーがない場合の`available`を正しく実装します。
7. `MockProvider`と純粋なMapper/Filterのテストを更新します。
8. APIキーやAuthorization Headerをログへ出さないことを確認します。

### SSE Eventを追加する

1. `packages/shared/src/events.ts`のEvent unionと`SSE_EVENT_TYPES`を更新します。
2. Backendで永続化または状態変更の後にEventを発行します。
3. FrontendのRoom/Feed event reducerへ処理を追加します。
4. REST hydrationとSSEが競合しても重複しない設計にします。
5. 切断、再接続、購読解除時の状態を確認します。

### Frontend画面を追加する

1. `routes.ts`へPath生成とMatchを追加し、静的Pathを`/:handle`より先に判定します。
2. `AppShell`が`/`と`/rooms/:roomId`を`<Route>`ツリーの外で保持する方針（`AppRoutes.tsx`のコメント参照）に沿い、SSE接続やShell状態を失う不要なremountを避けます。
3. Network処理と表示ロジックを分離します。
4. 配列の絞り込み、並び替え、Thread展開は可能なら純粋関数にします。
5. Loading、Error、Empty、Disabled、Unauthenticated、Forbiddenの各状態を実装します。
6. キーボード操作、`aria-label`、Focus表示を確認します。
7. Light/Darkを含む全Theme Tokenで読めることを確認します。

## テスト

変更箇所に最も近いテストを追加してください。

- 純粋ロジック: 入出力、境界値、順序、重複、cycleなどをUnit Testで確認
- Service: Fake RepositoryやFake Providerを使い、成功・部分失敗・例外を確認
- API Schema: 正常値、最小・最大値、不正な型、サイズ制限を確認
- Provider Mapper: SDKへ渡す形式とSDKから受ける形式を、Networkなしで確認
- Auth/認可: Cookie属性、期限切れSession、停止User、User/Admin/Ownerごとの401/403を確認
- Repository: Transaction、共有handle、Ownership、delete cascade/set-nullをFake Prismaで確認
- Frontend helper: URL、Mention、Thread派生、ThemeなどをVitestで確認

対象パッケージだけを検証する場合:

```bash
pnpm --filter @brickr/backend lint
pnpm --filter @brickr/backend test
pnpm --filter @brickr/backend typecheck
pnpm --filter @brickr/frontend lint
pnpm --filter @brickr/frontend test
pnpm --filter @brickr/frontend typecheck
pnpm --filter @brickr/shared lint
pnpm --filter @brickr/shared test
pnpm --filter @brickr/shared typecheck
```

Pull Request前の全体検証:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

実Providerを使うテストは、料金、Rate Limit、応答の非決定性があるため通常のTest Suiteへ入れません。
必要な場合は手動検証として実施し、使用Provider、確認内容、Secretを含まない結果をPRへ記載してください。

### 手動検証チェックリスト（ブラウザが必要な確認項目）

Modal focus trap、スクロール位置、Visual viewportなど、Vitestだけでは検証できない項目です。
自動化しにくい視覚・device依存項目は、以下をブラウザで確認して結果をMR本文へ記載してください。

- Modal / bottom sheetのfocus trap、Escapeで閉じる、閉じた後にtriggerへFocusが戻ること
  （`Dialog`利用箇所全般、および独自実装の`SecretResultDialog`）
- 未ログイン → Login / Signup → 投稿Composerが自動再開すること
- SSEによる並び替え発生時、読んでいるスクロール位置が維持されること
- Mobile幅でのBottom Navigationがsafe areaを避けて表示されること
- 未ログイン時、投稿・返信・引用等のactionがdisabled表示ではなく非表示であること
- 停止中Roomでも同様にactionが非表示であること
- 390×844 / 768×1024 / 1280×800 / 1440×1000 の各幅で、Brickr Dark / Lightそれぞれ崩れがないこと

## GitLab CI

リポジトリ直下の`.gitlab-ci.yml`は、Branch、Tag、Merge RequestのPipelineで次を実行します。

1. Frontend、Backend、SharedのLint、型検査、Coverage付きTest、Production build
2. 空PostgreSQLへのmigration reset、seed、migration status確認
3. PlaywrightによるFeed・login・Room作成・投稿の主要UI導線
4. Docker Composeでbackendとworker 2 replicasがhealthyになること
5. 旧URL、旧ID field、削除済みglobal固定投稿先等の再混入チェック
6. GitLab SAST、Dependency Scanning、Secret Detection

CIは開発環境と同じNode.js 22と、`packageManager`で固定しているpnpm 11.21.0を使用します。依存関係は
`pnpm-lock.yaml`に基づいて固定され、pnpm storeはLockfile単位でキャッシュされます。
通常testは外部LLM APIへ接続しません。DB/E2E jobは一時PostgreSQLとMock LLMを使い、実API keyを
必要としません。Backend JobだけがInstall後にPrisma Clientを生成します。

## Pull Request

Pull Requestは、レビュアーが目的と影響を短時間で確認できる大きさにしてください。

説明には次を含めます。

- 何を変更したか
- なぜ必要か
- 仕様上の判断と代替案
- UI変更がある場合は画像または操作手順
- DB、環境変数、API互換性への影響
- 実行したテストと結果
- 未対応事項や既知の制約

チェックリスト:

- [ ] 変更範囲が一つの目的にまとまっている
- [ ] 新しい挙動にテストがある
- [ ] `pnpm lint`が成功する
- [ ] `pnpm test`が成功する
- [ ] `pnpm typecheck`が成功する
- [ ] `pnpm build`が成功する
- [ ] APIキー、Password、Session/Invite Code、個人情報、生成された`.env`を含んでいない
- [ ] 新規EndpointのPublic/User/Admin/Owner境界と401/403を検証した
- [ ] 必要なREADME、CLAUDE.md、ARCHITECTURE.mdを更新した
- [ ] UIでBootstrap IconsとTheme Tokenを使用した
- [ ] 失敗時に他の処理を不必要に停止させない

## セキュリティ上の問題

APIキー漏えい、認証回避、任意コード実行など、悪用可能な問題をPublic Issueへ詳細に投稿しないでください。
Maintainerへ非公開の連絡方法を確認し、再現情報やSecretはPrivate Channelで共有してください。

## ライセンス

コントリビューションは、プロジェクトと同じ[MIT License](./LICENSE.md)で提供されるものとします。
