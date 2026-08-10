# CLAUDE.md

# Enjo Simulator / 炎上シミュレータ

## 1. Project Overview

「炎上シミュレータ」は、Twitter/X風のSNS UI上で、ユーザーの投稿に対して複数のAIキャラクターが、それぞれに与えられた性格・立場・口調に基づいて様々な投稿を行う様子を観察するためのWebアプリケーションです。

主目的は、

```text
同じ投稿を見た複数のAIキャラクターが、
それぞれ異なる人格に基づいて、
どのように違う反応や会話を生成するかを見ること
```

です。

炎上の正確な再現、実社会のSNS予測、リスク評価などはMVPの目的ではありません。

「炎上シミュレータ」という名称ですが、MVPではまず、

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
enjo-simulator/
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
- Light / Dark mode切り替え

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

---

# 49. Composer

Composerでは以下を可能にします。

- Text入力
- @mention
- Post

Example:

```text
What's happening?

@skeptic この企画どう思う？

[Select responders]

                        [Post]
```

MVPでは画像投稿は必須ではありません。

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

ホームでは投稿Composerの上にUser ProfileをCharacter Profileと同じ形式で表示します。
UserはdisplayName、description、avatarを編集できます。識別子`you`とhandle`@you`は固定です。

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
28. Light / Dark mode切り替え
29. User Profile表示・編集

---

# 60. MVP Does NOT Need

MVPでは以下を実装しないでください。

- Like
- Risk Score
- Risk Analysis
- Sentiment Analysis
- Marketing Review
- Social Media Risk Prediction
- Image Upload
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
- Image Post
- Conversation Visualization
- Provider / Model切替UI

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
