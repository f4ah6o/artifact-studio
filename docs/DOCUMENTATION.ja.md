# ドキュメント運用方針

[English](DOCUMENTATION.md)

## 各配置場所の役割

- `README.md` / `README.ja.md`: 現在のコードベースから確認できる、利用者向けの現行機能だけを書く。
- `docs/`: 保守対象のarchitecture、運用、compatibility、implementation documentationを書く。
- `issues/open/`: 未実装のproposal、設計判断、scopeを切った作業項目を書く。
- `issues/closed/`: completion evidence と実装revisionを伴う完了済み作業を置く。
- `THIRD-PARTY-NOTICES.md`: upstream attribution と dependency license 情報を集約する。

README を roadmap にしない。将来構想、過去の設計議論、古くなったbenchmark、third-party license一覧をREADMEへ蓄積しない。

## 英語版と日本語版

新規作成する、または実質的に更新する保守対象の人間向けドキュメントは、同じbasenameで英語版と日本語版をペアにする。

```text
docs/FEATURE.md
docs/FEATURE.ja.md
```

root READMEも同じ方針とする。

```text
README.md
README.ja.md
```

保守対象ドキュメントを実質的に変更する場合は、同じ変更で両言語版を更新する。日本語版でも、識別子、command、API名、code上の用語など、翻訳すると精度が落ちる技術用語は英語のまま使ってよい。

`docs/superpowers/specs/` などのhistorical design recordはsnapshotとして扱い、再び保守対象にしない限りretroactiveな翻訳は必須としない。

## 設計から実装まで

1. 非自明な将来設計は `issues/open/` または保守対象の `docs/` に書く。
2. READMEには実装済みbehaviorだけを書く。
3. 実装して検証する。
4. 保守対象の英語版・日本語版を同時に更新する。
5. 完了したissueは `issues/closed/` へ移し、completion evidenceを残す。実装済みの作業を `issues/open/` に残さない。
