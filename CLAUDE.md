# CLAUDE.md

# Brickr — Post something. Watch the AIs bicker.

## 1. Project Overview

「Brickr」は、Twitter/X風のSNS UI上で、ユーザーの投稿に対して複数のAIキャラクターが、それぞれに与えられた性格・立場・口調に基づいて様々な投稿を行う様子を観察するためのWebアプリケーションです。名称はAI同士の口論（bicker）に由来し、タグラインは「Post something. Watch the AIs bicker.」です。

主目的は、

```text
同じ投稿を見た複数のAIキャラクターが、
それぞれ異なる人格に基づいて、
どのように違う反応や会話を生成するかを見ること
```

です。

炎上の正確な再現、実社会のSNS予測、リスク評価などはMVPの目的ではありません。

タグラインはAI同士の議論を表しますが、MVPではまず、

```text
複数AIキャラクターによるSNS風会話シミュレーション
```

として成立させることを優先します。

---

# 2. Core Experience

最重要のユーザー体験は以下です。

```text
ユーザーが投稿する
        ↓
複数のAI Characterが投稿を見る
        ↓
Characterごとの人格に基づいて反応する
        ↓
返信や引用投稿が追加される
        ↓
後から反応するCharacterは、
それまでの投稿も読んで反応できる
        ↓
Character同士の会話が自然に続く
```

重要なのは、

```text
「同じ入力に対して、
キャラクターごとに明確に違う反応が返ってくること」
```

です。

---

# 3. Project Priorities

このプロジェクトでは以下の順序を優先します。

1. Characterごとの差が明確に見えること
2. Character同士が自然に会話すること
3. Twitter/X風のTimelineとして見やすいこと
4. 複数LLM Providerを利用できること
5. 実装が単純で理解しやすいこと
6. Characterを増やしやすいこと

厳密なSNSシミュレーションや高度な分析機能は優先しません。

---

# 4. Design Philosophy

以下を重視してください。

- Frontend / Backendを明確に分離する
- CharacterとLLM Providerを分離する
- CharacterとModelを分離する
- LLMにApplication Logicを任せすぎない
- Business LogicをTest可能にする
- 不要な複雑化を避ける
- 将来の可能性だけを理由にArchitectureを複雑にしない
- LLMによる非決定性を許容する

毎回完全に同じ結果を再現する必要はありません。

むしろCharacterの反応に多少の揺らぎがあって構いません。

---

# 5. Repository Structure

FrontendとBackendは明確に分離します。

Monorepo構成を採用します。

```text
brickr/
├── apps/
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── timeline/
│   │   │   │   ├── composer/
│   │   │   │   ├── characters/
│   │   │   │   └── simulation/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── types/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── backend/
│       ├── src/
│       │   ├── api/
│       │   ├── characters/
│       │   ├── model-profiles/
│       │   ├── posts/
│       │   ├── simulation/
│       │   ├── agents/
│       │   ├── llm/
│       │   ├── persistence/
│       │   └── server.ts
│       ├── prisma/
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/
│       ├── src/
│       └── package.json
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── CLAUDE.md
```

---

# 6. Technology Stack

## Frontend

Frontendは以下で固定します。

```text
React
TypeScript
Vite
```

必要に応じて以下を利用可能です。

- Tailwind CSS
- TanStack Query
- React Router

ReduxはMVPでは導入しません。

UI Stateは基本的に、

```text
useState
useReducer
custom hooks
```

で管理してください。

TanStack QueryはServer State管理が必要になった場合のみ利用してください。

---

## Backend

Backendは以下で実装します。

```text
Node.js
TypeScript
```

HTTP frameworkはFastifyを第一候補とします。

```text
Fastify
```

既にExpressで十分な実装が存在する場合は、正当な理由なく置き換えないでください。

---

## Database

```text
PostgreSQL
```

ORMはPrismaを第一候補とします。

```text
Prisma
```

---

## Real-time Communication

BackendからFrontendへの投稿イベント配信には、

```text
Server-Sent Events
SSE
```

を利用します。

WebSocketは必要になるまで導入しないでください。

---

# 7. Docker Compose

ローカル開発環境はDocker Composeだけで起動できる構成にしてください。

必要なサービス:

```text
db
backend
frontend
```

起動:

```bash
docker compose up --build
```

Endpoint:

```text
Frontend
http://localhost:5173

Backend
http://localhost:3000

PostgreSQL
localhost:5432
```

BackendからPostgreSQLへは、

```text
db:5432
```

で接続します。

Frontendはブラウザから、

```text
http://localhost:3000
```

へアクセスします。

開発者にNode.jsやPostgreSQLのローカルインストールを要求しない構成を目指してください。

---

# 8. Frontend / Backend Separation

FrontendとBackendの責務を明確に分離してください。

## Frontend Responsibilities

Frontendは以下を担当します。

- Twitter/X風Timeline
- Post Composer
- Character表示
- Character選択UI
- @mention UI
- Reply表示
- Quote Post表示
- Character Profile
- Simulation状態表示
- REST API Client
- SSE Client
- Loading / Error表示
- 複数ブランドThemeの切り替え
- UI iconはBootstrap Iconsを使用し、絵文字をiconとして使用しない

Frontendの役割は、

```text
Backendから状態を取得して表示し、
ユーザー操作をBackendへ送信すること
```

です。

---

## Frontend Must NOT

Frontendでは以下を実装しないでください。

- OpenAI API呼び出し
- Anthropic API呼び出し
- Gemini API呼び出し
- LLM SDK利用
- API Key保持
- Character選択Logic
- Character Persona Prompt生成
- Conversation Context構築
- Databaseアクセス

