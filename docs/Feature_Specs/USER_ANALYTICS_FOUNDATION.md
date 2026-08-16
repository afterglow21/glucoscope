# GlucoScope 利用者設定・利用分析基盤

Status: Phase 1A implemented / core CGM handoff accepted / Phase 1B usage lifecycle device-accepted and enabled for 1–3 person early access / personal-user AI published for early access / administrator dashboard accepted for one administrator

Last reviewed: 2026-08-15

Canonical product principles: `docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md`

## 1. 目的

GlucoScopeを何人が、どの機能をどのくらい使っているかを、運営と改善に必要な範囲で理解できる基盤を準備する。

この基盤は、人を評価したり、血糖マネジメントを採点したりするためのものではない。表示名や利用回数から、治療状況、努力、生活習慣を推測しない。

## 2. 固定する実装順

1. 利用者設定・最小限の利用分析基盤
2. 認証された管理者ダッシュボード
3. Plus 30日パスと任意の開発支援への導線
4. ユーザー展開開始後の、横向きグラフ限定の常時表示モード

この文書は1番の設計から始まった。2番の管理者ダッシュボードは、その境界を変えない専用Workerとして実装し、Cloudflare AccessとWorker内の二重検証により管理者1名で受け入れを完了した。結果は21節へ記録する。決済と常時表示は引き続き別工程とする。

## 3. Phase 1A: 完了済みの端末内プレビュー（履歴）

Phase 1Aでは、「あなたの設定」から任意の表示名だけをブラウザのlocalStorageへ保存できる画面を実装した。この画面はPhase 1Aの受け入れ確認に使った履歴であり、現在のPhase 1Bでは、自分の血糖データを新しくつなぐフォームへ表示名入力を統合し、空欄を許可しない。公開デモを見るだけの場合は表示名を求めない。

保存キーは `glucoscope.localProfile.v1` とする。保存JSONは次の2項目だけを許可する。

```json
{
  "schemaVersion": 1,
  "displayName": "グルコさん"
}
```

Phase 1Aの画面では表示名の空欄を許可し、前後と連続空白、制御文字、双方向制御文字を整理して最大30 Unicodeコードポイントとしていた。

Phase 1Aでは利用者IDを生成しなかった。既存の `glucoscope.visitorSeed.v1` は現在もグルコ表示の抽選用であり、利用者IDへ流用、送信、管理者表示しない。

## 4. 利用分析は分かりやすく案内し、いつでも止められる

表示名の保存は、利用状況収集の許可操作ではない。将来、アクセス回数などの最小限の利用状況を記録する場合は、収集開始前に少なくとも次を分かりやすく案内する。

- 集める項目と数え方
- 利用目的
- 管理者に見える内容
- 保存期間
- 訂正、書き出し、停止、削除の方法
- 外部サービスと処理場所

設定からいつでも収集を止められ、停止しても血糖表示などの基本機能は変わらないようにする。血糖・健康データの取得や保存、本人データの公開共有、その他の機微な用途には、別途明示的な同意を求める。

2026年8月14日に公開したユーザー版AIでは、この別境界を、現在の案内Versionで初めてAI分析を使う直前の短い明示確認として実装する。利用プロフィール作成の案内やGluroo限定中継の確認とは統合しない。「今はしない」を選んだ場合はAIへ送らず、通常のCGM表示、ブラウザ内のいつものグルコのお話、ChatGPTコピーを止めない。

## 5. Phase 1Aの通信境界

表示、読込、保存、変更、削除のすべてをブラウザ内だけで行う。

- `fetch`、`sendBeacon`、XHR、WebSocketを使わない
- Worker、Durable Objects、D1、KVへ送らない
- URL、query、hash、ログ、エラー文へ入れない
- Cookieや端末識別子を作らない
- 保存できない場合も通信へフォールバックしない
- 削除はこの保存キーだけを `removeItem` し、`localStorage.clear()` を使わない

任意の表示名を保存したことだけを理由に、公開Cloudflare Web Analyticsを停止または再開しない。ユーザーモード中、接続情報保存中、保存状態を安全に確認できない場合にWeb Analyticsを止める既存境界は維持する。bearer credentialを含む端末プロフィールキーが存在する間も、第三者スクリプトと同じページで共存させないためWeb Analyticsを停止する。

## 6. 利用分析へ入れない情報

次の情報は、将来のイベント名、本文、D1、ログ、URL、書き出し、管理者画面にも入れない。

- 血糖値、測定時刻、方向、アラート、グラフ
- TIR、TAR、TBR、平均、CV、GMI、GlucoScore
- CGMの種類・機種
- AIへ渡す内容、AIお手紙本文、分析期間・モード、ChatGPTコピー内容
- Nightscout / Gluroo URL、Secret、token、限定中継チケット、接続先
- Apple、Google、CGMメーカー等の認証情報やアカウント識別子
- インスリン、食事、薬、症状、治療、機器設定
- 正確な位置、IPアドレス、raw User-Agent、fingerprint、外部referrer、query文字列
- 決済額、カード情報、決済事業者のpayload

