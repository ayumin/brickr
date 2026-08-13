# Brickr UX Refine — フェーズ1実装計画

## 1. この文書の目的

この文書は、`epic-3/ux-refine` ブランチでフェーズ1の実装を進めるための実装仕様書である。

実装時は、次の3つを必ず同時に参照する。

1. `Brickr-ux-proto.html` — UX/UIの視覚的・操作的リファレンス
2. 本書 `Brickr-ux-refine.md` — フェーズ1で採用する仕様、採用しない仕様、実装順序
3. 既存コード — 認証、投稿、返信、引用、SSE、権限、キャスト管理などの既存動作

`Brickr-ux-proto.html` は完成コードではなく、デザインとインタラクションの参照物として扱う。カスタムランタイム、インラインスタイル、埋め込みフォント、モックデータ、モック専用状態管理は移植しない。

本書の要件とプロトタイプが矛盾する場合は、本書を優先する。本書に記載がない既存機能は、明示的に廃止対象とされていない限り維持する。

## 2. フェーズ1のゴール

既存機能を壊さず、Brickrをプロトタイプのデザイン言語と新しい情報設計へ刷新する。

フェーズ1は単なるCSS変更ではない。次の成立に必要なBackend・DB・API変更も含む。

- 全ルームのスレッドを統合して表示する「フィード」
- フィード自身へ投稿できるグローバル投稿領域
- 最終活動日時順のスレッド一覧
- スレッド単位の20件カーソルページング
- 各スレッドの最新2返信プレビュー
- 全ルーム横断のリアルタイム更新
- 公開APIからの人間ユーザー／AIキャスト種別の除去
- ログイン状態と所有権に応じたルーム・キャストの表示制御
- プロトタイプに沿ったDesktop／Mobileシェル、投稿モーダル、設定画面

フェーズ1中は内部コード、DB、APIの `Simulation` と `Character` という名前を維持する。画面上ではそれぞれ「ルーム」「キャスト」と表示する。刷新後に正常動作を確認してから、内部名称を `Room`、`Cast` に変更する別工程を計画する。

## 3. フェーズ1に含めないもの

次はプロトタイプに存在してもフェーズ1では実装も表示もしない。

- 通知
- いいね
- フォロー
- ミュート
- 「論争中」「フォロー中」フィルター
- 招待制・非公開ルーム
- ルームのお題
- ルーム別キャスト編成
- `@`入力時のメンション候補検索
- ルーム情報パネル内のAI要約
- ルーム別の温度、連鎖深度、同時応答数
- 追加テーマ
- キャストの公開プロフィールにおけるモデル・人格・所有者表示
- 内部名称の `Room`／`Cast` への変更

未実装機能は「準備中」、disabledボタン、ダミー件数なども含めて画面へ出さない。

## 4. 確定した用語

| 内部名称 | フェーズ1の画面表示 | 備考 |
| --- | --- | --- |
| Simulation | ルーム | API・型・DB名は維持 |
| Character | キャスト | 作成・編集ボタンも「キャストを追加」「キャストを編集」 |
| Global Simulation | フィード | 予約済みの特別なSimulation |
| User / Character | アカウントまたは投稿者 | 公開画面では種別を表示しない |

「マイスレッド」は独立画面・独立ナビゲーションにしない。「自分あて」フィルターへ統合する。

## 5. 主要なユーザーフロー

### 5.1 未ログイン

1. `/` でフィードを開く。
2. 全ルームの最新スレッド20件と各スレッドの最新2返信がリアルタイムに流れる。
3. 未ログインユーザーはフィードを見るだけで、投稿や画面遷移はできない。
4. 左ナビゲーションには「フィード」と「投稿する」だけを表示する。
5. 「投稿する」を押すとログイン／サインアップモーダルを表示する。
6. 認証成功後は投稿モーダルを自動的に開き直す。

未ログイン時に表示・許可しないもの：

- キャスト、ルーム、設定メニュー
- 投稿者名・アバターからプロフィールへの遷移
- `@handle`リンク
- ルームリンク
- 返信、引用リポスト
- 「残りN件を表示」
- 「さらに読み込む」
- 投稿詳細への遷移

### 5.2 ログイン後のフィード

1. `/` は全ルーム統合フィードを表示する。
2. フィード自身へのトップレベル投稿は予約済みグローバルSimulationへ保存する。
3. 個別ルーム由来の投稿には所属ルーム名を表示し、進行中かつアクセス可能ならリンクにする。
4. 個別ルームの投稿への返信・引用リポストは、元投稿と同じSimulationへ保存する。
5. フィード投稿、個別ルーム投稿のどちらも、全有効キャストを応答候補とする。ルーム別キャスト制限は行わない。
6. `すべて／自分あて` を切り替えられる。

### 5.3 個別ルーム

1. `/rooms` でアクセス可能なルーム一覧を表示する。
2. `/rooms/:roomId` で選択したルームのフィードを表示する。
3. 新規ルーム作成後は作成したルームを自動選択し、`/rooms/:id`へ移動する。
4. 個別ルームの「投稿する」は共通投稿モーダルを開き、そのSimulationへ投稿する。
5. Desktopでは右側にルーム情報パネルを表示する。
6. Mobileではヘッダーの情報ボタンからボトムシートを開く。

### 5.4 設定

1. 左下のログインユーザー表示を押すと設定画面を開く。
2. 設定表示中は通常ナビゲーション全体を設定メニューへ置き換える。
3. 「設定を閉じる」で直前の画面と選択ルームへ戻る。
4. `/settings/:section`へ直接アクセスした場合は、最後に選択したルーム、復元できなければフィードへ戻る。

## 6. 情報設計とルーティング

### 6.1 正式URL

```text
/                         全ルーム統合フィード
/rooms                    ルーム一覧
/rooms/:roomId            個別ルーム
/rooms/:roomId/analysis   既存の詳細分析
/cast                     キャスト管理一覧
/:handle                  共通公開プロフィール
/posts/:postId            投稿詳細（ログイン必須）
/settings/profile         プロフィール設定
/settings/appearance      見た目
/settings/usage           自分の使用量
/settings/runtime         モデルと実行設定（管理者）
/settings/users           ユーザー管理（管理者）
/settings/invites         招待コード（管理者）
/login                    独立ログイン画面
/signup                   独立サインアップ画面
```

### 6.2 旧URL

- `/characters` は `/cast` へreplace遷移する。
- `/simulations` は `/rooms` へreplace遷移する。
- `/simulations/:id/analysis` は `/rooms/:id/analysis` へreplace遷移する。
- 旧URL互換はフェーズ1中維持し、READMEとテストも更新する。

### 6.3 アクセス制御

| 画面 | 未ログイン | ログイン済み | 備考 |
| --- | --- | --- | --- |
| `/` | 閲覧可 | 閲覧・投稿可 | 未ログインは操作制限あり |
| `/rooms` | フィードへreplace | 可 | 停止中の表示条件あり |
| `/rooms/:id` | フィードへreplace | 条件付き | 進行中は全員、停止中は作成者・管理者のみ |
| `/cast` | フィードへreplace | 可 | 一般ユーザーは自分所有のみ |
| `/:handle` | フィードへreplace | 可 | 人間／AI共通プロフィール |
| `/posts/:id` | フィードへreplace | 可 | 所属停止ルームへのアクセス規則に従う |
| `/settings/*` | フィードへreplace | 可 | 管理項目は管理者のみ |

`packages/shared/src/handle.ts` の予約語へ `rooms`、`cast`、必要なsettings sectionを追加する。静的ルートは `/:handle` より先に判定する。