これらはBackendの責務です。

---

# 9. Backend Responsibilities

Backendは以下を担当します。

- REST API
- SSE
- Character管理
- ModelProfile管理
- Post管理
- Mention解析
- Responder選択
- Conversation Context構築
- LLM orchestration
- Character投稿生成
- Reply生成
- Quote Post生成
- Simulation lifecycle
- Persistence
- LLM Provider管理

---

# 10. Shared Package

`packages/shared` はFrontendとBackend間のAPI Contract共有専用です。

置いてよいもの:

- API DTO
- Request type
- Response type
- SSE Event type
- enum
- 単純な共通定数

置いてはいけないもの:

- Prisma Model
- Repository
- Database Logic
- Business Logic
- Prompt
- LLM Provider
- API Key
- Environment-specific configuration

重要:

```text
Shared DTO
!= Backend Domain Model
```

---

# 11. Main Domain Concepts

MVPの主要Domain Conceptは以下です。

```text
Character
ModelProfile
Post
Simulation
UserProfile
```

必要性が出るまでDomain Objectを増やさないでください。

---

# 12. Character

CharacterはSNS上のAI人格を表します。

Example:

```ts
export type Character = {
  id: string;

  handle: string;

  displayName: string;

  description: string;

  rolePrompt: string;

  tonePrompt: string;

  dialectPrompt?: string;

  interests: string[];

  activityLevel: number;

  responseProbability: number;

  replyProbability: number;

  quoteProbability: number;

  influence: number;

  modelProfileId: string;

  avatarUrl?: string;
};
```

---

# 13. Character Persona

Characterの最重要要素はPersonaです。

Characterごとに、

```text
どう考えるか
何に注目するか
どういう立場を取りやすいか
どういう話し方をするか
```

を定義します。

Characterの差が十分に見えることを優先してください。

単に名前だけ違って、全員ほぼ同じ回答になる状態は失敗です。

---

# 14. Character Behavior

CharacterはPersonaだけでなく、簡単なBehaviorも持てます。

例:

```text
activityLevel
responseProbability
replyProbability
quoteProbability
influence
```

用途:

```text
よく反応するCharacter
ほとんど反応しないCharacter
返信しやすいCharacter
引用しやすいCharacter
```

などを表現します。

MVPでは複雑な行動モデルは不要です。

---

# 15. Character Storage

初期CharacterはTypeScript seedで定義して構いません。

```text
apps/backend/src/characters/
├── character.ts
├── character-service.ts
├── character-repository.ts
├── character-seeds.ts
└── prompts/
```

実行時にはDatabaseから取得する設計にします。

```text
character-seeds.ts
        ↓
database seed
        ↓
PostgreSQL
        ↓
CharacterRepository
```

MVPでは、

```text
10〜20 Characters
```

程度で十分です。

---

# 16. Initial Characters

MVPでは個性の強いCharacterを手作りします。

例:

- Architect
- Skeptic
- Explorer
- Kansai
- CEO
- Engineer
- Lawyer
- Beginner
- Optimist
- Pessimist
- Contrarian
- Old Timer
- Influencer

Character数を増やすことより、Character間の違いを明確にすることを優先してください。

---

# 17. Example Character: Architect

```text
Role:
議論の論点を整理し、
技術・事業・運用を横断して考える。

Tone:
冷静
簡潔
標準語
```

---

# 18. Example Character: Skeptic

```text
Role:
投稿や議論に含まれる前提、
矛盾、例外、問題点を見つける。

Tone:
慎重
分析的
やや批判的
```

---

# 19. Example Character: Explorer

```text
Role:
他のCharacterが触れていない観点を探す。
別の解釈や第三の選択肢を提示する。

Tone:
好奇心が強い
建設的
```

---

# 20. Example Character: Kansai

```text
Role:
議論を現実的な視点から見る。
必要なら軽いツッコミを入れる。

Tone:
自然な関西弁
```

過度なステレオタイプ表現を避けてください。

避ける例:

```text
せやかて！
知らんけど！
ほんまでっか！
```

より自然な例:

```text
それやったら、まず簡単な構成で試した方がええと思うで。
```

---

# 21. Character Prompt Rules

全Character共通ルール:

- 日本語で回答
- SNS投稿程度の短文
- 原則100〜140文字程度
- 必要以上に長文にしない
- 不要な前置きを避ける
- 他Characterの発言を参照してよい
- 必要なら同意・補足・反論・訂正する
- 他Characterへの言及には `@handle` を使う
- 無理にmentionしない
- Character Roleを毎回大げさに演じない
- 同じ内容を繰り返さない
- SNS上の自然な文章として生成する

---

# 22. ModelProfile

CharacterはLLM ProviderやModelを直接管理せず、

```text
modelProfileId
```

を持ちます。

Example:

```ts
export type ModelProfile = {
  id: string;

  providerId:
    | "openai"
    | "anthropic"
    | "gemini";

  model: string;
};
```

Character:

```ts
{
  id: "architect",
  modelProfileId: "openai-default"
}
```

Backend起動後、ModelProfile APIが最初に呼ばれた時点で、環境変数にAPI Keyが設定された
OpenAI / Anthropic / GeminiのModels APIを並列に呼び出します。取得した生成可能Modelを
安定したIDのModelProfileとしてupsertし、5分間cacheします。Geminiは`generateContent`
対応Modelだけを採用します。OpenAIはModels APIがendpoint capabilityを返さないため、
会話生成Model familyからaudio / image / realtime / search等の専用Modelを除外します。
1 Providerの一覧取得に失敗しても、他Providerの結果と保存済みModelProfileは利用可能にします。

