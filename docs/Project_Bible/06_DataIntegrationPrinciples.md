# 06. Data Integration Principles

Status: Adopted

## Purpose

GlucoScopeは、糖尿病データ基盤に詳しい人だけのためのものではありません。

血糖データの連携経路は複雑です。
Nightscout、MiniMed、GuardianMonitor、Libre、Dexcom、Gluroo、CSV、クラウド環境など、多くの選択肢があります。

GlucoScopeは、その複雑さをそのまま利用者に押しつけず、分かりやすく、安全で、安心できる形に整理することを目指します。

## Initial strategy

初期段階では、Nightscoutベースのデータ連携を中心にします。

ただし、GlucoScopeはNightscout専用アプリとして固定しません。
将来的に複数のデータソースを追加できるように、adapter-based designを採用します。

最初の実装は、Nightscout Adapterを中心に進めます。

## Data source levels

接続レベルは、利用者のITスキルや自己構築の必要度に応じて3段階に分けます。

### Level 1: Beginner / Supported setup

初心者向け。できるだけ分かりやすく、手順を丁寧に案内する。

含めるべき内容：

- Nightscout / Azure setup
- database / web app setup
- cost monitoring
- budget alerts
- stopping / deleting resources

クラウド費用について、「必ず無料」とは約束しません。

### Level 2: Intermediate / Guided documentation

ある程度ITに慣れている人向け。
ドキュメントを見ながら、自分で構築・接続できることを想定します。

### Level 3: Advanced / Connection-only

Nightscout互換URLなど、すでに環境を持っている人向け。
GlucoScopeは接続先として利用します。

## Hosting principle

初期のGlucoScopeでは、他の利用者全員分の血糖データを、Kazuma個人のクラウドに預かる構成は避けます。

利用者は、可能な限り自分自身のアカウントや環境でデータ基盤を構築・管理する形を基本とします。

これは、プライバシー、コスト、責任範囲、安全性のためです。

## Supported and future data paths

段階的に検討するデータ連携経路は次の通りです。

- MiniMed 780G + Guardian 4 + GuardianMonitor + Nightscout
- Nightscout-compatible URLs
- Dexcom G7
- Libre 2 / LibreLinkUp
- Gluroo経由の連携
- CSV import
- Manual import

## Adapter-based design

GlucoScopeの内部設計では、データソースごとにadapterを分けます。

最初のadapterはNightscout Adapterとします。

将来的には次のような構成を目指します。

- Nightscout Adapter
- Libre Adapter
- Dexcom Adapter
- Gluroo Adapter
- CSV Adapter
- Manual Entry Adapter

## External dependency risk

GlucoScopeは、外部アプリや外部APIに依存する場合があります。

そのため、次のリスクを正直に扱います。

- 外部アプリの仕様変更
- API制限
- 認証方式の変更
- データ遅延
- データ欠落
- サービス停止
- クラウド費用の変動

GlucoScopeは、これらのリスクを隠さず、利用者に分かりやすく伝えます。

## User safety and clarity

データ連携の失敗や遅延があっても、利用者を不安にさせすぎない表示を行います。

例：

- 新しい血糖データを待っているよ。
- Nightscoutとの接続を確認中だよ。
- データが少ないため、今日の振り返りは控えめに表示しています。

避ける表現：

- Error
- Failed
- Invalid
- No data

必要な技術情報は開発者向けに残しつつ、利用者向けUIではやさしい表現を優先します。