## 7. LocalStorage仕様

キーは一箇所へ定数化し、安全にparseする。

```text
brickr.selectedSimulationId
brickr.feedFilter
brickr.theme
```

### 7.1 最後に選択したルーム

- 個別ルームを開いたらSimulation IDを保存する。
- フィードを明示的に開いた場合はIDを削除するか、予約値 `feed` を保存する。実装では削除を推奨する。
- ログアウト時には削除しない。
- 次回ログイン時、保存IDが存在しアクセス可能なら `/rooms/:id` を復元する。
- 存在しない、アクセス不可、または他者所有の停止中ルームなら値を削除して `/` を表示する。
- 未ログイン中は保存IDを使ってルームへ遷移しない。

### 7.2 フィルター

- 値は `all | mine`。
- フィードと個別ルームで同じ値を共有する。
- 画面切り替え後も維持する。
- 再訪問時に復元する。
- 不正値は `all` に戻す。

### 7.3 テーマ

- 初回は `prefers-color-scheme` に従う。
- 選択後はLocalStorageを優先する。
- 値は `brickr-dark | brickr-light`。

## 8. データモデル変更

DBは作り直す前提のため、互換migrationや既存データbackfillは不要。ただしSeedは何度実行しても安全なupsertにする。

### 8.1 Simulation

`apps/backend/prisma/schema.prisma` の `Simulation` に追加する。

```prisma
model Simulation {
  id              String   @id @default(uuid())
  title           String?
  status          String   @default("active")
  scope           String   @default("room") // "global" | "room"
  createdByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastActivityAt  DateTime @default(now())

  // existing relations...

  @@index([scope, status, lastActivityAt])
  @@index([createdByUserId, status, lastActivityAt])
}
```

`scope` は内部専用で公開表示名には使わない。型としては文字列を直接扱わず、sharedまたはbackend domainに `"global" | "room"` のunionを定義する。

### 8.2 予約済みグローバルSimulation

固定IDをshared/backendの一箇所へ定義する。

```ts
export const GLOBAL_SIMULATION_ID = "00000000-0000-4000-8000-000000000001";
```

Seedで次のレコードをupsertする。

- `id = GLOBAL_SIMULATION_ID`
- `title = "フィード"`
- `scope = "global"`
- `status = "active"`
- `createdByUserId = null`

既存Seedにある未ログイン投稿用の固定ユーザー／固定投稿者（`USER_AUTHOR_ID = "you"` 等）は削除する。フェーズ1では匿名投稿を許可せず、新規PostのUser authorは必ず認証済みUser IDに紐づける。デモ投稿が必要なら、通常のSeed UserをUUIDで作成してそのUserをauthorにする。

グローバルSimulationには次の操作を禁止する。

- 一覧への通常ルームとしての表示
- 改名
- 停止／再開
- 削除（削除APIを後から追加する場合も保護）
- 詳細分析画面への表示（フェーズ1では不要）

保護はUIだけでなくService層で行う。専用 `GlobalSimulationMutationError` または既存403系エラーを追加し、APIテストを作る。

### 8.3 Post

全ルーム横断でスレッドを効率よく取得するため、`Post`にスレッド情報を追加する。

```prisma
model Post {
  // existing fields...
  threadRootId     String   @map("thread_root_id")
  threadActivityAt DateTime @map("thread_activity_at")

  @@index([replyTo, threadActivityAt, id])
  @@index([simulationId, replyTo, threadActivityAt, id])
  @@index([threadRootId, createdAt, id])
}
```

`threadRootId` は問い合わせ高速化のための非正規化値とし、Prisma self relationは追加しなくてよい。整合性は投稿作成Serviceのtransactionとテストで保証する。

#### トップレベル投稿

- Post IDをRepository呼び出し前に `randomUUID()` で生成する。
- `threadRootId = id`
- `threadActivityAt = createdAt`
- `replyTo = null`
- 引用リポストもトップレベル投稿として同じ扱い。`quoteOf`だけを持つ。

#### 返信

- 親投稿を取得する。
- `threadRootId = parent.threadRootId`
- 新規返信の `threadActivityAt = createdAt`
- 同じtransaction内でルート投稿の `threadActivityAt` を返信作成時刻へ更新する。
- Simulationの `lastActivityAt` も更新する。
- 返信先と投稿先Simulationが一致しなければ従来どおり拒否する。

#### 引用リポスト

- 独立したトップレベル投稿とする。
- 引用元の `threadActivityAt` は更新しない。
- 引用投稿自身のSimulationの `lastActivityAt` は更新する。

### 8.4 transaction境界

`PostRepository.create`だけで複数更新を行わず、次のいずれかに整理する。

- 推奨：`PostRepository.createWithThreadActivity(input)` 内でPrisma transactionを完結する。
- 代替：Unit of Work相当を導入し、`PostService.publish`からtransaction callbackを渡す。

少なくとも「Post作成」「root activity更新」「Simulation activity更新」は原子的でなければならない。

### 8.5 キャスト完全削除時のスレッド修復

現在の完全削除は、そのキャストが作成したPostだけを削除し、他アカウントの返信は残す。この意味をフェーズ1でも変えない。したがって、削除したキャストのPostがスレッドrootまたはreply chainの途中にある場合、残存Postの `threadRootId` を修復する必要がある。

完全削除transaction内で、削除対象Postに影響される各reply subtreeについて次を行う。

1. 削除後に `replyTo` がnullになった残存Postを新しいrootとする。
2. そのtransitive descendantsの `threadRootId` を新root IDへ更新する。
3. 新rootの `threadActivityAt` をsubtree内の最大`createdAt`へ設定する。
4. 対象Simulationの `lastActivityAt` を残存rootの最大activityから再計算する。
5. 引用元削除により `quoteOf` がnullになっても、その引用投稿は元から独立rootなのでthread情報を変えない。

この修復を行わず、存在しないroot IDを残してはならない。他アカウントの返信を巻き添え削除する実装にも変更しない。

## 9. Shared DTO設計

対象は `packages/shared/src`。

### 9.1 公開アカウント

公開画面では人間ユーザーとAIキャストを区別できない共通DTOを使う。

```ts
export type PublicAccountDto = {
  id: string;
  handle: string;
  displayName: string;
  description?: string;
  avatarUrl?: string;
};
```

投稿内のauthorにはdescriptionを含めず、軽量な型を使ってよい。

```ts
export type PostAuthorDto = Pick<
  PublicAccountDto,
  "id" | "handle" | "displayName" | "avatarUrl"
>;
```

次を公開投稿DTOから削除する。

- `author.kind`
- 重複している `authorId`（Frontendが自分判定に使う場合も `author.id` を使う）

自分の投稿判定は `post.author.id === sessionUser.id` とする。

### 9.2 公開プロフィール

handle解決APIはdiscriminated unionを返さず、共通形式を返す。

```ts
export type PublicProfileDto = PublicAccountDto & {
  postCount: number;
  canEdit: boolean;
};

export type PublicProfileResponse = {
  profile: PublicProfileDto;
};
```

`canEdit`は種別を明かさないcapabilityとして使う。ただし自分自身も編集可能なので、`true`だけではAIキャストと断定できない。Frontendは種別を推測せず、`canEdit`に従って操作を出す。

プロフィールAPIから返さないもの：

- owner type
- model profile
- createdByUserId
- persona prompt
- behavior probabilities
- token usage

種別・所有者・モデル等は既存の `CharacterManagementDto` / `CharacterConfigDto` 系管理APIだけで返す。