これらを利用状況のrequest body、アプリログ、D1へ入れない。HTTP通信そのものではCloudflareが転送・安全対策に必要なネットワーク情報をCloudflare自身の方針に基づいて処理し得るため、「Cloudflareにも届かない」とは案内しない。Usage WorkerはIPアドレス、raw User-Agent、referrerを読み取り・アプリログ記録・D1保存しない。

## 7. 将来数えてよい最小候補

分かりやすい説明、利用者が止められる設定、必要な管理基盤が整った後、次の回数だけを候補とする。

- 日単位の訪問回数
- 新しいAI分析が正常に生成された回数
- 現在集まっている異なるグルコの想い出の数

保存済みAI結果の再表示、失敗した生成、ボタンを押しただけの操作、ChatGPT用文章のコピーは「AI分析成功」に数えない。健康状態が推測できるタブ操作や期間選択は記録しない。

## 8. Phase 1Aからサーバー基盤へ進むゲート

Phase 1Aの端末内表示名だけの段階では、D1や利用者別APIを作成・デプロイしない。Phase 1Bでは、ログイン不要の早い公開に限定して「人のアカウント」ではなく「このブラウザの端末プロフィール」を使う別設計を承認した。Plus、決済、本人確認、端末横断の復旧には流用しない。

Phase 1BのD1とAPIは、次を満たした後にだけ停止状態から有効化する。

- server-generatedの不透明なprofile IDと256-bit bearer token（D1はtoken hashだけを保存）
- 説明版と分析停止設定の記録
- 分析停止中は新しい利用イベントを書き込まないゲート
- 他人の情報を読めない所有者チェック
- 監督下のPhase 1B受け入れではCloudflareアカウント認証済みD1 consoleとD1内viewだけを使い、HTTP管理APIを作らない。継続利用する専用管理画面はその後に別Workerとして実装し、Cloudflare AccessとWorker内の二重検証により管理者1名で受け入れを完了した。公開サイトからはリンクしない
- 重複加算を防ぐ短期idempotency
- 日別データの90日ローリング削除
- 本人による表示名訂正、allowlist書き出し、端末プロフィール削除
- 稼働DBからの即時cascade削除と、復旧スナップショット残存期間の公開

Cloudflare公式仕様を2026-08-11に再確認した。D1 Time Travelは常時有効で、稼働DBから削除後もFreeプランでは最長7日、Paidプランでは最長30日、復旧可能な履歴に残る場合がある。公開文面では最大30日の残存可能性とプラン別期間を案内する。

将来、血糖・健康データや本人データの公開共有を扱う設計へ変更する場合は、この最小限利用分析とは分けて、明示同意を含む別の安全設計を行う。

## 9. 管理者、任意支援、Plusの分離

既存のUsage DashboardはAI Worker全体の運用カウンターであり、専用の利用者別管理者ダッシュボードではない。利用者別画面はCloudflare AccessとWorker内検証を必須とする読取専用画面であり、運営と改善に必要な表示名、説明済みの最小限の回数、収集停止状態だけを見せる。管理者1名で受け入れ済みだが、公開サイトからはリンクしない。

任意の開発支援は機能特典のない支援であり、利用分析へ自動的に結びつけない。本人が別途アカウント連携を明示しない限り、誰が支援したかをプロフィールと紐付けない。

Plus 30日パスの利用権は、購入した機能を提供するための別領域として扱う。決済情報や金額を利用分析へ混ぜない。

## 10. Phase 1Aで確認済みの受け入れ条件（履歴）

次は端末内プレビューを完了した時点の確認項目である。現在のPhase 1Bの新規データ接続では表示名を必須とし、表示名だけを削除する独立操作は設けない。現行の条件は12節を正とする。

- 初回は表示名が空
- 空欄のまま保存すると表示名の保存キーを残さず、再度開いても空欄へ戻る
- 表示名を変更して上書きできる
- 削除前に範囲を確認し、削除後は空欄へ戻る
- 接続情報、限定中継同意、AIキャッシュ、グルコの想い出を変更しない
- 接続削除もローカルプロフィールを変更しない
- すべてのプロフィール操作でネットワーク要求が0件
- 表示名の保存または削除だけではWeb AnalyticsやWorkerを停止・開始しない
- 保存領域が使えない時は、送信していないことを伝えて安全に失敗する
- 日本語・英語の切替で入力内容を失わない
- ダイアログは初期フォーカス、Tab移動、Escape、背景タップ、元のボタンへのフォーカス復帰に対応する
- 一般利用者向け限定中継は停止状態のまま。Secret、Worker、Cloudflare設定を変更しない

## 11. Phase 1A完了後に残るもの

次はPhase 1A完了時点で残っていた項目の履歴である。

