<!--
このテンプレートは CONTRIBUTE.md の「Pull Request」節に対応しています。
該当しない節とこのコメントは削除してかまいません。
-->

## 何を変更したか

<!--
変更が複数レイヤーにまたがる場合は、schema / repository / service / seed /
shared のように層で分けて書くとレビューしやすくなります。
-->

## なぜ必要か

## 仕様上の判断と代替案

<!--
検討した代替案と、それを選ばなかった理由。
既存の設計判断（CLAUDE.md、ARCHITECTURE.md、設定ファイルのコメントなど）を
根拠にした場合は、その参照元を示してください。
-->

## 影響範囲

<!-- 該当するものだけ残してください -->

- **DB**: schema 変更、migration、既存データへの影響、nullability、削除時の挙動
- **環境変数**: 追加・変更・削除
- **API 互換性**: 破壊的変更の有無、Public/User/Admin/Owner 境界と 401/403
- **UI**: 画像または操作手順

## 実行したテストと結果

```shell
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

<!--
ブラウザが必要な確認項目は CONTRIBUTE.md の「手動検証チェックリスト」を参照し、
実施した項目と結果を記載してください。

DB なし環境では一部の backend テストが `@prisma/client did not initialize yet`
でロードに失敗します。`pnpm --filter @brickr/backend db:generate` を先に実行してください。
-->

## 未対応事項・既知の制約

## チェックリスト

- [ ] 変更範囲が一つの目的にまとまっている
- [ ] 新しい挙動にテストがある
- [ ] `pnpm lint` が成功する
- [ ] `pnpm test` が成功する
- [ ] `pnpm typecheck` が成功する
- [ ] `pnpm build` が成功する
- [ ] APIキー、Password、Session/Invite Code、個人情報、生成された `.env` を含んでいない
- [ ] 新規Endpointの Public/User/Admin/Owner 境界と 401/403 を検証した
- [ ] 必要な README、CLAUDE.md、ARCHITECTURE.md を更新した
- [ ] UI で Bootstrap Icons と Theme Token を使用した
- [ ] 失敗時に他の処理を不必要に停止させない