---

# 23. Character / Model / Provider Separation

重要:

```text
Character Persona
      ≠
ModelProfile
      ≠
LLM Provider
      ≠
API Credential
```

例:

```text
Architect
    ↓
openai-default
    ↓
OpenAIProvider
    ↓
OPENAI_API_KEY
```

Characterの人格を変更せずに、利用ModelやProviderを変更できるようにしてください。

---

# 24. LLM Provider Abstraction

LLM Providerには共通Interfaceを用意します。

```ts
export interface LLMProvider {
  readonly id: string;

  listModels(
    signal?: AbortSignal,
  ): Promise<LLMAvailableModel[]>;

  generate(
    request: LLMGenerateRequest,
  ): Promise<LLMGenerateResult>;
}
```

Example:

```ts
export type LLMGenerateRequest = {
  model: string;

  systemPrompt: string;

  messages: LLMMessage[];
};
```

Provider implementation:

```text
OpenAIProvider
AnthropicProvider
GeminiProvider
```

Provider固有のAPI仕様をApplication側へ漏らさないでください。

---

# 25. LLM Provider Registry

ProviderはRegistryで解決します。

```text
Character
    ↓
ModelProfile
    ↓
providerId
    ↓
LLMProviderRegistry
    ↓
OpenAIProvider
AnthropicProvider
GeminiProvider
```

---

# 26. Environment Variables

API KeyはBackendだけが利用します。

`.env.example`:

```env
OPENAI_API_KEY=
OPENAI_MODEL=

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

GEMINI_API_KEY=
GEMINI_MODEL=

DATABASE_URL=
```

API KeyをFrontendへ渡さないでください。

API KeyをCharacterレコードへ保存しないでください。

Character編集UIではProviderとModelを別々に選択し、選択したProviderについて
Backendが取得・保存したModelProfileだけをModel候補として表示します。

---

# 27. Git Ignore

必須:

```gitignore
.env
.env.*
!.env.example
```

SecretをGitへcommitしないでください。

---

# 28. Post

User Post、Character Post、Reply、Quote Postを基本的に同じPost Modelとして扱います。

Example:

```ts
export type Post = {
  id: string;

  simulationId: string;

  authorId: string;

  content: string;

  mentions: string[];

  replyTo?: string;

  quoteOf?: string;

  createdAt: string;
};
```

MVPではRepost専用Modelは不要です。

---

# 29. Thread

ReplyやQuoteによってPost同士が関連します。

必要以上に複雑なThread Domain Modelを作らず、

```text
replyTo
quoteOf
```

の関係からThreadを取得してください。

---

# 30. Character Context

Characterは、自分の処理が開始された時点で現在のThreadを取得します。

基本:

```text
Character処理開始
        ↓
現在のThread Postsを取得
        ↓
その内容をContextとしてLLMへ渡す
        ↓
LLMが文章を生成
        ↓
Postとして保存
```

LLM生成中に新しい投稿が増えても、そのLLM呼び出しには追加しません。

後から処理を開始したCharacterは、それまでに追加された投稿を読むことができます。

---

# 31. No Round or Wave Model

Round ConsistencyやGeneration Waveは実装しません。

例えば、

```text
User Post
↓
Character Aが反応
↓
Character Bが処理開始
↓
BはUser + Aを読んで反応
↓
Character Cが処理開始
↓
CはUser + A + Bを読んで反応
```

という動作を許容します。

CharacterごとのContextが異なって構いません。

---

# 32. LLM Timing

LLM Providerごとの応答速度の違いを過剰に補正しません。

処理順によってConversationの展開が変わって構いません。

これは仕様として許容します。

Contextは、

```text
LLM呼び出し直前
```

に取得してください。

LLM呼び出し終了後にContextを再取得して回答を書き換える必要はありません。

---

# 33. Character Processing Example

概念的には以下程度の実装を想定します。

```ts
async function processCharacter(
  character: Character,
  targetPostId: string,
) {
  const posts =
    await threadService.getCurrentThread(
      targetPostId,
    );

  const shouldRespond =
    responderService.shouldRespond(
      character,
      posts,
    );

  if (!shouldRespond) {
    return;
  }

  const action =
    responderService.selectAction(
      character,
      posts,
    );

  const generated =
    await agentService.generate({
      character,
      posts,
      action,
    });

  await postService.publish(generated);
}
```

MVPではこれ以上複雑なTiming Modelを作らないでください。

---

# 34. Mentions

Post本文に `@handle` が含まれている場合、そのCharacterは必ずResponder候補に含めます。

例:

```text
@skeptic この企画どう思う？
```

→ `skeptic` は必ず反応。

UserがUIでCharacterを明示選択した場合も必須Responderにします。

Priority:

```text
1. MentionされたCharacter
2. Userが明示指定したCharacter
3. その他のCharacter
```

---

# 35. Responder Selection

すべてのCharacterが毎回投稿しないようにします。

MVPでは、

```text
MentionされたCharacter
+
明示選択Character
+
ランダムに数Character
```

程度で十分です。

Example:

```text
2〜6 Character程度
```

を投稿者として選びます。

Characterによって反応しやすさが異なって構いません。

---

# 36. Response Actions

MVPでは以下の投稿Actionを扱います。

```text
reply
quote
```

通常の独立したコメントが必要なら、

```text
post
```

として扱って構いません。