- アカウント作成・ログイン・本人確認・復旧
- 人を端末横断で識別する利用者ID
- 利用者一覧と利用者別集計
- 認証された管理者ダッシュボード
- 支援との明示連携
- Plus 30日パス

Phase 1Bの端末プロフィール、D1、API、開始・停止、書き出し、サーバー削除は別設計として実装済みであり、この歴史的な未完了一覧には含めない。利用者別管理者ダッシュボードも、その後に専用Worker、Cloudflare Access、Worker内の二重検証を使って管理者1名で受け入れを完了した。その他の残作業は別の実装判断と、必要な場合はCloudflare変更前の明示確認を挟む。

## 12. Phase 1B: 端末プロフィールのopt-in実装

早いユーザー公開と将来の利用者別集計を両立するため、最初からアカウント作成やログインを求めず、ブラウザごとの「端末プロフィール」を使う。これは人を一意に表すアカウントではない。同じ人が2台の端末で使うと2件として見え、ブラウザの保存データを消した場合は別端末へ復旧・統合できない。Plus利用権、決済、本人確認には流用しない。

iPhoneのSafari、Instagram等のアプリ内ブラウザ、ホーム画面Webアプリは保存領域が同じとは限らない。接続URLや合言葉をUsageへ保存・照合して同一人物判定を行うことは禁止する。2026-08-16以降の標準導線では、アプリ内ブラウザとSafari以外のiPhoneブラウザから接続を始めず、Safariでは先にホーム画面へ追加してからアイコン内で初回接続する。Safariでそのまま接続する明示的な代替経路では、検証済みCGM接続を許可する一方、新しい任意Usage端末プロフィールは作成しない。iPhoneではホーム画面アプリ内だけを新規Usage登録場所とし、Safariとホーム画面で同名profileが二重に作られる典型経路を防ぐ。既存の同名profileは同一人物と断定して自動統合・合算しない。

公開デモを見るだけの人には、表示名や端末プロフィールを求めない。自分の血糖データを新しくつなぐフォームでは表示名を必須にするが、本名は不要とする。接続確認後の `GlucoScopeを始める` 操作に端末プロフィール作成を統合し、利用状況共有だけの大きな独立パネルは設けない。

開始前には、次の短い案内とPrivacy Notesへの `詳しく` リンクを示す。

> 表示名と基本的な利用回数を、GlucoScopeをよくするために記録します。血糖値や接続情報は記録しません。

法律文書のようなチェックボックスは追加しない。Gluroo限定中継の確認は、接続先情報をCloudflareで一時処理する別の境界として維持し、この利用プロフィール案内へ混ぜない。端末プロフィール作成の直前だけTurnstileを表示し、actionは `glucoscope-usage-profile` とする。

利用プロフィール用TurnstileまたはUsage Workerだけが失敗した場合は、検証済みのCGM接続を止めない。必須表示名と接続情報をブラウザへ保存してユーザーモードを開始し、利用プロフィールは未登録・利用記録OFFのままとする。Gluroo限定中継そのものの説明、Turnstile、長期端末セッション、接続先検証はこのfail-open境界へ含めず、従来どおりfail-closedを維持する。ブラウザへの表示名または接続情報の保存に失敗した場合も、接続成功扱いにしない。

Phase 1Bで扱ってよいのは次だけとする。

- 表示名（新しい個人データ接続では必須、本名は不要）
- 1日につき最大1回の利用日
- 新しく正常に完了したAI分析の回数
- 通常のグルコの想い出 No.1〜50 の現在数

AI分析は、OpenAIから新しく正常に生成され、`generation.complete=true` で、共有・端末キャッシュ・stale fallbackではない応答だけを候補とする。公開済みユーザーモードでは、この条件を満たす新規成功だけを利用回数へ送る。

グルコの想い出は、血糖状態から影響を受け得るLucky Gluco No.51〜70と、最新値100 mg/dLをきっかけにするUnicorn Glucoを必ず除外する。ID、初めて出会った日、出会った回数も送らず、No.1〜50の異なる件数を0〜50の整数で送る。

端末内の識別情報は `glucoscope.usageProfile.v1` へ分離する。既存の `glucoscope.localProfile.v1` と `local-profile.js` はネットワークを使わないPhase 1A境界を維持する。サーバーが作る不透明なprofile IDとbearer tokenはURL、query、hash、ログへ入れず、サーバーではtokenのhashだけを保存する。`glucoscope.usageProfile.v1` が存在するページでは公開Cloudflare Web Analyticsを読み込まず、任意表示名だけの `glucoscope.localProfile.v1` は停止条件にしない。

