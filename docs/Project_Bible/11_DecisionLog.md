# 11. Decision Log

## Adopted: Data Integration Principles

Data Integration Principlesは採用済み。

主な決定：

- 初期戦略はNightscoutベース。
- Nightscout専用に固定せず、adapter-based designを採用する。
- 最初のadapterはNightscout Adapter。
- 初期段階で、他ユーザー全員分の血糖データをKazuma個人のクラウドに預かる構成は避ける。
- 利用者は、可能な限り自分自身のアカウントや環境でデータ基盤を構築・管理する。
- Beginner向けドキュメントには、Azure setup、cost monitoring、budget alerts、stopping/deleting resourcesを含める。
- クラウド費用が必ず無料とは約束しない。
- MiniMed 780G / GuardianMonitor / Nightscout、Dexcom G7、Libre 2 / LibreLinkUp、Gluroo、CSV、manual importを段階的に検討する。
- 外部アプリ依存リスクを明記する。

## Adopted: Project Bible first

GlucoScopeの作業前には、必ずProject Bibleを確認する。

タスク生成前の確認順：

1. Project Bible
2. Roadmap
3. Previous task and status
4. Today’s task
5. Reason for any priority change

## Adopted: gluco positioning

glucoはGlucoScope公式AIパートナー。

グルコは、糖尿病とともに生きるあなたのそばにいる、やさしい小さなともだち。

グルコは医療判断を行わず、血糖データを一緒にやさしく振り返る存在として扱う。

## Adopted: Public direction

GlucoScopeは、安心して人に見せられる形を優先して育てる。

About、Medical & AI Principles、SAFETY.md、Privacy Notes、Data Integration Principlesを重視する。

## Adopted: Sustainability direction

GlucoScopeが続いていくこと自体も、糖尿病とともに生きる人にとっての価値と考える。

収益化を検討する場合は、倫理的で持続可能な形を優先する。