「いいね」はMVPでは実装しません。

---

# 37. Reply

ReplyはPostとして扱います。

Example:

```ts
{
  content: "それは違うと思います。",
  replyTo: "post_123"
}
```

---

# 38. Quote Post

Quote PostもPostとして扱います。

Example:

```ts
{
  content: "この意見は少し気になります。",
  quoteOf: "post_123"
}
```

Quote先のPost内容もFrontendで表示してください。

---

# 39. Character-to-Character Interaction

CharacterはUserだけでなく、他のCharacterにも反応できます。

Example:

```text
@skeptic
この設計には問題があると思います。

@architect
@skeptic の懸念は分かりますが、
この条件なら成立すると思います。

@kansai
@architect そこまで複雑にせんでもええんちゃう？
```

このようなCharacter間のConversationが、このアプリの重要な体験です。

---

# 40. Mentions Generated by LLM

Characterは必要に応じて他Characterへ `@mention` できます。

ただし、全投稿でmentionを強制しないでください。

自然な場合だけ使用します。

---

# 41. Conversation Context

LLMへ渡すContextには以下を含めます。

- Target Post
- Relevant Replies
- Relevant Quote Posts
- User Posts
- Character Posts
- author handle
- 投稿順序

Example:

```text
@you:
RAGって本当に必要？

@architect:
小規模なら単純検索から始めてもよいと思います。

@skeptic:
@architect に概ね同意。ただし権限制御が必要なら別です。

@kansai:
最初から大げさなん作らんでもええと思うで。
```

---

# 42. Context Size

全履歴を無制限にLLMへ渡さないでください。

MVPでは、

```text
Relevant Thread
+
最近の10〜20 Posts程度
```

で十分です。

高度なVector SearchやMemory管理は不要です。

---

# 43. SSE

Characterの投稿がすべて完成するまでFrontendを待たせないでください。

生成された投稿から順次Frontendへ送信します。

Example:

```text
User Post
   ↓
Character A generated
   ↓
post.created
   ↓
Character B generated
   ↓
post.created
   ↓
Character C generated
   ↓
post.created
   ↓
simulation.completed
```

---

# 44. SSE Endpoint

```http
GET /api/simulations/:simulationId/events
```

Event examples:

```text
post.created
character.processing
simulation.completed
simulation.failed
```

`character.processing` はUI上で「考え中」を表示する場合のみ利用してください。
表示する場合は、Timeline上部ではなく反応対象のPost直下に表示してください。
Eventには対象を特定する`targetPostId`を含めます。

接続状態表示は操作可能にし、クリックでFrontendのSSE接続を明示的に
切断・再接続できるようにします。切断中もREST APIとBackend側の生成は継続します。

---

# 45. Backend API

Base URL:

```text
/api
```

---

## Health

```http
GET /api/health
```

---

## Characters

```http
GET /api/characters
GET /api/characters/:id
GET /api/characters/:id/config
POST /api/characters
PUT /api/characters/:id
GET /api/model-profiles
GET /api/user-profile
PUT /api/user-profile
```

Frontend向けCharacter DTOには内部PromptやAPI設定を含めないでください。

---

## Simulations

```http
POST /api/simulations
GET  /api/simulations/:id
POST /api/simulations/:id/stop
POST /api/simulations/:id/resume
```

---

## Posts

```http
POST /api/simulations/:id/posts
GET  /api/simulations/:id/posts
GET  /api/posts/:id
```

User ReplyやQuoteも同じPost APIで扱います。

---

## SSE

```http
GET /api/simulations/:id/events
```

---

# 46. Post API Example

Request:

```json
{
  "content": "@skeptic この企画どう思う？",
  "responderIds": [
    "kansai"
  ]
}
```

Processing:

```text
Post保存
↓
Mention解析
↓
Mandatory Responders決定
↓
その他Responder選択
↓
各Character処理
↓
Thread取得
↓
LLM生成
↓
Post保存
↓
SSE送信
```

---

# 47. Character API DTO

Frontend向けDTOは最低限にします。

```ts
export type CharacterDto = {
  id: string;

  handle: string;

  displayName: string;

  description: string;

  avatarUrl?: string;
};
```

以下は通常の一覧・プロフィールAPIには返しません。

```text
rolePrompt
tonePrompt
dialectPrompt
modelProfileId
provider configuration
internal probabilities
API keys
```

Character作成・編集画面向けの専用Config APIでは、Persona Prompt、Behavior、
ModelProfile IDを返して構いません。API KeyやProvider credentialは返しません。

---

# 48. Frontend UI

Twitter/X風のTimeline UIを目指します。

主要表示項目:

- avatar
- display name
- @handle
- content
- timestamp
- reply relationship
- quoted post

LLM Provider名は主役ではありません。

CharacterのPersonaがUIから伝わることを優先してください。

独立した「ホーム」ナビゲーション項目は置かず、ヘッダーのサービス名または
ユーザーのavatarから、投稿Composerのあるホームへ戻れるようにします。
ユーザーおよび各Characterの個別Timelineには、本人が書いたPostに加えて、
本人のhandleがmentionされたPostも表示します。Profileの投稿数は本人が書いたPostだけを数えます。
UserおよびCharacterのProfile領域はアプリヘッダー直下にsticky表示します。
Timelineは最初の100件を表示し、「さらに表示」で100件ずつ追加表示します。
右パネルのCharacter一覧も同様に100件ずつ追加表示します。
各Postの右上にはBootstrap Iconsの展開ボタンを表示します。展開後のPost詳細画面では、
対象Postに紐づくすべてのReply（子孫を含む）と、そのPostを直接引用したすべてのRepostを表示します。
対象Post自身がReplyまたはQuoteとして別のPostを参照している場合、参照元は1件だけを1階層表示し、
参照元からさらに過去の参照関係を再帰表示しません。旧データなどでReplyとQuoteの両方を持つ場合は
Reply先を優先します。