通常UIには、利用記録の停止・再開と、サーバー上の端末プロフィール・利用記録の削除だけを小さな管理導線として置く。allowlist JSON書き出しは同じ場所の小さな補助リンクとする。停止または削除を押した時は、通信結果を待たず端末側を先に停止し、pending AI eventも消して新しい利用イベントを送らない。サーバー削除が成功するまでは端末tokenを残し、成功後だけ利用プロフィール用キーを削除する。端末内の表示名、データ接続、血糖データ、AIキャッシュ、グルコの想い出は連動して削除しない。一方、これとは別の「保存したデータ接続を削除」操作では、公開済みユーザー版AIの端末内AIキャッシュと保存済みAI確認も削除する。利用プロフィールだけの削除と、データ接続削除の範囲を混同しない。

日別集計は90日ローリングとし、90日利用のない端末プロフィールも削除候補とする。稼働DBから削除した後もCloudflare D1のTime Travel復旧履歴に、Freeプランでは最長7日、Paidプランでは最長30日残る場合があることをPrivacy Notesへ日英で明記する。

停止版では `USAGE_PROFILE_ENABLED=false` とし、同じ値をindexのusage-profile meta gateにも反映した。監督下の一時受け入れ版では両方を `true` にし、端末プロフィールを作れるメインページでは登録前からCloudflare Web Analyticsを読み込まない。`true` でも未登録ブラウザの初期化、訪問記録、想い出同期は通信・保存を行わず、本人が開始ボタンを押してTurnstileを完了した時だけprofileを作る。D1作成、database ID反映、migration、Secret登録、停止Worker deployは、項目を明示した事前承認の範囲で2026-08-11に完了した。

### Phase 1Bの受け入れ条件

- disabled状態では初期化、表示名保存、再読込、利用日・想い出同期で通信が0件
- 公開デモは表示名なしで開ける
- 新しい個人データ接続では本名でなくてよい表示名を必須にし、`GlucoScopeを始める` 操作でprofileを作る
- 開始前には固定した短い案内と `詳しく` リンクを示し、開始時だけTurnstileを使う
- 利用プロフィール用TurnstileまたはUsage Workerの失敗だけでは検証済みCGM接続を止めず、利用プロフィールを未登録・利用記録OFFのまま開始する
- Gluroo限定中継の確認は別境界として維持する
- 通常UIは停止・再開・削除の小さな管理導線とし、書き出しは補助リンクにする
- 同じ端末の再読込で新しいprofileを作らず、利用日は同日1回だけ
- AIのキャッシュ、fallback、失敗、ボタン押下だけでは加算しない
- 想い出はNo.1〜50の件数だけで、No.51〜70とUnicornを送らない
- 停止中は新しいイベントを送信せず、血糖表示等は変わらない
- 書き出しは本人のallowlist項目だけで、別profileを取得できない
- 停止・削除の通信失敗時も端末側を先に停止し、tokenを保持して再試行できる。成功時だけserver profileと利用記録をcascade削除する
- 管理者一覧を公開APIにせず、認証された管理者経路だけに限定する
- 一般利用者向け限定中継の `RELAY_ENABLED=false` を変更しない

## 13. 2026-08-11 停止状態の本番基盤確認

項目を明示した事前承認の範囲で、収集を開始せずに次を完了した。

- APACにD1 `glucoscope-usage` を作成し、`0001_initial_usage_schema.sql` を適用
- `profiles`、`usage_daily`、`event_receipts` の各テーブルと `admin_device_usage` viewが存在することを確認
- 確認時点で上記3テーブルとviewはすべて0件
- `TURNSTILE_SECRET_KEY` というSecret名をWorkerへ登録（値は記録・表示・Git追加していない）
- `https://glucoscope-usage.afterglow21.workers.dev` へ停止状態で正式設定をデプロイ
- その確認時点のVersion IDは `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf`
- 許可Originのpreflightは`204`、profile作成とevents送信は停止中の`503`、不許可OriginとOriginなしは`403`
- `workers_dev=true`、`preview_urls=false`、`observability.enabled=false`、`observability.logs.invocation_logs=false`
- Worker側 `USAGE_COLLECTION_ENABLED=false`、フロント側 `USAGE_PROFILE_ENABLED=false`、一般利用者向け限定中継 `RELAY_ENABLED=false` を維持

これは停止した本番の器と境界の確認であり、利用状況の収集開始、フロント接続、Friends & Family展開の承認ではない。収集有効化は、公開案内、Cloudflareの復旧履歴、開始・停止・書き出し・削除、90日保存の最終確認後に、別の明示承認を必要とする。

## 14. Phase 1B 監督下実機確認と停止（2026-08-12 JST）

別の明示承認後、Usage Workerは修正版Version `858cf438-b3d2-4a8c-801c-344503e0c58e`へ通信の100%を向け、runtimeの `USAGE_COLLECTION_ENABLED=true` で監督下の一時受け入れを開始した。Gitに保存する `wrangler.jsonc` は `false` のままとし、停止Version `3c2c3d19-3744-4d01-8e62-76a0f1bdd5bf` をその時点のrollback先として維持した。一般利用者向け限定中継の `RELAY_ENABLED=false` は変更していない。