### 9.3 フィードDTO

```ts
export type FeedFilter = "all" | "mine";

export type FeedRoomRefDto = {
  id: string;
  title: string;
  isFeed: boolean;
};

export type FeedCapabilitiesDto = {
  canOpenAuthor: boolean;
  canOpenRoom: boolean;
  canOpenThread: boolean;
  canReply: boolean;
  canQuote: boolean;
  canLoadMoreReplies: boolean;
};

export type FeedThreadDto = {
  root: PostDto;
  room: FeedRoomRefDto;
  latestReplies: PostDto[]; // 最大2件、古い→新しい
  replyCount: number;
  lastActivityAt: string;
  capabilities: FeedCapabilitiesDto;
};

export type FeedPageDto = {
  threads: FeedThreadDto[];
  nextCursor: string | null;
};
```

停止状態をフィード上で文字表示しないため、Frontendは`status`からUIを推測せず`capabilities`だけを見る。

### 9.4 カーソル

カーソルは `(threadActivityAt, postId)` の組をBase64URL JSON等で不透明化する。

```json
{"activityAt":"2026-08-13T10:00:00.000Z","id":"uuid"}
```

要件：

- Serverだけがencode/decodeする。
- 不正カーソルは400。
- 並び順は `threadActivityAt DESC, id DESC`。
- 次ページ条件は `activityAt < cursor.activityAt OR (activityAt = ... AND id < cursor.id)`。
- limitは固定20。将来query化する場合も最大100を超えない。

## 10. Backend API仕様

### 10.1 統合フィード

```http
GET /api/feed?filter=all&cursor=...
```

- 認証任意。
- 未ログインで`filter=mine`を指定した場合は401にする。Frontendは未ログイン時に`mine`を送らない。
- グローバルSimulationと通常Simulationのトップレベル投稿を対象にする。
- 停止中ルームの投稿も含める。
- 20スレッドと最新2返信を返す。
- 未ログイン向けcapabilitiesはすべてfalse。
- 停止中ルーム由来の統合フィード項目は、全ユーザーについて`canOpenRoom/canReply/canQuote`をfalseにする。作成者・管理者は統合フィードからではなく、ルーム一覧から停止中ルームを開く。
- グローバルフィード投稿は `room.isFeed = true`、タイトル「フィード」。

RepositoryでN+1を起こさないこと。推奨クエリ構成：

1. 条件に合うroot Postを20件取得。
2. `threadRootId in rootIds`で全reply countをgroupBy。
3. PostgreSQLのwindow functionまたはraw queryで各root最新2返信を取得。
4. root/reply/quoted author IDをまとめて取得してDTO化。
5. Simulation情報をまとめて取得。

Prismaだけで各グループ上位2件が複雑になる場合、型付きの `$queryRaw` を限定的に使ってよい。rootごとに個別クエリを発行してはならない。

### 10.2 個別ルームフィード

```http
GET /api/simulations/:id/feed?filter=all&cursor=...
```

- ログイン必須。
- `scope=global`にはこのAPIを使わせない。グローバルは `/api/feed` を使う。
- 進行中ルームは全ログインユーザーが閲覧可能。
- 停止中ルームは作成者・管理者だけ閲覧可能。
- 並び・ページング・返信プレビューは統合フィードと同じ。

### 10.3 ルーム一覧

既存 `GET /api/simulations` をログイン必須に変更する。

返却条件：

- `scope=global`を除外。
- 進行中ルームはすべて返す。
- 停止中ルームは現在ユーザーが作成者、または管理者の場合だけ返す。
- `lastActivityAt DESC, id DESC`。
- 投稿がないルームはSeed/作成時の `lastActivityAt = createdAt` により作成日時順になる。

`SimulationSummaryDto`に追加：

```ts
lastActivityAt: string;
creator: { id: string; handle: string; displayName: string } | null;
canManage: boolean;
```

一般ユーザーへ `createdByUserId` を直接返す必要はない。capabilityと公開creator情報を使う。

### 10.4 ルーム取得・操作

- `GET /api/simulations/:id` はログイン必須にし、投稿全件返却をやめる。基本情報だけ、または段階的互換のためpostsをdeprecated扱いにする。新UIはfeed APIを使用する。
- 他者所有の停止中ルームは404として扱い、存在確認に使わせない。
- `PUT /api/simulations/:id`、stop、resumeは既存Owner/Admin制約を維持。
- グローバルSimulationへの操作はServiceで拒否。
- 停止中ルームのrename、analysis、resumeはOwner/Adminに許可。
- 停止中ルームへのpost/reply/quoteは全員拒否。
- 選択時の自動resumeは完全に削除。

### 10.5 投稿

既存 `POST /api/simulations/:id/posts` を維持する。

- `/`からのトップレベル投稿は `GLOBAL_SIMULATION_ID` を指定。
- `/rooms/:id`からのトップレベル投稿は選択Simulation IDを指定。
- 統合フィード上の返信・引用はrootの表示位置ではなく対象Postの `simulationId` を指定。
- Backendは `replyTo` / `quoteOf` のPostがURLのSimulationに属するか必ず検証する。
- `@handle`は自由入力。存在しないhandleがあっても投稿可能。
- 既存 `resolveKnownMentions` で解決できたものだけ `mentions` に保存。
- 解決済みhandleが有効キャストなら強制応答候補へ含める。
- 第1フェーズではFrontendから `responderIds` を送らない。APIから削除するかdeprecatedにする。
- トップレベル投稿だけ画像添付可能という既存制約を維持する。

### 10.6 公開プロフィール

```http
GET /api/profiles/:handle
GET /api/profiles/:handle/posts?cursor=...
```

- ログイン必須。
- User/Character共通DTOを返す。
- handle解決の `ownerType` をFrontendへ返さない。
- profile post一覧は全ルーム横断とし、アクセス可能な投稿だけを返す。
- 停止中ルームの過去投稿をOwner/Admin以外が閲覧できる場所は統合フィードだけとする。したがってOwner/Admin以外のプロフィール投稿一覧からは停止中ルームの投稿を除外する。
- soft-delete済みキャストの過去プロフィールは過去投稿から開ける。編集・新規メンション導線は出さない。

既存 `/api/handles/:handle` は新レスポンスへ変更するか、Backend内部専用にしてFrontendから利用しない。

### 10.7 キャスト管理API

`GET /api/characters/management` はログイン必須にする。

- 一般ユーザー：`createdByUserId = currentUser.id` のキャストだけ。soft-delete済みも管理filter用に返す。
- 管理者：System所有と全ユーザー所有を含むすべて。
- 管理者向けDTOにはcreatorを含める。

```ts
creator?: {
  id: string;
  handle: string;
  displayName: string;
} | null; // null = System
```

次も同じscopeへ揃える。

- CSV export：ログイン必須。一般ユーザーは自分所有だけ、管理者は全件
- CSV import：一般ユーザーが他者/SystemキャストをIDまたはhandle一致で更新できないよう修正
- bulk delete/restore：Serviceのownership checkを維持・テスト
- public `GET /api/characters`、`GET /api/characters/:id` は新UIでは不要。削除するか、認証済みかつ管理scopeに従う内部用途へ縮小する。
- `GET /api/characters/:id/config` と更新系config APIは、当該キャストの作成者または管理者だけに許可する。モデル名、provider、system prompt、personaを公開プロフィール経由で取得できてはならない。
- `GET /api/characters/export`、import、bulk系routeにも各Serviceと同じ認証・ownership checkを置き、route単体テストで迂回不能を確認する。
- model profile一覧はログイン必須にする。キャスト作成・編集に必要なユーザーへは返してよいが、公開Profile/Post DTOとは結合しない。
- Frontend起動時に全キャストを取得しない。`/cast`を開いたときだけ管理一覧を取得する。