---

# 49. Composer

Composerでは以下を可能にします。

- Text入力
- @mention
- Post

ホームではProfile直下の「投稿する」ボタンからComposerを展開し、投稿成功後に閉じます。
Character Profileの「@で話しかける」から遷移した場合は、mention入りのComposerを自動展開します。

Example:

```text
What's happening?

@skeptic この企画どう思う？

                        [Post]
```

通常の新規PostにはPNG / JPEG / GIF / WebP画像を1枚添付できます。
最大サイズは5MBです。ReplyとQuote Postには新しい画像を添付できません。
Post本文中のHTTP / HTTPS URLは、通常Post、Reply、Quote、Repostのすべてで
安全な外部リンクとして表示します。

---

# 50. Character Profile

Character Profileでは、

- avatar
- displayName
- handle
- description

程度を表示します。

Character一覧内のdescription previewは最大30文字程度に省略し、
全文はCharacter Profileで表示します。

内部PromptをそのままUIへ表示する必要はありません。

Character作成・編集画面では、Personaを構成するrole / tone / dialect Prompt、
Behavior、利用するModelProfileを編集できます。
通常画面では右パネルのCharacter一覧を表示し、見出しの「キャラクター」を一覧画面への導線にします。
Character一覧画面では、Characterの検索・新規作成・編集・単体削除・選択したCharacterの
一括削除を行えます。この画面では右パネルを表示せず、Characterをテーブル形式で表示します。
管理テーブルは1ページ100件でページネーションします。
管理テーブルのヘッダーはテーブル内スクロール時も上端に固定します。
人数を1〜100人で指定する一括追加にも対応します。プロフィール、Persona、口調、関心分野は
LLMでCharacterごとに生成し、行動傾向の各数値はBackendでランダムに割り当てます。
人数欄は文字列として扱い、1〜100の整数表記だけを有効にします。空欄、0、先頭ゼロ、
小数、符号付き入力、101以上では作成ボタンを無効にします。
LLM出力は保存前に検証し、衝突しないhandleを付与したうえでトランザクション保存します。
構造化出力は共通JSON Schemaから、OpenAIのstrict `response_format.json_schema`、
Anthropicの`output_config.format`、Geminiの`responseMimeType / responseJsonSchema`へ変換します。
Anthropicは配列の`minItems > 1`を受け付けないため、`characters`を
`character_1`〜`character_N`の固定キーオブジェクトにします。全キーをrequired、
`additionalProperties: false`として、3 Providerすべてで要求人数をSchemaレベルで強制します。
一括作成はBackendの非同期Jobとして実行し、モーダル内のプログレスバーに生成済み人数と
生成中・保存中・完了・失敗の状態を表示します。失敗時はタイムアウト、Provider/APIエラー、
JSON解析不能、項目不足、件数不一致などの安全な失敗理由もモーダル内に表示します。
テーブルには利用Modelと、活動・反応・返信・引用・影響度の行動傾向を個別のカラムで表示し、
各行動傾向カラムを昇順・降順で並び替え可能にします。
プロフィールはCharacter名の下に50文字程度まで表示し、その他の長いテキストは
100文字程度までに省略します。削除後も過去のPostは投稿者情報を含めて保持します。

ホームでは投稿Composerの上にUser ProfileをCharacter Profileと同じ形式で表示します。
UserはdisplayName、description、avatarを編集できます。識別子`you`とhandle`@you`は固定です。
UserとCharacterのavatarはURL入力ではなく画像アップロードで設定し、
アップロード時に正方形の切り取り位置と拡大率を調整できるようにします。
Themeの切り替えもUser Profileの設定変更画面に置きます。
選択可能なThemeはX.com Light / Dark、Salesforce、Atlassian、GitLab Light / Dark、
GitHub Light / Darkとし、選択ボタンには各Themeのカラーサンプルを表示します。
UI上のicon表現にはBootstrap Iconsを使用し、絵文字は使用しません。
モーダルは「閉じる」または「キャンセル」に加えて、モーダル外側の背景クリックでも閉じます。
保存や画像処理の実行中は、背景クリックによるクローズを無効にします。

---

# 51. LLM Error Handling

LLM API failureはExpected Failureとして扱います。

Example:

```text
Architect generated
Skeptic timeout
Kansai generated
```

Skepticが失敗してもSimulation全体を止めないでください。

Retryは最大1回程度で十分です。

無限Retryは禁止です。

---

# 52. Timeout

各LLM API callにはTimeoutを設定してください。

1つのProviderの遅延でSimulation全体が永久に停止しないようにします。

---

# 53. Concurrent Execution

複数Characterは並列実行して構いません。

各CharacterはLLM呼び出し直前にThreadを取得します。

そのため、

```text
Character Aが取得したContext
!= Character Bが取得したContext
```

となって構いません。

Character Aの投稿が先に完成すれば、後から処理開始したCharacter BはAの投稿を見ることができます。

この非決定性は許容します。

---

# 54. Testing

LLM APIなしでUnit TestできるLogicを分離してください。

対象:

- mention parser
- mandatory responder resolution
- random responder selection
- action selection
- model profile resolution
- thread retrieval