最初の有効候補では、正しいJSONのダミー要求がSiteverify通信の互換性問題により `503 turnstile_unavailable` となったため、D1が0件であることを確認して停止Versionへ戻した。Turnstile要求を、既存リレーで実機確認済みの `URLSearchParams` と `application/x-www-form-urlencoded` へ揃え、`redirect`指定を除去し、専用テストを17件へ拡張してから修正版を再デプロイした。

修正版では、許可Originのpreflight `204`、不許可OriginとOriginなしの `403 origin_not_allowed`、許可Originからの無効ダミーtokenの `403 turnstile_failed`、`Cache-Control: no-store`、`Vary: Origin` を確認した。続く実機確認では最初のプロフィール作成と日別記録に成功したが、成功後のTurnstile resetでcallbackが再実行され、成功済みなのにエラーを表示した。この時点ではD1に試験用profile 2件と日別記録2件が残り、Usage Workerの収集とフロントの開始画面を停止へ戻した。一般利用者向け限定中継も `RELAY_ENABLED=false` のまま維持した。

再callbackを防ぐガード、大きな共有パネルを廃止した新しいデータ接続フロー、表示名とプロフィール作成の統合はローカル実装済みである。この時点では、開始・停止・再開・削除と補助リンクからの書き出しを監督下で再確認するまで、Workerとフロントを停止したままにする判断とした。

## 15. 試験記録削除と新しい停止Version（2026-08-12 JST）

既知の試験用profile 2件を削除し、cascade削除後に `profiles`、`usage_daily`、`event_receipts` が `0 / 0 / 0` であることを確認した。続いて、新しい停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` をdeployment `25be2258-b72a-4e2c-8bf1-ab47781c48dc` で本番通信の100%へ反映した。

runtimeの `USAGE_COLLECTION_ENABLED=false`、許可Originのpreflight `204`、許可Originからのprofile `POST` が `503 usage_collection_paused`、不許可OriginとOriginなしが `403` であることを確認した。デプロイ後もD1の3テーブルは `0 / 0 / 0` のままである。一般利用者向け限定中継は独立して `RELAY_ENABLED=false` を維持している。

## 16. 監督下の再受け入れと停止（2026-08-12 JST）

別の明示確認後、active Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` へ本番通信の100%を向け、runtimeの `USAGE_COLLECTION_ENABLED=true` で監督下の一時受け入れを再開した。同じ公開候補でフロントの `USAGE_PROFILE_ENABLED` とusage-profile meta gateを `true` にし、公開デモを見るだけでは表示名やprofileを求めず、自分のデータを新しくつなぐ時だけ本名でなくてよい表示名を必須にする。

許可Originのpreflight `204`、許可Originからの無効なダミーTurnstile tokenが `403 turnstile_failed`、不許可OriginとOriginなしが `403` であることを確認した。この境界確認後も `profiles`、`usage_daily`、`event_receipts` は `0 / 0 / 0` である。Gitに保存する `wrangler.jsonc` は `USAGE_COLLECTION_ENABLED=false` のまま維持し、停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` とdeployment `25be2258-b72a-4e2c-8bf1-ab47781c48dc` を直前のclean stopped checkpoint兼rollback先として残す。一般利用者向け限定中継も独立して `RELAY_ENABLED=false` を維持する。

この一時有効化では、再callbackによる誤エラーが起きないprofile作成、停止、再開、削除、補助リンクからのallowlist書き出しを、利用者が管理する1台の端末で確認する。Usage Workerまたは利用プロフィールだけの失敗は確認済みCGM接続を止めず、Gluroo限定中継の安全確認、接続先検証、ブラウザ保存成功は引き続きfail-closedとする。

実機では接続確認まで成功した。しかし「GlucoScopeを始める」を押すとTurnstileが短く表示された後、データ接続画面へ戻った。直後のD1確認では `profiles`、`usage_daily`、`event_receipts` は `0 / 0 / 0` のままで、利用プロフィールは作成されていなかった。

異常時の停止手順に従い、停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` をdeployment `06aa2dbe-454b-45b8-859a-d8e5b9741a82` で本番通信の100%へ戻した。Usage Workerは再び `USAGE_COLLECTION_ENABLED=false` である。公開フロントはこの確認時点で一時受け入れ版のgateが `true` のままだが、停止Workerは新しいprofile作成を受け付けない。Gitに保存するWorker設定の `false` と、一般利用者向け限定中継の `RELAY_ENABLED=false` は変更していない。

接続設定のブラウザ保存を中核処理として堅牢にし、表示名だけの保存失敗をbest-effortとして扱う修正と、利用プロフィール作成に上限時間を設ける修正を、Usage Worker停止のまま公開フロントへ反映した。この時点では修正版の監督下実機再確認を待ち、停止・再開・削除・書き出しの後続受け入れも未完了としていた。