### 10.8 投稿詳細・既存公開APIの閉鎖

既存の `GET /api/posts/:id` をログイン必須にし、返却DTOを `FeedThreadDto` と同じ公開author規則へ揃える。

- activeな通常ルームとグローバルSimulationの投稿は全ログインユーザーが取得可能。
- 停止中ルームの投稿詳細は作成者・管理者だけ取得可能。それ以外は404にして存在確認を防ぐ。
- 未ログインは投稿詳細を取得できない。未ログインフィードに必要な本文・最新2返信は `/api/feed` のレスポンスだけで完結させる。
- `GET /api/posts/:id/replies` 等の既存補助routeがある場合も同じ認証・Simulationアクセス規則を適用する。
- 旧 `AuthorDto`、handle owner、Character DTOを直接返すrouteを棚卸しし、公開シェルから到達しなくてもHTTP APIとして情報漏えいしないことをintegration testで確認する。

## 11. SSE設計

### 11.1 エンドポイント

```http
GET /api/feed/events
GET /api/simulations/:id/events
```

- `/api/feed/events` は認証任意で、全Simulationの公開可能イベントを配信する。
- 個別Simulation eventsはログイン必須かつ閲覧権限を検証する。
- 未ログインが個別ルームSSEへ接続できないようにする。

### 11.2 公開イベントから削除する情報

現在の `character.processing/failed/skipped` に含まれる次の値を公開しない。

- `characterId`
- `handle`
- `displayName`
- Provider/Model

フィードでは管理者・作成者を含め全員匿名表示とする。

### 11.3 推奨イベント型

```ts
type FeedPostCreatedEvent = {
  type: "feed.post-created";
  thread: FeedThreadDto;
};

type ResponseStartedEvent = {
  type: "response.started";
  activityId: string;       // 外部に意味を持たないUUID
  simulationId: string;
  targetPostId: string;
  threadRootId: string;
};

type ResponseFinishedEvent = {
  type: "response.finished";
  activityId: string;
  simulationId: string;
  targetPostId: string;
  threadRootId: string;
  outcome: "posted" | "skipped" | "failed";
};

type SimulationStatusChangedEvent = {
  type: "simulation.status-changed";
  simulation: SimulationSummaryDto;
};
```

UIは`activityId`をSetで管理し、1件以上あれば「応答を生成中」と表示する。失敗は個別名・理由を表示せず、「一部の応答を生成できませんでした」と集約する。詳細理由はBackendログだけに残す。

投稿作成イベントは、Frontendが再計算できる断片的Postだけでなく、更新後の `FeedThreadDto` を返すのが安全である。これにより返信受信時のreply count、最新2件、lastActivityAt、capabilitiesをServerのsource of truthと一致させられる。

### 11.4 EventHub

既存 `EventHub` はSimulation ID別listenerに加え、グローバルlistenerを持てるよう拡張する。

- 内部生成処理はキャスト識別情報をService内で使用してよい。
- 外部へpublishする直前に公開イベントへ変換する。
- 1つの投稿イベントを個別Simulation subscriberと統合feed subscriberの双方へ配信する。
- 既存の「SSEを先に購読してからREST hydrate」「IDでdedupe」の競合対策を維持する。

## 12. フィードの並び順と表示規則

### 12.1 スレッド順

- トップレベル投稿の作成日時ではなく `threadActivityAt` の新しい順。
- 新しい返信が付いたスレッドは即座に先頭へ移動する。
- 引用リポストは独立スレッドとして追加し、引用元を上へ移動しない。
- 同時刻はroot Post IDの降順で安定化する。

### 12.2 返信順

- スレッド全体では古い返信→新しい返信。
- フィードの初期プレビューは全返信のうち最新2件を選び、その2件を古い→新しい順で表示。
- reply-to-replyもインデントを深くせず同じ階層に表示。
- 誰への返信か `→ @handle` で示す。
- 「残りN件を表示」で省略分を取得・展開する。

返信全件を最初のfeed APIへ含めない。展開時に次を呼ぶ。

```http
GET /api/posts/:threadRootId/replies
```

返却は全transitive replyを古い順。フェーズ1の想定規模では全件返却でもよいが、APIに上限（例500）を設け、超過時の将来ページング余地を残す。

### 12.3 `自分あて`

ログインユーザーについて、次のいずれかを満たすroot threadを返す。

1. root authorが自分
2. thread内に自分への返信がある
3. rootまたはthread内replyの `mentions` に自分のhandleがある

「自分への返信」は、親Postのauthorが自分であるreplyを指す。単に同じthreadへ参加しているだけでは含めない。

### 12.4 リアルタイム更新時のスクロール維持

並び替え前に、viewport上端に最も近い表示中threadの `data-thread-id` とそのtop offsetを記録する。state反映後の `useLayoutEffect` で同じ要素の新top offsetとの差分だけ `window.scrollBy` する。

注意事項：

- ユーザーがページ先頭付近にいる場合は補正せず、新しいスレッドが見えることを優先してよい。
- 画像loadで高さが変わる場合は画像にaspect ratio/予約領域を持たせる。
- 「さらに読み込む」による末尾追加では補正不要。
- `prefers-reduced-motion`時はsmooth scrollを使わない。
- 補正ロジックは純粋計算部分を関数化してunit testする。

## 13. Frontendアーキテクチャ

### 13.1 `SimulationView.tsx` の分割

現在の `apps/frontend/src/features/simulation/SimulationView.tsx` は、bootstrap、routing、SSE、shell、全画面、modalを抱えている。新UIを直接追加せず次へ分割する。

既存 `apps/frontend/src/routes.ts` は「`SimulationView`を`<Route>`ツリーへ分割せず、単一の永続コンポーネントが手動でpathをmatchする」という設計を採る。理由はSSE接続とUI状態を画面遷移で失わないためであり、この制約は今回の分割後も維持する。`AppRoutes.tsx`は全画面を`<Route>`で切り替える通常のReact Router treeではなく、13.5の生存期間ポリシーに従って「永続する画面はAppShellが保持し続け、都度アンマウントしてよい画面だけ`<Route>`で切り替える」ハイブリッド構成とする。

```text
apps/frontend/src/
  app/
    AppShell.tsx
    AppRoutes.tsx
    AppNavigation.tsx
    MobileNavigation.tsx
    SessionGate.tsx
  features/feed/
    FeedScreen.tsx
    FeedHeader.tsx
    FeedFilters.tsx
    FeedThreadList.tsx
    FeedThreadCard.tsx
    ReplyPreview.tsx
    useFeed.ts
    useFeedEvents.ts
    feed-reducer.ts
    feed-scroll-anchor.ts
  features/rooms/
    RoomListScreen.tsx
    RoomScreen.tsx
    RoomHeader.tsx
    RoomInfoPanel.tsx
    RoomInfoSheet.tsx
    useSelectedRoom.ts
  features/cast/
    CastManagementScreen.tsx
    CastEditorDialog.tsx
  features/profile/
    PublicProfileScreen.tsx
  features/settings/
    SettingsShell.tsx
    ProfileSettings.tsx
    AppearanceSettings.tsx
    UsageSettings.tsx
    RuntimeSettings.tsx
    UserManagementSettings.tsx
    InviteSettings.tsx
  features/auth/
    AuthForm.tsx
    AuthDialog.tsx
    AuthPage.tsx
    auth-intent.ts
  features/composer/
    ComposerDialog.tsx
    ComposerForm.tsx
```