LLMProviderはMock可能にしてください。

---

# 55. Security Basics

最低限以下を守ってください。

- API KeyをFrontendへ送らない
- API KeyをLogに出さない
- `.env` をcommitしない
- User inputをHTMLとして直接renderしない
- BackendでRequest Validationを行う

MVPでは高度な認証機構は不要です。

---

# 56. Database

MVPで最低限必要なTable候補:

```text
characters
model_profiles
simulations
posts
user_profiles
```

必要性が出るまでTableを増やさないでください。

---

# 57. Suggested Backend Structure

```text
apps/backend/src/
├── api/
│
├── characters/
│   ├── character.ts
│   ├── character-service.ts
│   ├── character-repository.ts
│   └── character-seeds.ts
│
├── model-profiles/
│   ├── model-profile.ts
│   └── model-profile-repository.ts
│
├── posts/
│   ├── post.ts
│   ├── post-service.ts
│   ├── post-repository.ts
│   ├── thread-service.ts
│   └── mention-parser.ts
│
├── simulation/
│   ├── simulation.ts
│   ├── simulation-service.ts
│   ├── responder-selector.ts
│   └── action-selector.ts
│
├── agents/
│   ├── agent-service.ts
│   └── prompt-builder.ts
│
├── llm/
│   ├── provider.ts
│   ├── provider-registry.ts
│   ├── openai-provider.ts
│   ├── anthropic-provider.ts
│   └── gemini-provider.ts
│
├── persistence/
│
└── server.ts
```

---

# 58. Suggested Frontend Structure

```text
apps/frontend/src/
├── components/
│
├── features/
│   ├── timeline/
│   │   ├── Timeline.tsx
│   │   ├── PostCard.tsx
│   │   └── QuotePost.tsx
│   │
│   ├── composer/
│   │   ├── Composer.tsx
│   │   ├── MentionInput.tsx
│   │   └── ResponderSelector.tsx
│   │
│   ├── characters/
│   │   ├── CharacterProfile.tsx
│   │   └── CharacterPicker.tsx
│   │
│   └── simulation/
│       ├── SimulationView.tsx
│       └── useSimulationEvents.ts
│
├── services/
│   ├── api-client.ts
│   └── sse-client.ts
│
├── hooks/
├── types/
├── App.tsx
└── main.tsx
```

---

# 59. MVP Scope

MVPでは以下を実装します。

1. React + TypeScript Frontend
2. Vite
3. Node.js + TypeScript Backend
4. Fastify
5. PostgreSQL
6. Prisma
7. Docker Compose
8. User Text Post
9. 10〜20 Named Characters
10. Character Persona
11. Character Behavior
12. OpenAI Provider
13. Anthropic Provider
14. Gemini Provider
15. ModelProfile
16. @mentionされたCharacterの必須反応
17. Explicit Responder Selection
18. Random Responder Selection
19. Reply
20. Quote Post
21. Characterごとの現在Thread参照
22. Character同士の@mention
23. Character同士の会話
24. SSEによる順次表示
25. 一部Provider失敗時の継続
26. Simulationの停止と再開
27. Character作成・編集UI
28. 8種類のブランドTheme切り替え
29. User Profile表示・編集
30. 通常Postへの画像添付（Reply / Quoteは除く）
31. 添付画像をLLMのマルチモーダル入力として渡し、Characterが内容を解釈できること
32. Character一覧画面での作成・編集・単体削除・一括削除

---

# 60. MVP Does NOT Need

MVPでは以下を実装しないでください。

- Like
- Risk Score
- Risk Analysis
- Sentiment Analysis
- Marketing Review
- Social Media Risk Prediction
- Round Consistency
- Generation Waves
- scheduledAtベースの仮想時刻
- deterministic execution ordering
- 1000 Character
- Follow Graph
- Recommendation Engine
- Kubernetes
- Kafka
- Redis
- GraphQL
- Microservices
- Event Sourcing
- CQRS
- Vector Database
- Graph Database
- Complex Authentication
- Enterprise RBAC
- Workflow Engine
- Complex Observability

必要性が出た場合にのみ追加してください。

---

# 61. Phase 2 Candidates

MVP後に必要性を見ながら検討します。

- Character数の増加
- Background Character Generator
- Character Interests
- Follow Graph
- より複雑なCharacter Behavior
- より長いConversation
- QuoteからのConversation Branch
- Conversation Visualization

---

# 62. Coding Guidelines

- TypeScript strict mode
- `any` を避ける
- Domain typeを明示する
- Small modules
- Small functions
- Framework codeとBusiness Logicを分離する
- Provider固有コードをLLM Provider層に閉じ込める
- Frontend / Backend責務を混ぜない
- API DTOとDomain Modelを混ぜない
- Model名を不用意にhard-codeしない
- API Keyをcodeへ書かない
- 過剰な抽象化をしない
- 将来の可能性だけを理由に複雑化しない

---

# 63. Keep It Simple

このプロジェクトでは以下のような考え方を避けてください。

```text
「AIだからVector DBが必要」
「リアルタイムだからWebSocketが必要」
「将来Characterが増えるからKafkaが必要」
「投稿があるからEvent Sourcingが必要」
```

まずは、

```text
React
+
Node.js
+
PostgreSQL
+
REST
+
SSE
+
LLM APIs
```

で実装してください。

---

# 64. Definition of Done for MVP

以下をブラウザで確認できればMVP成立です。

