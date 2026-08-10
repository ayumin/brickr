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
- シミュレーション、投稿、スレッド処理のテスト追加
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

PostgreSQLだけをDockerで起動し、スキーマと初期データを準備します。

```bash
docker compose up -d db
pnpm --filter @enjo/backend db:generate
pnpm db:push
pnpm seed
```

FrontendとBackendを起動します。

```bash
pnpm dev
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:3000>
- Health check: <http://localhost:3000/api/health>

すべてをDockerで動かす場合は、`docker compose up --build`を使用できます。

## リポジトリ構成

```text
apps/
├── backend/       Fastify API、シミュレーション、LLM、Prisma
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
| シミュレーション | `apps/backend/src/simulation/simulation-service.ts` | 投稿生成のオーケストレーション |
| LLM抽象化 | `apps/backend/src/llm/provider.ts` | Provider共通契約 |
| DB Schema | `apps/backend/prisma/schema.prisma` | PostgreSQLのデータモデル |
| Frontend起動 | `apps/frontend/src/App.tsx` | 初期ロードとSimulation復元 |
| 主要画面 | `apps/frontend/src/features/simulation/SimulationView.tsx` | 画面遷移と主要UIの統合 |
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

### Backendの責務分離

- Routeは入力検証、Service呼び出し、HTTPレスポンス変換に限定します。
- Application/Domain判断はServiceまたは純粋関数へ置きます。
- PrismaへのアクセスはRepositoryへ閉じ込めます。
- Provider SDK固有の型やエラーを`llm/`の外へ漏らさないでください。
- `services.ts`をComposition Rootとして保ち、別の場所で依存を直接構築しないでください。

### シミュレーション

- ユーザー投稿は先に保存してHTTPレスポンスを返し、Character生成を待たせません。
- 生成結果は保存後にSSEで配信します。
- 永続的なRound/Wave Modelは追加しません。各Characterは処理開始時点のThreadを読みます。
- Character単位の失敗で、他Characterの処理を中断しないでください。
- 同時実行数、cascade深度、投稿数には必ず上限を持たせてください。
- `simulation.completed.generatedPostIds`には、実際に保存された生成Postだけを含めてください。

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
6. `api/routes.ts`でRouteを登録し、Domain ErrorをHTTP Errorへ変換します。
7. `apps/frontend/src/services/api-client.ts`に型付きメソッドを追加します。
8. API一覧や重要なフローが変わる場合は文書を更新します。

### データベースSchemaを変更する

1. `apps/backend/prisma/schema.prisma`を変更します。
2. RepositoryとMapperを更新します。
3. `pnpm --filter @enjo/backend db:generate`でPrisma Clientを再生成します。
4. 開発DBで`pnpm db:push`を実行します。
5. Seedが再実行可能であることを確認します。
6. 既存データへの影響、nullability、削除時の挙動をPull Requestに記載します。

`db:push`は開発用です。公開運用へ移行する場合は、履歴を持つMigration運用を別途導入してください。

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
3. Frontendの`useSimulationEvents` Reducerへ処理を追加します。
4. REST hydrationとSSEが競合しても重複しない設計にします。
5. 切断、再接続、購読解除時の状態を確認します。

### Frontend画面を追加する

1. Network処理と表示ロジックを分離します。
2. 配列の絞り込み、並び替え、Thread展開は可能なら純粋関数にします。
3. Loading、Error、Empty、Disabledの各状態を実装します。
4. キーボード操作、`aria-label`、Focus表示を確認します。
5. Light/Darkを含む全Theme Tokenで読めることを確認します。

## テスト

変更箇所に最も近いテストを追加してください。

- 純粋ロジック: 入出力、境界値、順序、重複、cycleなどをUnit Testで確認
- Service: Fake RepositoryやFake Providerを使い、成功・部分失敗・例外を確認
- API Schema: 正常値、最小・最大値、不正な型、サイズ制限を確認
- Provider Mapper: SDKへ渡す形式とSDKから受ける形式を、Networkなしで確認
- Frontend helper: URL、Mention、Thread派生、ThemeなどをVitestで確認

対象パッケージだけを検証する場合:

```bash
pnpm --filter @enjo/backend lint
pnpm --filter @enjo/backend test
pnpm --filter @enjo/backend typecheck
pnpm --filter @enjo/frontend lint
pnpm --filter @enjo/frontend test
pnpm --filter @enjo/frontend typecheck
pnpm --filter @enjo/shared lint
pnpm --filter @enjo/shared test
pnpm --filter @enjo/shared typecheck
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

## GitLab CI

リポジトリ直下の`.gitlab-ci.yml`は、Branch、Tag、Merge RequestのPipelineで次を実行します。

1. Frontend、Backend、SharedのLintを並列実行
2. Frontend、Backend、Sharedの型検査を並列実行
3. Frontend、Backend、Sharedのテストを並列実行
4. Frontend、Backend、Sharedを並列ビルド
5. 各workspaceの`dist/`を1週間Artifactとして保存

CIは開発環境と同じNode.js 22と、`packageManager`で固定しているpnpm 11.21.0を使用します。依存関係は
`pnpm-lock.yaml`に基づいて固定され、pnpm storeはLockfile単位でキャッシュされます。
テストは外部LLM APIやPostgreSQLへ接続しないため、APIキーやDatabase Serviceは不要です。

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
- [ ] APIキー、個人情報、生成された`.env`を含んでいない
- [ ] 必要なREADME、CLAUDE.md、ARCHITECTURE.mdを更新した
- [ ] UIでBootstrap IconsとTheme Tokenを使用した
- [ ] 失敗時に他の処理を不必要に停止させない

## セキュリティ上の問題

APIキー漏えい、認証回避、任意コード実行など、悪用可能な問題をPublic Issueへ詳細に投稿しないでください。
GitHubのPrivate vulnerability reportingが利用できる場合はそれを使用し、利用できない場合は
機密情報を含めずにMaintainerへ非公開の連絡方法を確認してください。

## ライセンス

コントリビューションは、プロジェクトと同じ[MIT License](./LICENSE.md)で提供されるものとします。