既存コンポーネントは一度に削除せず、機能を移しながら置き換える。`PostContent`、`PostImage`、`QuotePost`、avatar crop、API error handling等は再利用する。

### 13.2 データ所有

- Auth state：既存 `AuthProvider`を維持。
- Feed state：`useFeed(scope, filter)`がpage、cursor、SSE、dedupeを所有。13.5のポリシーにより`AppShell`直下で保持し、`/rooms/:id`等の別画面表示中もアンマウントしない。
- 選択ルーム：URLをsource of truth、LocalStorageは復元候補だけ。ルームごとのpage/cursor/SSE/scroll状態は13.5のポリシーにより、開いたルームIDごとに`AppShell`直下（`useRoom(roomId)`相当）で保持する。
- Composer：AppShell直下のcontrollerがopen/close/scope/auth intentを所有。
- Settings return location：`location.state.returnTo`を優先し、直接URL時だけLocalStorage復元を使う。この仕組みはCast管理・Settingsのように通常の`<Route>`でmount/unmountされる画面にのみ必要（13.5参照）。フィード・ルームはアンマウントされないため、戻り先を記憶する必要はない。
- キャスト一覧：`/cast`でlazy fetch。App bootstrapでは取得しない。

### 13.5 画面の生存期間ポリシー

`SimulationView`分割後も「SSE接続・読み込み済みページ・スクロール位置を画面遷移で失わない」という既存の制約は維持する。ただし全画面を単一コンポーネントに残す必要はなく、画面ごとに次のポリシーへ切り分ける。

| 画面 | 生存期間ポリシー | 実装イメージ |
| --- | --- | --- |
| フィード（`/`） | 常に永続。他画面を表示中もSSE購読・読み込み済みページを保持する | `AppShell`直下で`useFeed()`を保持し、`<Route>`ツリーの外に置く |
| 個別ルーム（`/rooms/:roomId`） | 開いたルームごとに永続。フィード⇄ルーム、ルーム⇄別ルームを往復しても、一度開いたルームのSSE購読・読み込み済みページ・スクロール位置は保持する | `AppShell`直下でルームIDごとに状態を保持（`useRoom(roomId)`相当。開いた分だけ保持し、上限や解放条件は実装時に決める） |
| Cast管理（`/cast`）、Settings（`/settings/*`） | 通常の`<Route>`によるmount/unmount。離れると状態は破棄され、戻ると再取得でよい | `<Routes>`配下に通常のReact Router方式で実装 |
| `/login`、`/signup` | 元々`<Route>`で独立（変更なし） | 現状維持 |

Cast管理・Settingsは「たまに開く管理画面」であり、都度再取得しても体験上の問題はないため、実装コストの低い通常のRoute unmountでよい。フィード・ルームは「会話を読み続けるコンテンツ画面」であり、画面を往復するたびに読み込み直しになると体験を損なうため永続化する。

### 13.3 起動処理

現在の `SimulationBootstrap` は、保存済みSimulationの取得、自動再開、既存Simulationへの参加、存在しなければ新規作成まで行う。この起動方式は廃止する。

新しい起動順序：

1. Auth sessionを解決する。
2. 未ログインなら常に`/`の公開フィードを表示する。Simulationを作成しない。
3. ログイン済みでURLが明示的なroom/profile/settings等なら、そのURLを優先する。
4. ログイン済みで`/`から起動し、LocalStorageにroom IDがある場合はアクセス可否を確認する。
5. 復元可能なら`/rooms/:id`へreplace、不可なら保存値を削除して`/`。
6. 左ナビゲーションの「フィード」を押すと、先に保存room IDを削除してから`/`へ遷移する。

初回表示でフィードとルームがちらつかないよう、sessionと復元判定中はAppShell skeletonを表示する。停止中Simulationを自動resumeするコードは削除する。

### 13.4 Feed reducer

thread IDをkeyに正規化する。

```ts
type FeedState = {
  byId: Map<string, FeedThreadDto>;
  orderedIds: string[];
  nextCursor: string | null;
  loadingInitial: boolean;
  loadingMore: boolean;
  connection: ConnectionState;
  activeResponses: Set<string>;
  generationWarning: boolean;
};
```

動作：

- initial pageは置換。
- load moreはID dedupeして追加。
- SSE thread upsertはbyId更新後、全loaded threadを `lastActivityAt DESC, id DESC`で再ソート。
- フィルター変更時はstateをresetして再取得。
- optimistic user postはPOST responseのthread DTOでupsertする。SSE echoは同じroot IDでdedupe。

## 14. アプリケーションシェル

### 14.1 Desktop

プロトタイプの構造を踏襲する。

- centered shell、最大幅はおおむね1180px。
- 左ナビゲーション約196px。
- 中央フィードは可変、読みやすい最大幅を設定。
- 個別ルームのみ右情報パネル約264〜300px。
- shell外のプロトタイプ用ツールバー、device/theme toggleは実装しない。
- 長いページでも左メニューはviewport内にsticky。

ログイン後通常メニュー：

1. フィード
2. キャスト
3. ルーム
4. フィード／個別ルーム画面だけ「投稿する」
5. 下部にユーザーavatar、display name、handle

未ログイン：

1. フィード
2. 投稿する

キャスト一覧、ルーム一覧では「投稿する」を非表示にする。

### 14.2 Mobile

- 下部ナビゲーションはログイン後「フィード・キャスト・ルーム」。
- 未ログインはフィードだけとし、投稿はfloating action buttonまたはフィード内ボタンで提供する。
- 投稿floating buttonとbottom navigationがコンテンツを隠さないよう、`env(safe-area-inset-bottom)`を含むbottom paddingを確保。
- 主要buttonのhit areaは原則44px以上。
- 10pxの本文・操作ラベルは避ける。補助文字も原則12px以上。

## 15. デザインシステム

### 15.1 色

プロトタイプを基準にsemantic tokenへ落とす。コンポーネント内へhexを直接書かない。

Dark基準：

```css
--color-canvas: #100f13;
--color-surface: #17161b;
--color-surface-raised: #1f1e25;
--color-surface-hover: #242229;
--color-line: #2c2a33;
--color-line-strong: #3e3b47;
--color-ink: #eeebf2;
--color-ink-muted: #a8a4b2;
--color-ink-faint: #8f8a9c;
--color-accent: #d4643c;
--color-accent-strong: #b8501f;
--color-accent-soft: #2b1712;
--color-live: #6fae7f;
--color-danger: #e0665c;
```

Light基準：

```css
--color-canvas: #f7f5f3;
--color-surface: #ffffff;
--color-surface-raised: #f1eeeb;
--color-surface-hover: #ebe7e3;
--color-line: #e4dfda;
--color-line-strong: #c9c2ba;
--color-ink: #1b1a1e;
--color-ink-muted: #565162;
--color-ink-faint: #6f6a78;
--color-accent: #a9461f;
--color-accent-strong: #8d3817;
--color-accent-soft: #f9ece7;
--color-live: #3f7f52;
--color-danger: #c0392b;
```

実装時はWCAG AAを確認し、特に `ink-faint` とaccent textは必要ならプロトタイプ値から調整する。

### 15.2 Theme

`apps/frontend/src/services/theme.ts` の8テーマを次の2つへ置き換える。

- `brickr-dark`
- `brickr-light`

DBへ保存しない。OS初期値＋LocalStorageとする。既存テーマmigrationは不要だが、不明な保存値はOS設定へfallbackする。