同じ2026年8月12日JSTの2回目の監督下確認では、Usage Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` と限定中継Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` を一時有効にした。接続確認は成功したが、「GlucoScopeを始める」でTurnstileが短く表示された後、必須のデータ接続画面が再表示された。D1は再び `0 / 0 / 0` のままで、利用プロフィールは作成されていない。確認直後にUsageを停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb`、限定中継を停止Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` へ戻した。

再現確認で、すでにユーザーモードにいる保存処理が不要な再読み込みを行い、SafariでsessionStorageの短期リレーチケットが失われる、または参照できない場合に、保存済み接続があっても有効なリレーadapterを復元できず必須画面を開くことを原因として特定した。このリリースは、ユーザーモードでは保存済みconfigを現在の接続として設定し、adapterをその場で有効化する。公開デモから入る場合は従来どおり完全なページ遷移を使う。ローカルテストに合格し、その後の監督下実機確認でもCGM表示の引き継ぎが合格した。

## 17. その場での接続引き継ぎ実機合格と停止復帰（2026-08-12 JST）

修正版の公開後、同じUsage Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` と限定中継Version `a398d59e-54c1-4b8d-a9a4-b779af360a54` を一時有効にして、iPhoneで3回目の監督下確認を行った。Gluroo（Libre）の接続に成功し、「GlucoScopeを始める」の後も同じユーザーモード画面にとどまり、ライブ血糖を表示できた。これにより、不要な再読み込みをやめてconfigとadapterをその場で有効化する修正は、CGM表示の中核経路で実機合格とする。

一方、この確認時点ではD1の `profiles`、`usage_daily`、`event_receipts` が `0 / 0 / 0` のままで、利用プロフィールは作成されていなかった。したがってこの結果だけでは利用分析基盤の作成成功を意味せず、Create、Stop、Resume、Delete、小さな書き出しリンクの受け入れは未完了としていた。CGM接続をUsageプロフィール作成の成否で遮らない境界は維持できた。

確認直後、限定中継はdeployment `a1962cbf-9f77-48c1-b33a-05bd39323a8c` で停止Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a`、Usageはdeployment `17de293b-2d38-4b07-aa5f-604c2cc65d43` で停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` を、それぞれ本番通信の100%へ戻した。両Workerとも許可Originのpreflightは `204`、許可Originからの停止中 `POST` は `503` を返した。Gitに保存する両Workerの設定は `false`、公開フロントの監督下候補gateは `true` のままで、一般利用者向け限定中継は停止中である。

D1が `0 / 0 / 0` のままだった理由として最も可能性が高いのは、以前の試験用profileをサーバー側で削除した後も、Safariの `glucoscope.usageProfile.v1` に古い認証情報が残っていたことである。アプリは端末内の情報から登録済みとして更新を試み、profile `PATCH` は正確に `401 authentication_required` を返した。Usageだけの失敗でCGM表示を止めない設計どおり、中核CGM経路はそのまま成功した。

端末内だけの修正候補は、`401 authentication_required` の場合に限り、要求開始時と現在のprofile ID、token、lifecycle generationがすべて一致する古い認証情報だけを忘れる。処理中に保存された新しい、または別のprofileと、401以外の失敗は保持する。削除後は利用イベントを送らず、次に本人が明示的に保存して新しいTurnstileを完了するまで新規profileを作らない。この修正は、その後の監督下実機確認で、古い認証情報の整理後に次の明示保存で新規プロフィールを作成できることまで合格した。

## 18. Usage lifecycle実機合格と停止復帰（2026-08-12 JST）

別の明示承認後、deployment `6dabe28d-19a4-40f6-9c6d-e6f273d18298` でactive Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` へUsage Worker通信の100%を向けた。一般利用者向け限定中継は停止したまま、iPhone SafariからAzure Nightscoutへ直接接続し、血糖表示を確認した。

最初の保存後はD1が `profiles / usage_daily / event_receipts = 0 / 0 / 0` のままで、古いSafari認証情報の安全な削除だけが行われた。次の明示的な保存でprofileが1件作成され、再読み込み後もprofileは1件のまま、`usage_daily=1`、`event_receipts=2` となった。これにより、古い認証情報を正確な401だけで忘れ、次の本人操作と新しいTurnstileで作成する修正を実機合格とする。血糖表示、重複作成防止、日別利用記録も合格した。

利用記録の停止後は記録中0件・停止中1件、再開後は記録中1件・停止中0件となり、allowlist JSONの書き出しも成功した。最後に端末プロフィールを削除し、cascade後の3テーブルが再び `0 / 0 / 0` になった。削除は血糖接続を削除する操作とは分離されている。

