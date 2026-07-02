# 08. Project Rules

## Highest priority

Project Bibleを、GlucoScopeの最上位設計書として扱います。

GlucoScopeの作業を始める前、特にその日のタスクを決める前には、必ずProject Bibleを確認します。

## Daily task generation rule

今日のタスクを決めるときは、必ず次の順番で確認します。

1. Project Bibleを確認する。
2. 決めたロードマップを確認する。
3. 前回のタスクと完了状況を確認する。
4. 今日やるべき作業を、ロードマップに沿って整理する。
5. 優先順位を変える場合は、その理由を明確にする。

## Do not jump ahead

実装したい機能があっても、ロードマップ上の順番を確認します。

たとえばLiveタブの進化は重要ですが、現在のロードマップではMedical & AI Principles、SAFETY.md、Aboutページ整備の後に位置づけます。

優先順位を変える場合は、次のように扱います。

- なぜ変えるのか
- 何を後回しにするのか
- 安全性や公開準備に影響しないか
- 一時的な寄り道なのか、正式なロードマップ変更なのか

## Documentation rule

会話でFixした内容は、できるだけProject Bibleへ反映します。

長期記憶は補助として扱い、正式な正本はリポジトリ内のMarkdownに残します。

## Language rule

- 「患者」ではなく、「糖尿病とともに生きる人」「あなた」を使う。
- 「糖尿病管理」より、「血糖マネジメント」を使う。
- 血糖データを、評価や反省の材料ではなく、理解と振り返りのための手がかりとして扱う。
- ユーザーを責めない。怖がらせない。急かさない。

## Safety rule

GlucoScopeは医療機器ではありません。
診断、治療判断、インスリン量の指示は行いません。

AIは判断を置き換えるものではなく、理解を支えるものとして扱います。

## Public readiness rule

GlucoScopeは、安心して人に見せられる形を優先して育てます。

公開前後で重視するもの：

- About page
- Medical & AI Principles
- SAFETY.md
- Privacy Notes
- Data Integration Principles
- Support Policy