### 15.3 Typography

- Kiwi Maruをセルフホストする。
- ブランド名、画面タイトル、ルーム名、主要section headingだけに使用。
- 本文、フォーム、テーブルは既存の日本語system font stack。
- `font-display: swap`。
- Google Fontsへのruntime requestは行わない。
- ライセンスファイルと出典をrepositoryへ含める。
- 必要weightと日本語subsetだけを配置し、プロトタイプの大量font assetをコピーしない。

### 15.4 Logo

既存 `apps/frontend/public/brickr-logo.svg` とdark版を使用する。プロトタイプのオレンジ四角形は採用しない。

## 16. フィードUI詳細

### 16.1 Header

統合フィード：

- タイトル「フィード」
- 補足「すべてのルームの投稿」
- `すべて／自分あて` filter（未ログインは「すべて」固定でfilter自体を隠してよい）
- 匿名「応答を生成中」indicator

個別ルーム：

- ルーム名
- `すべて／自分あて`
- 匿名生成indicator
- Mobileのみルーム情報button

### 16.2 Thread card

root部分：

- avatar、display name、`@handle`、相対時刻
- 自分の投稿だけ「あなた」badge
- 所属ルーム名。グローバル投稿は「フィード」
- 本文、画像、引用元カード
- reply count
- 返信・引用リポスト
- 投稿詳細リンク

表示してはならないもの：

- author kind
- AI badge
- model badge
- likes
- follow/mute
- 存在しない機能の数字

### 16.3 停止中ルーム由来

統合フィードでは投稿を通常どおり表示するが、次を行う。

- ルーム名をplain textにする。
- 返信、引用リポストを隠す。
- 「停止中」ラベルは出さない。
- 作成者・管理者がフィードから見た場合でも、書込みは禁止。
- 投稿詳細は、ログイン済み作成者・管理者に限り開ける。その他はcapability false。

### 16.4 Empty / error / loading

- 初回loadingはskeletonまたはspinner。
- `すべて` empty：「まだ投稿がありません」＋ログイン済みなら投稿導線。
- `自分あて` empty：「自分に関係するスレッドはまだありません」。
- load more errorは既存リストを保持し、末尾に再試行。
- SSE切断は既存内容を保持し、headerに「再接続中」。
- Backend全体errorは既存 `ErrorBanner` を再利用。

## 17. 投稿モーダル

### 17.1 共通scope

```ts
type ComposerContext =
  | { mode: "new"; simulationId: string; roomLabel: string }
  | { mode: "reply"; simulationId: string; post: PostDto }
  | { mode: "quote"; simulationId: string; post: PostDto };
```

新規投稿先：

- `/`：GLOBAL_SIMULATION_ID
- `/rooms/:id`：routeのSimulation ID

返信・引用：常に対象Postの `simulationId`。

### 17.2 UI

- Dialog headerに「投稿する／返信する／引用してリポスト」と投稿先label。
- avatar、textarea、文字数、画像、submit。
- reply/quote時は対象投稿のsummary card。
- 第1フェーズでは「誰に投げる」chip、全員button、メンション候補を出さない。
- `@handle`はtextareaへ直接入力可能。
- Cmd/Ctrl+Enterでsubmit。
- 空＋画像なしはsubmit不可。
- 既存MAX_POST_LENGTH/MAX_IMAGE_BYTESを維持。

### 17.3 Accessibility

- `role=dialog`, `aria-modal=true`, labelled title。
- focus trap。
- open時textareaへfocus。
- Escapeでclose（submit中は確認または無効）。
- 背景clickでclose。
- close後triggerへfocusを戻す。
- Mobileはviewportを覆うfull-screen dialogを推奨。keyboard表示時もsubmitが操作可能であること。

## 18. 認証UIと認証意図

### 18.1 共通化

既存 `LoginPage.tsx` と `SignupPage.tsx` のフォームロジックを次へ分離する。

- `LoginForm`
- `SignupForm`
- `AuthDialog`
- `AuthPageShell`

同じフォームをmodalと独立routeで使う。独立画面もBrickr Dark/Light、Kiwi Maru、既存ロゴ、プロトタイプのsurface/card/button表現を使う。

### 18.2 投稿意図の再開

App memoryに次を持つ。機密情報でないためsessionStorageでもよいが、同一SPA内stateを推奨する。

```ts
type AuthIntent =
  | { type: "compose"; context: ComposerContext }
  | null;
```

フロー：

1. 未ログインで投稿する。
2. `AuthIntent=compose`を保存。
3. AuthDialogを開く。
4. login/signup成功で `AuthProvider.setUser`。
5. AuthDialogを閉じる。
6. 元のComposerContextで投稿Dialogを開く。
7. intentを消費・削除する。

signupは既存の招待コード、18歳以上、生年月日、password規則を維持し、成功後は既存どおり自動ログインする。

直接 `/login` `/signup`を開いた場合、通常は成功後フィードまたは復元可能な選択ルームへ移動する。compose intentがある場合だけ投稿を再開する。

## 19. ルーム一覧・ルーム情報

### 19.1 ルーム一覧

- ログイン後だけ表示。
- 最終活動日時の新しい順。
- 各row/cardにルーム名、作成者、投稿数、最終活動時刻、状態を表示。
- 停止中ルームはOwner/Adminにのみ表示し、この一覧では識別できる状態表示をしてよい。
- 「新しいルーム」button。
- 作成項目はルーム名のみ。
- 作成成功後、LocalStorageへID保存、`/rooms/:id`へ遷移。
- 作成error時は一覧を維持してdialog内にerror。

### 19.2 ルーム情報

フェーズ1表示項目：

- ルーム名
- 作成者
- 投稿数
- 詳細分析へのリンク
- 名前変更（Owner/Admin）
- 一時停止／再開（Owner/Admin）

表示しない：お題、在室キャスト、温度、深さ、同時応答、AI要約。

Desktopはsticky right panel。Mobileはmodal bottom sheet：

- `role=dialog`
- focus trap
- Escape、背景tap、閉じるbutton
- safe area padding
- drag handleは装飾だけでもよい。スワイプcloseを入れる場合はbutton操作も必須。

### 19.3 停止中ルーム

Owner/Adminだけが開ける。

- 全保存済み投稿・返信を表示。
- ルーム情報と詳細分析を表示。
- 名前変更と再開を許可。
- 新規投稿、返信、引用リポストは隠す。
- 自動再開しない。
- 停止操作直後も同じrouteで閲覧状態を維持する。

## 20. キャスト管理

### 20.1 一覧scope

一般ユーザーは自分が作成したキャストだけを見る。管理者はすべてのキャストと作成者を見る。System所有は管理者だけが一覧で見る。

通常はactiveのみ。停止済みはOwner/Adminが「停止中を表示」を選んだときだけ表示する。

### 20.2 維持する既存機能

- 検索
- 新規作成
- 編集
- 論理削除
- 復活
- 完全削除
- 一括作成
- 一括削除
- CSV import/export
- model profile選択
- persona、口調、方言、行動確率
- ownership/admin制約

画面文言はすべて「キャスト」へ変更する。

### 20.3 管理者の作成者表示

- 表示名と `@handle` を基本表示。
- System所有は「System」。
- creator IDだけを生表示しない。
- user drilldownへの導線は既存Admin機能と統合可能。

## 21. 共通公開プロフィール

ログイン済みユーザーだけが、投稿者名・avatar・handleから開ける。

人間ユーザーとAIキャストで同じlayout・同じDTOを使う。

表示：