確認後、deployment `20216b73-27a9-41e0-a3be-25595babe185` で停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` を100%へ戻した。許可Originの停止中送信は `503`、`Cache-Control: no-store`、`Vary: Origin` を維持し、一般利用者向け限定中継も停止中である。Gitに保存するWorker設定は `false` のまま変更していない。

Phase 1BのUsage lifecycleは監督下実機受け入れ合格とする。このリリースで、削除成功後の完了文言を明示し、書き出しを通常操作より目立たない「詳しい管理」へ移した。一般利用者向け限定中継のDexcom G7経路も別の安全境界で正式受け入れを完了したため、次は少人数展開の判断とする。

## 19. 1〜3人の先行体験を継続有効化（2026-08-12 JST）

別の明示承認後、Usage deployment `4fbf0e2c-5f5c-4f4f-98a9-ae57d73b4824` で受け入れ済みVersion `5d160aed-7b27-48e6-b0a8-783534f97b6f` へ本番通信の100%を向けた。同時に、一般利用者向け限定中継deployment `5f8d00d9-9d68-4b2a-99cd-c58c26123684` で受け入れ済みVersion `a398d59e-54c1-4b8d-a9a4-b779af360a54` へ100%を向け、1〜3人の先行体験を開始した。これは広い一般公開ではない。

有効化後、両Workerの許可Origin preflightは `204`、不正なTurnstile tokenと不許可・Originなしの要求は `403`、応答は `Cache-Control: no-store` と `Vary: Origin` を維持した。Usage D1の `profiles`、`usage_daily`、`event_receipts` は境界確認後も `0 / 0 / 0` で、監査による書き込みはない。公開3CGMデモは別Workerで独立してライブを継続する。

Gitに保存する `USAGE_COLLECTION_ENABLED=false` と `RELAY_ENABLED=false` は変更しない。Usage停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb`、限定中継停止Version `635b8ad5-0c0e-49ff-a8c3-5dc3e8704a0a` を即時復帰先として保持する。先行体験中は、Safari完全終了後の復元、約1時間のチケット自然失効、実通信での上限到達、異常通信、提供条件の変更、問い合わせを運用観察し、必要時は該当Workerだけを停止する。

## 20. ユーザー版AI本番反映（2026-08-14 JST）

AI Worker deployment `a5b57a76-954b-4bb9-bbba-c23bfd0fa516` はVersion 29（`235cdf03-31d7-40fd-ab58-5c1c6aa2d923`）へ本番通信の100%を向け、対応するフロントはPages merge `a4497ab1a5d303c8a16b7d0aad999bf0dc1bde5d` で公開した。Version 28は履歴であり、ユーザーAIがONの間は直接戻してはならない。

- `mode=user`では、現在の案内Versionで初めてAI分析を使う時だけ、TurnstileとAI送信より先に短く明示確認する。確認は `glucoscope.aiLetterUserConsent.v1` へVersion付きで端末内保存し、取り消した場合は何も送らない。
- AIへ送るのは選択期間の集計サマリーである。表示名、接続先URL、接続用の合言葉、端末セッション識別情報、元の血糖データ一覧、治療、インスリン、食事、薬、機器設定は送らない。
- OpenAI Responses APIは `store: false` で呼ぶ。OpenAIは明示的なopt-inがないAPIデータをmodel学習へ使わないと説明している。一方、標準の不正利用監視ログにはpromptやresponseが含まれる場合があり、通常最長30日保持される。法令またはサービス・第三者保護のため、それより長い保持が必要となる例外がある。根拠は [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) とする。
- 個人ユーザー早期公開中は、コードの `SHARED_AI_CACHE_ENABLED=false` とWorker設定の `AI_CACHE_ENABLED=false` により、公開デモを含む全modeで共有KVの読み取り、書き込み、stale fallbackを停止する。ブラウザから届く `pageMode` は認証ではなく、共有cacheの利用を許可する根拠にしない。KV bindingは下記の段階的な復旧手順のためだけに残し、ユーザーAIがONのままVersion 28へ戻す許可にはしない。既存entryは読まず、新規entryも書かず、保持中のentryは設定済みの最長24時間以内に自然失効する。全modeで端末内 `glucoscope.aiLetterLocalCache.v14` だけを最大30件使う。
- 保存したデータ接続を削除すると、端末内AIキャッシュ、退役済み端末内AIキャッシュ、保存済みAI確認を削除する。これはOpenAIの不正利用監視ログの遠隔削除ではない。利用プロフィールだけの削除では、これらを連動削除しない。
- AI Workerの朝・昼・夜各10回、1日最大30回は、公開デモと全利用者で共有する全体運用上限であり、個人別の利用権ではない。他の利用により全体上限へ到達した場合も、CGM表示を止めずAI欄だけでやさしく伝える。
- 利用分析へ加算してよいのは、OpenAIから新しく正常に生成され、`generation.complete=true` の応答だけである。端末cache、保持中だが候補では読まない共有cache、stale fallback、失敗、ボタン押下、ChatGPTコピーは加算しない。
- AI生成 `POST /api/gluco-letter` は許可された `Origin` headerを必須にする。OriginなしのUsage `GET` は既存の運用確認のため維持する。
- AI用Turnstile actionは `glucoscope-ai-letter` とし、WorkerはSiteverifyの `action` と `hostname=glucoscope.app` の両方を検証する。利用プロフィール用 `glucoscope-usage-profile` tokenをAIへ流用しない。
- Turnstile、OpenAI、品質確認、budget、全体上限、AI利用記録のどこで失敗しても、AI欄だけで完結させ、検証済みCGM接続、通常の血糖表示、接続情報を止めたり削除したりしない。公開デモデータへもfallbackしない。
- Worker先行、Pages後続の公開は完了した。偽装できる `pageMode` 境界から共有KV書き込みが再開し得るため、ユーザーAIがONのままVersion 28へ戻してはならない。Version 29以降でAIをfail-closedに保つか、先にPages側のユーザーAIを停止して公開確認してからWorkerを復旧する。

