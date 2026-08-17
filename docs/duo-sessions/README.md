# Duo セッションログ

GitLab Duo Agent Platform のセッション（Duo Workflow）を定期的に振り返り、その要約と
得られた知見をリポジトリに残すための場所です。

## なぜ必要か

Duo のセッション履歴は永続的ではありません。

- Agent Platform のセッションは保持ポリシーにより `archived` になる
- Duo Chat の会話は**非アクティブ 30 日で自動削除**される

何もしなければ、エージェントがどこで詰まり、何が上手くいったのかという情報は消えます。
それを定期的に吸い出して残すのがこのディレクトリの役割です。

## 2 層構成

知見は 2 つの層に分けて扱います。

| 層 | 置き場所 | 役割 |
|----|----------|------|
| **生ログ層** | `docs/duo-sessions/YYYY-MM-DD.md` | その期間のセッションで何が起きたかの記録。読み返し用。 |
| **蒸留層** | `CLAUDE.md`、`.agents/skills/*/SKILL.md` | 生ログから繰り返し現れたパターンだけを恒久ルールへ昇格。 |

生ログを貯めるだけでは読み返されません。**生産性が上がるのは蒸留層への還流**です。
振り返りのたびに「これは次回も起きるか？」を問い、Yes なら蒸留層に書きます。

## 運用サイクル

週 1 回、または大きめの機能が一区切りしたタイミングで実施します。

1. セッション一覧を取得し、まだ振り返っていないものを洗い出す（下記コマンド）
2. `developer/v1` など実装を伴うセッションを優先して中身を確認する
3. `TEMPLATE.md` をコピーして `YYYY-MM-DD.md` を作成し、記入する
4. 繰り返し現れた摩擦を `CLAUDE.md` / `SKILL.md` に反映する
5. 本 README の索引に 1 行追加し、MR を出す

## セッション一覧の取得

プロジェクト全体（全ユーザー、リモートフローのみ）を対象にする場合:

```shell
glab api graphql -f query='
query {
  project(fullPath: "gl-demo-ultimate-aaizawa/brickr") {
    duoWorkflowWorkflows(first: 50) {
      nodes { id goal agentName workflowDefinition createdAt updatedAt archived }
    }
  }
}' | jq '.data.project.duoWorkflowWorkflows.nodes'
```

自分のセッションだけに絞る場合は、トップレベルの `duoWorkflowWorkflows` を使います。

```shell
glab api graphql -f query='
query {
  duoWorkflowWorkflows(projectPath: "gl-demo-ultimate-aaizawa/brickr", first: 50) {
    nodes { id goal workflowDefinition createdAt updatedAt archived }
  }
}' | jq '.data.duoWorkflowWorkflows.nodes'
```

`updatedAfter` で期間を絞り込めます。`type` / `excludeTypes` で `code_review/v1` を
除外すると、実装セッションだけを取り出せます。

利用可能なフィールドは introspection で確認できます。

```shell
glab api graphql -f query='
query { __type(name: "DuoWorkflow") { fields { name } } }' \
  | jq -r '.data.__type.fields[].name'
```

個々のセッションの中身は、GraphQL の ID 末尾の数値（例 `.../Workflow/6422073` なら
`6422073`）を Duo Chat に渡して「セッション 6422073 を要約して」と依頼するのが最も手軽です。

## 索引

| 期間 | セッション数 | 主なトピック |
|------|-------------|-------------|
| [2026-08-17](2026-08-17.md) | 20 | Phase 5/6 リストラクチャリング、Feed room の scope 導入、品質テスト追加 |