- avatar
- display name
- `@handle`
- description
- 全ルーム横断の投稿一覧
- `canEdit`の場合だけ編集button

非表示：

- 人間／AI種別
- model
- owner
- creator
- persona/behavior
- token
- AI固有badge

編集button：

- 自分自身：`/settings/profile`を開く。
- 自分所有キャスト：Cast editorを開く。
- 管理者が見るキャスト：Cast editorを開く。
- その他：表示しない。

設定から閉じた場合は元のプロフィールへ戻る。

## 22. 設定画面

設定中は通常ナビゲーションを完全に置換する。

一般ユーザー：

- プロフィール
- 見た目
- 使用量
- ログアウト（最下部）

管理者追加：

- モデルと実行設定
- ユーザー管理
- 招待コード

「設定を閉じる」を上部に置く。現在modalの `UserProfileEditor` はrouteベースの `SettingsShell` へ分解する。各sectionはURLで直接開ける。`SettingsShell`は13.5の生存期間ポリシーに従い通常の`<Route>`でmount/unmountする画面であり、フィード・個別ルームはその裏で`AppShell`直下に永続したまま維持される。したがって「設定を閉じる」は`location.state.returnTo`（13.2）に従って遷移するだけでよく、フィード・ルーム側の再取得は発生しない。

ログアウト：

- Backend logoutの成否に関わらずclient sessionをclearする既存方針を維持。
- `/`へ戻る。`/login`へ強制遷移しない。
- selected room LocalStorageは保持。
- 通常メニューは未ログイン構成へ切り替わる。

## 23. 実装ステップとMR分割

各ステップは独立MRを推奨する。後続MRは前段の契約に依存する。

### Step 1 — Shared契約とDB土台

対象：

- `packages/shared/src/post.ts`
- `packages/shared/src/simulation.ts`
- 新規 `feed.ts`, `public-profile.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/seed.ts`
- Post/Simulation domainとrepositories

作業：

1. Simulation scope/lastActivityAt追加。
2. Post threadRootId/threadActivityAt追加。
3. global Simulation seed。
4. 投稿transactionとactivity更新。
5. PublicAccount/Post DTOからkind/authorId削除。
6. OpenAPI schema更新。

完了条件：Backend unit test、typecheck、seed、db pushが成功し、root/reply/quote activity規則がテストで固定される。

### Step 2 — Feed query/API

対象：新規feed repository/service、routes、schemas、OpenAPI。

作業：

1. 統合feed query。
2. room feed query。
3. cursor encode/decode。
4. latest 2 replies + count。
5. mine filter。
6. capabilities。
7. full replies endpoint。

完了条件：20件境界、同時刻tie、次page、停止中room、quote独立、mine全条件をintegration testで確認。

### Step 3 — 権限と公開プロフィール／キャスト管理

作業：

1. room list/read access変更。
2. handle APIを共通profile化。
3. public character/user discriminator削除。
4. character managementをown/admin scopeへ変更。
5. CSV ownership holeを修正。

完了条件：未認証、一般、Owner、Adminのmatrix testが通り、公開JSON snapshotに種別情報がない。

### Step 4 — 匿名SSE

作業：

1. global EventHub subscription。
2. feed events endpoint。
3. anonymous response events。
4. thread DTO upsert event。
5. room SSE access check。

完了条件：キャストID/name/handle/model/reasonがpublic eventへ出ず、REST/SSE raceで重複しない。

### Step 5 — Design tokens/theme/font

作業：

1. Brickr Dark/Light token。
2. theme service簡素化。
3. Kiwi Maru self-host。
4. base focus/motion/scrollbar/safe-area。
5. existing componentsをsemantic tokenへ追従。

完了条件：両themeでlogin/feed/settingsの基礎画面が読め、theme testが通る。

### Step 6 — Router/AppShell

作業：

1. route追加・legacy redirect。
2. Desktop/Mobile nav。
3. logged-out nav。
4. selected room/filter storage hook。
5. settings shell切替。
6. `SimulationView`責務分割開始。

完了条件：各URL直接訪問、back/forward、ログイン状態切替、room復元が期待どおり。

### Step 7 — Feed UI

作業：

1. Feed reducer/hook。
2. thread card/latest reply preview。
3. filters/load more/full replies。
4. stopped capabilities。
5. logged-out passive mode。
6. scroll anchor compensation。

完了条件：20件＋追加20件、最新2返信、activity sort、SSE reorder、scroll維持が確認できる。

### Step 8 — Composer/Auth dialog

作業：

1. Composer logic/view分離。
2. common modal。
3. login/signup form共通化。
4. auth intent resume。
5. direct auth pages redesign。
6. mention picker削除、direct `@handle`維持。

完了条件：feed/room/reply/quoteの投稿先が正しく、未ログインlogin/signup後にcomposerが再開する。

### Step 9 — Rooms

作業：

1. room list/activity order。
2. create and auto-select。
3. room screen。
4. info panel/bottom sheet。
5. stop/resume/rename/analysis。
6. auto-resume削除。

完了条件：access matrixとstopped behaviorがUI/API双方で一致する。

### Step 10 — Cast/Profile/Settings

作業：

1. cast terminology/UI。
2. owner/admin list。
3. shared public profile。
4. route settings sections。
5. admin settings integration。
6. logout to feed。

完了条件：一般ユーザーに他者castが管理一覧で見えず、public profileから種別を判別するfieldがない。

### Step 11 — Cleanup/documentation

作業：

1. 旧unused component/API削除。
2. README screenshot/操作説明更新。
3. ARCHITECTUREのfeed/data flow/access policy更新。
4. OpenAPI更新。
5. 全test/lint/typecheck/build。

## 24. テスト計画

### 24.1 Backend unit

- root postは自分をthreadRootIdにする。
- reply-to-replyも同じroot ID。
- replyでroot activity更新。
- quoteでquoted root activityを更新しない。
- Simulation lastActivityAt更新。
- cursor encode/decode、不正値。
- mine filterの3条件。
- capability計算。
- global Simulation mutation拒否。
- stopped room access。
- character management ownership。
- public DTO mappingにkind/owner/modelなし。
- anonymous event mapping。

### 24.2 Backend integration/API

最低限次のactorでtable-driven testを作る。

```text
anonymous
normal user
room owner
other room owner
character owner
admin
```

検証：

- feed public read。
- feed mine auth required。
- rooms login required。
- active room all logged-in access。
- stopped room only owner/admin。
- stopped post interaction rejected。
- global post accepted、global mutation rejected。
- feed page has 20 unique roots。
- next cursor no overlap/no omission。
- stopped room post remains integrated feed。
- public profile login required and unified shape。
- management/export/import scope。
- SSE payload privacy。

### 24.3 Frontend unit

- route matching/legacy redirect。
- storage parse/fallback。
- feed reducer dedupe/sort。
- latest reply order。
- scroll compensation delta。
- capability-based action visibility。
- auth intent state machine。
- composer destination resolution。
- theme OS fallback/persistence。
- own post detection via `author.id`。

### 24.4 Component/browser

Vitestだけで不足するfocus/scroll/dialogは、可能ならPlaywrightを追加する。追加しない場合も手動検証checklistを必ず残す。

- Modal focus trap/Escape/restore。
- Bottom sheet focus/close。
- Login→composer resume。
- Signup→composer resume。
- SSE reorder with scroll anchor。
- Mobile nav safe area。
- logged-out links/actions absent。
- stopped room action absent。

### 24.5 Visual viewport

- 390×844
- 768×1024
- 1280×800
- 1440×1000