## 21. 管理者ダッシュボード（管理者1名で受け入れ完了、2026-08-14〜15 JST）

`workers/gluco-admin-dashboard/` に、利用者別の最小限の利用状況を見る専用Cloudflare Workerを実装した。既存の公開Usage Dashboardや公開Usage APIとは分離し、公開サイトにはリンクしない。2026年8月14日、Version `d17e89e9-bc15-40fb-90a0-2e85cb19cf42` をdeployment `392fb7b5-792c-4990-b939-6ab97481beb1` で本番へ反映した。専用hostname全体を、正確な管理者メール1件だけを許可するCloudflare Accessで保護し、メールOne-time PINと15分sessionを使用する。実際のメールアドレス、Accessの識別子・設定値、保護されたhostnameはGitや運用記録へ残さない。

Access通過後もWorker内でAccess JWTの署名、issuer、audience、有効期限と、Secretに保存した管理者メールとの完全一致を再検証する。設定不足、token不足、検証失敗、別メールはD1を読む前に同じ`403`で安全に失敗する。

D1の既存view `admin_device_usage` に対する固定`SELECT` 1つだけを使い、サーバー側で読取専用HTMLを生成する。書き込み、任意SQL、検索、詳細、公開JSON、書き出し、ブラウザ側JavaScriptは設けない。表示してよいのは、端末プロフィールごとの次の5項目だけである。

- 表示名
- 利用記録の状態
- 利用した日数（稼働D1に残る最大90日分）
- 新しく正常に完了したAI分析の合計回数
- 通常のグルコの想い出No.1〜50の現在数

profile ID、token・token hash、作成・更新・最終利用日時、日別行、event receipt、血糖値・グラフ、AIへ送った内容・AIお手紙本文、CGM種別、接続先・合言葉・端末セッション識別情報、IPアドレス、raw User-Agentは選択・返却・表示しない。

2026年8月15日、管理者1名の実browser acceptanceを完了した。未認証requestはAccessへの`302`で停止し、許可された管理者の`GET /`はサーバー描画の読取専用empty stateを表示した。query付きURLと未知pathは`404`となり、script、画像、外部linkは0件だった。preview URL、application log、invocation logは無効のままとする。本番D1確認は実数を記録せず、「行数不変」という境界結果だけを残す。メールOne-time PINはMFAではないため、メールアカウント側の二段階認証を有効にし、管理者追加や運用範囲拡大の前にMFA対応IdPを再検討する。

## 22. AI利用上限の無効状態での連携候補（2026-08-15）

FreeはJST基準で正常完了した新しいAI分析を1日1回、Plusは1日5回とするためのサーバー側基盤を追加した。ただし、Usage Worker、AI Worker、フロントの保存済みflagはすべて`false`であり、現時点の公開動作と送信内容は変えない。フロントがOFFの間は`Authorization`とquota用`requestId`を送らない。

AI回数は機能提供に必要な別記録であり、任意の利用記録とは分ける。利用記録を停止してもFree AIのcredentialは使えるが、`usage_daily`のAIイベントは送らない。利用プロフィールを削除するとcredentialは無効になり、その端末プロフィールに紐づくquota行もcascade削除する。account/Plusのtierと上限はPlus正本を内部RPCで確認し、ブラウザから届くtier・期限・上限値を信用しない。

公開Usage集計のAI合計は、利用記録に同意した端末プロフィールの`usage_daily.ai_generation_success_count`を維持する。account subjectを含み得る`ai_quota_days`は同意と母数が異なるため公開集計へ混ぜない。権威quota合計は保護された運用・管理者経路だけで扱う。

有効化前には、quotaとして成功日・回数を保存することの専用の短い説明と同意、Privacy文面の更新、公開デモを`pageMode`偽装で迂回できないサーバー検証済みidentity、両WorkerとPagesのflag一致が必要である。公開順はPlus正本、Usage migration/Worker、AI Worker、Pagesとし、すべてOFFで確認した後にUsage、AI Worker、Pagesの順でONにする。未解決のままONにしない。quota失敗はAI欄だけで完結し、CGM接続、通常の血糖表示、いつものグルコの話を止めない。