```text
1.
docker compose up --build
で全サービスが起動する

2.
FrontendからUserが投稿できる

3.
User PostがTimelineへ表示される

4.
@mentionされたCharacterが反応する

5.
UIで明示指定したCharacterが反応する

6.
その他数人のCharacterがランダムに反応する

7.
Characterごとに明確に違う人格・口調・観点がある

8.
Characterは処理開始時点で存在するThreadを読む

9.
後から処理されたCharacterは、
既に存在する他Characterの投稿を参照できる

10.
Characterが他Characterへ@mentionできる

11.
Character同士でReplyが続く

12.
Quote Postが生成される

13.
Quoteされた内容を見て別Characterが反応できる

14.
生成されたPostがSSEで順次表示される

15.
OpenAI / Anthropic / Geminiの複数Providerを利用できる

16.
CharacterとProvider / Modelの組み合わせを変更できる

17.
一つのLLM Providerが失敗しても、
他のCharacter処理は可能な限り継続する
```

---

# 65. Final Priority

このプロジェクトの最終優先事項は非常に単純です。

```text
ユーザーが何か投稿する。

すると複数のAI Characterが、
それぞれに与えられた性格や立場で、
全然違うことを言い始める。

さらに他Characterの投稿を読んで、
同意したり、反論したり、引用したりして、
自然に会話が続いていく。
```

まず、この体験を成立させてください。

高度な分析機能や精密なSNSモデルを作ることより、

```text
Characterが本当に別人格に見えること
```

を最優先してください。

---

# 66. Login Feature (計画中・MVP後)

ここからは、User Login機能を追加する際の設計方針です。

MVP Scope（59条）には含まれず、55条・60条の「MVPでは高度な認証機構は不要」「Complex Authentication / Enterprise RBACは実装しない」は維持したまま、
必要最小限のLogin機能として設計します。Enterprise RBACのような複雑な権限モデルは導入しません。

---

## 66.1 User Attributes

既存のUserProfile（48条: handle固定`@you`、displayName、description、avatar）に加えて、以下を持ちます。

```text
handle       (登録後変更不可。User / Character共通namespaceでDatabase制約により一意)
displayName  (公開、編集可)
description  (公開、編集可)
avatar       (公開、編集可)
email        (ログイン名、非開示)
生年月日      (非開示、登録後変更不可。18歳未満は登録不可)
country      (任意、編集可)
region       (任意、編集可。都道府県 / 州レベルまで。市区町村以下の住所や電話番号は収集しない)
interests    (任意、編集可)
occupation   (任意、編集可)
x_handle     (任意、編集可)
```

非開示の氏名フィールドは持ちません。`displayName`のみで公開名を表現します。

`handle`の一意性はUserとCharacterで共有し、Application Logicではなく**Database制約**で強制します。

---

## 66.2 Handle-based Routing

`/handle`（例: `/architect`）でその人物（UserまたはCharacter）のTimelineへ直接遷移できるようにします。

Frontendにはまだルーターが存在しないため、React Router（6条で利用可能と定義済み）を導入し、
`SimulationView`が保持するView状態をURLへ同期させます。Handleから著者を解決するAPIは、
Simulationを読み込んでいない状態からのアクセス（直接URL / リロード）でも解決できる必要があります。

---

## 66.3 Simulation / Timeline for Multiple Users

複数の実Userが存在しても、Simulation（会話の場）自体は分割しません。

```text
Simulation
    ↓
共有Thread（User / Character問わず同じPost Model）
    ↓
著者ごとのTimelineは既存の仕組み（48条）をそのまま利用
```

UserもCharacterも同じ`authorId`として扱い、投稿者が人間かAIかをUI上で区別する情報は表示しません。

すべてのUserは、存在するどのSimulationにも参加（投稿）できます。ただし、Stop状態のSimulationには参加できません。

Simulationの`Stop` / `Resume`は、そのSimulationの作成者本人と管理者のみが実行できます（35条〜36条のResponder Selection自体には変更なし）。

---

## 66.4 API Key と Token消費

LLM API Keyは引き続き26条の通り環境変数（`.env`）でのみ管理し、Userごとの個別API Key保存は行いません。

代わりに、Userごとの LLM Token消費量を記録・表示します。

```text
Character生成完了
    ↓
その生成を誘発したPostのUserにToken使用量を紐づけて記録
    ↓
Userのプロフィール設定画面に自分のToken消費量を表示
```

`LLMGenerateResult`にはProviderのレスポンスに含まれるToken使用量（prompt / completion）を含めます。

---

## 66.5 Character Ownership

Login導入後は、一般Userも管理画面からCharacterを作成できます。

```text
Character.createdByUserId
```

を持ち、可視範囲は次の通りです。

```text
作成者本人・管理者   : 参照可能
その他のUser        : 参照不可（通常のCharacter DTOにも含めない）
```

Characterの編集・削除は、作成者本人と管理者のみに制限します。

---

## 66.6 Simulation Ownership

Simulationにも`createdByUserId`を持たせますが、Characterと可視範囲のルールが逆になります。

```text
Simulationの作成者   : 全Userに公開（誰でも見える）
Simulationの分析画面 : 作成者本人・管理者のみ閲覧可能
```

CharacterとSimulationで「作成者情報の公開範囲」が異なる点を混同しないでください。

---

## 66.7 Admin Capabilities

管理者（`isAdmin`のような単純なbooleanで表現し、複雑なRoleモデルは導入しない）は以下を行えます。

- User一覧画面から、特定のUserが作成したCharacter一覧とToken消費量をdrilldownで確認する
- User Accountを停止 / 復帰する
- Character一覧画面（50条）と同様のパターンで、User管理用のテーブル画面を持つ