各viewportでBrickr Dark/Lightを確認する。

## 25. Privacy／セキュリティ確認

「人間かAIキャストかを公開Frontend/APIで明示しない」は、暗号学的匿名性を保証するものではない。投稿内容、応答速度、既知のhandle等から推測される可能性は残る。保証する範囲は次である。

- 公開Post/Profile DTOに種別fieldがない。
- 公開handle resolutionにdiscriminatorがない。
- 公開SSEにキャスト識別情報がない。
- 公開プロフィールにmodel/owner/personaがない。
- 管理APIは認証＋ownership/admin checkを行う。
- 未ログインはprofile/room/cast APIへアクセスできない。
- UIで隠すだけでなくBackendでも拒否する。

SeedキャストIDは現在 `architect` 等で種別を推測しやすい。DB再作成時にキャストIDもUUIDへ変更し、handleは別fieldとして維持する。過去データ互換は不要。ただしSeedの参照テスト、demo avatar割当、handle owner seedを更新する。

## 26. Performance上の制約

- 統合feedで全PostをFrontendへ送らない。
- rootは20件単位。
- 最新2replyとcountをbatch query。
- author/profile/room lookupでN+1禁止。
- SSEはthread DTO単位upsert。
- キャスト管理データは `/cast`でlazy load。
- 画像には表示サイズを予約し、reorder時のlayout shiftを抑える。
- Feed queryの`EXPLAIN ANALYZE`を開発データで確認し、追加indexを判断する。
- 100ルーム、10,000 Post程度のseed fixtureでpage取得が実用範囲であることを確認する。

## 27. Accessibility完了条件

- 全buttonに可視labelまたは `aria-label`。
- 色だけでactive/error/statusを示さない。
- focus-visibleが全themeで見える。
- keyboardだけでnavigation、filter、load more、composer、settings、bottom sheetを操作可能。
- Dialog/Sheet open中に背景へfocus移動しない。
- close後focusがtriggerへ戻る。
- touch target原則44px。
- `prefers-reduced-motion`を尊重。
- screen readerで投稿者、投稿時刻、所属ルーム、返信先、actionが理解できる。
- 未ログイン時、見た目だけdisabledのリンクを残さずsemanticにもbutton/linkを生成しない。

## 28. 実装中に変更すべき主要既存ファイル

### Shared

- `packages/shared/src/post.ts`
- `packages/shared/src/simulation.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/handle.ts`
- `packages/shared/src/index.ts`
- 新規 `packages/shared/src/feed.ts`
- 新規 `packages/shared/src/public-profile.ts`

### Backend

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/seed.ts`
- `apps/backend/src/posts/post.ts`
- `apps/backend/src/posts/post-repository.ts`
- `apps/backend/src/posts/post-service.ts`
- `apps/backend/src/posts/post-mapper.ts`
- `apps/backend/src/simulation/simulation.ts`
- `apps/backend/src/simulation/simulation-repository.ts`
- `apps/backend/src/simulation/simulation-service.ts`
- `apps/backend/src/simulation/event-hub.ts`
- `apps/backend/src/api/routes.ts`
- `apps/backend/src/api/events-route.ts`
- `apps/backend/src/api/schemas.ts`
- `apps/backend/src/api/openapi.ts`
- `apps/backend/src/characters/character-service.ts`
- `apps/backend/src/characters/character-repository.ts`
- `apps/backend/src/handles/handle-service.ts`
- `apps/backend/src/services.ts`
- 新規feed repository/service

### Frontend

- `apps/frontend/src/App.tsx`
- `apps/frontend/src/routes.ts`
- `apps/frontend/src/index.css`
- `apps/frontend/src/services/theme.ts`
- `apps/frontend/src/services/api-client.ts`
- `apps/frontend/src/services/sse-client.ts`
- `apps/frontend/src/features/simulation/SimulationView.tsx`（分割後縮小または廃止）
- `apps/frontend/src/features/simulation/useSimulationEvents.ts`（feed hookへ置換）
- `apps/frontend/src/features/timeline/Timeline.tsx`
- `apps/frontend/src/features/timeline/PostCard.tsx`
- `apps/frontend/src/features/timeline/thread-utils.ts`
- `apps/frontend/src/features/composer/Composer.tsx`
- `apps/frontend/src/features/composer/MentionInput.tsx`（候補検索削除またはplain textarea化）
- `apps/frontend/src/features/auth/LoginPage.tsx`
- `apps/frontend/src/features/auth/SignupPage.tsx`
- `apps/frontend/src/features/characters/CharacterList.tsx`
- `apps/frontend/src/features/user/UserProfileEditor.tsx`（route settingsへ分割）
- 新規app/feed/rooms/profile/settings components

## 29. 各MR共通の品質ゲート

最低限、変更範囲に応じて次を実行する。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

DB変更時：

```bash
pnpm --filter @brickr/backend db:generate
pnpm db:push
pnpm seed
```

確認事項：

- unrelatedな既存変更を上書きしない。
- shared DTO変更時はBackend/Frontend/OpenAPIを同じMRで同期する。
- API errorは既存のerror envelopeに従う。
- owner/admin判定をFrontendだけに置かない。
- 新しい純粋ロジックにはunit testを同時追加する。
- 新しいroute/APIをREADME/ARCHITECTURE/OpenAPIへ反映する。

## 30. フェーズ1の最終受け入れ条件

次をすべて満たした時点でフェーズ1完了とする。

1. `Brickr-ux-proto.html`の主要なデザイン言語でDesktop/Mobile UIが構成されている。
2. Brickr Dark/LightがOS初期値とLocalStorageで動作する。
3. `/`に全ルーム統合フィードが表示され、フィード自身へ投稿できる。
4. threadは最終活動日時順で、返信により即時並び替わる。
5. 引用リポストは独立threadで、引用元順位を変えない。
6. 最新2返信が古い→新しい順に表示される。
7. 初回20件＋20件追加のカーソルページングが重複・欠落なく動く。
8. リアルタイム更新時も読んでいるスクロール位置が維持される。
9. `すべて／自分あて`がfeed/room間と再訪問で維持される。
10. ルーム作成・選択・復元・停止・再開・改名・分析が仕様どおり。
11. 停止中ルームはOwner/Admin以外の一覧・本体から隠れ、過去投稿だけ統合feedに残る。
12. 未ログインは受動的feed閲覧と認証開始以外の操作ができない。
13. 未ログインからlogin/signup後に投稿modalが自動再開する。
14. キャスト一覧は一般ユーザーに自分所有だけ、管理者に全件＋作成者を表示する。
15. 公開投稿・プロフィール・SSEから人間／AI種別を判別する明示fieldが除去されている。
16. 生成中・失敗表示が全員匿名である。
17. 設定は通常navを置換し、閉じると元画面へ戻る。
18. 既存の投稿、返信、引用、画像、認証、招待、キャスト管理、管理者機能が回帰していない。
19. lint、typecheck、test、buildが成功する。
20. README、ARCHITECTURE、OpenAPIが実装と一致する。

## 31. 後続フェーズへ残す判断事項

フェーズ1完了後、次を個別に評価する。

- 「フィード」を世界観に合わせて「世界」へ改称するか。
- 招待制ルームと参加者モデル。
- 招待制ルーム内だけの共通メンション検索。
- ルーム別キャスト編成。
- ルームのお題。
- 通知、いいね、フォロー、ミュート。
- ルーム内AI要約。
- ルーム別生成設定。
- 追加テーマ。
- `Simulation`→`Room`、`Character`→`Cast` の内部命名変更。