管理者権限はこれらの用途に閉じ、Enterprise RBACのような汎用的な権限管理機構は導入しません（60条）。

---

## 66.8 Authentication Mechanism

認証方式はEmail + Passwordに固定します。

```text
Password : bcrypt等でHash化して保存
```

OAuth（Google等）やMagic Link（パスワードレス）はMVP後の検討候補（61条）に留め、今回のScopeには含めません。外部Provider依存を増やさないことを優先します。

---

## 66.9 Signup（招待制）

自己登録を無制限に開放しません。

```text
Admin発行の使い捨て招待コード
        ↓
Signup画面でコード + email + password + 生年月日等を入力
        ↓
コードを使用済みにしてUser作成
```

理由: Email確認（66.10条）を行わないため、無制限の自己登録を許可すると、環境変数で共有しているLLM API Key（26条）の消費コストや濫用に対して脆弱になります。

招待コードの有効期限や特定Emailへの紐付けの有無といった細部は、実装時の判断に委ねます。

最初のAdmin Userは、招待の起点が存在しないため、`ADMIN_EMAIL` / `ADMIN_PASSWORD`のような環境変数からseedスクリプトで作成します（26条のAPI Key管理と同じ、env経由の方式に統一）。

---

## 66.10 Email確認とパスワードリカバリー

Signup時のEmail確認（確認リンク送信）は行いません。生年月日の自己申告ゲート（66.1条）と同じ方針で、Emailアドレスも自己申告として即時信頼し、登録後すぐにアカウントを有効化します。

この結果、メール送信基盤（SMTP等）はMVPのこの段階では一切不要になります。

パスワードを忘れた場合のSelf-serviceリカバリーは今回のScopeに含めません。Adminが管理画面から対象Userへ仮パスワードを発行する形で代替します。

---

## 66.11 Session管理

ログイン後のセッションはhttpOnly Cookie + PostgreSQLの`sessions`テーブル（不透明なトークンをDBで引く方式）で管理します。RedisなどのSessionストアは導入しません（60条）。

```text
Login成功
    ↓
sessionsテーブルへ新規行作成、不透明トークンをhttpOnly Cookieへ
    ↓
以降のRequestはCookie経由でsessionsを引き、User + statusを確認
```

44条のSSE Endpointは`EventSource`がCustom Headerを送れないため、同じCookieベースの認証をそのまま利用します（別途Query Parameterでのトークン受け渡しは不要）。

CSRF対策は、Cookieに`SameSite=Lax` + `Secure`属性を付与することで十分とし、別途のCSRFトークン（Double Submit等）は導入しません。Frontend/Backendが異なるPort（5173 / 3000）でもSame-Siteとして扱われるため、Cross-siteのPOST/PUT/DELETEでCookieが送信されない前提に立ちます。

---

## 66.12 Suspendの効果

AdminによるUser Suspendは以下をすべて即時に行います。

```text
ログイン拒否
+
既存sessionsを全削除（即時ログアウト）
+
投稿・Reply・Quote・Character作成等、一切のWrite操作を拒否
```

Suspend済みUserが過去に投稿したPostは、48条のCharacter削除時の扱いと同様、投稿者情報を含めて保持されます。

Userの自己都合による退会（アカウント削除）は今回のScopeに含めません。AdminのSuspend / Reactivateのみで運用します。

---

## 66.13 Handle共有Namespace

User / Character間でHandleの一意性をDatabase制約で強制するため、共有の`handles`テーブルを新設します。

```text
handles
  handle    (Primary Key)
  ownerType ("user" | "character")
  ownerId
```

User / Characterの作成・Handle変更時には、同一TransactionでこのテーブルへInsert / Updateし、Primary Key制約により衝突を防ぎます。User / Characterそれぞれのドメインモデル自体は分離を維持し（4条）、Handle解決のためだけにこのテーブルを参照します。既存の`Character.handle`列の`@unique`制約は、このテーブルへの参照に置き換えます。

---

## 66.14 既存Seed Characterの扱い

既存の手作りSeed Character（Architect、Skeptic等）の`createdByUserId`はnullのままとし、「System所有」として扱います。

```text
createdByUserId = null → System所有
```

66.5条の「編集・削除は作成者本人と管理者のみ」というルールに、nullはどのUserとも一致しないため自然に従い、実質的にAdminのみが編集・削除可能になります。専用のSystem Userレコードは作成しません。

---

## 66.15 User管理API

50条のCharacter管理画面と同じパターンで、`/api/admin/*`のような別Namespaceを作らず、既存のリソース命名規則に揃えます。

```http
GET  /api/users/management
GET  /api/users/:id
POST /api/users/:id/suspend
POST /api/users/:id/reactivate
POST /api/users/:id/reset-password
GET  /api/users/:id/characters
GET  /api/users/:id/token-usage
```

これらはすべて認証済み + `isAdmin`でガードします。

---

## 66.16 Application Settings（環境変数）のAdmin限定化

既存の`GET / PUT /api/application-settings`（`ApplicationSettingsService`、Frontendの`UserProfileEditor`内`EnvironmentPanel`）は、API Keyの設定有無やLLM挙動の閾値など環境変数由来の設定を確認・編集できる機能です。

Login導入後は、この機能を`isAdmin`のUserのみに限定します。

```text
GET  /api/application-settings   → isAdmin限定
PUT  /api/application-settings   → isAdmin限定
```

非AdminのUserに対しては、User Profile編集画面から`EnvironmentPanel`自体を表示しません。
