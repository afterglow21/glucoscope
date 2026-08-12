# GlucoScope 利用者設定・利用分析基盤

Status: Phase 1A implemented / Phase 1B simplified connection-integrated flow active for supervised re-acceptance

Last reviewed: 2026-08-12

Canonical product principles: `docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md`

## 1. 目的

GlucoScopeを何人が、どの機能をどのくらい使っているかを、運営と改善に必要な範囲で理解できる基盤を準備する。

この基盤は、人を評価したり、血糖マネジメントを採点したりするためのものではない。表示名や利用回数から、治療状況、努力、生活習慣を推測しない。

## 2. 固定する実装順

1. 利用者設定・最小限の利用分析基盤
2. 認証された管理者ダッシュボード
3. Plus 30日パスと任意の開発支援への導線
4. ユーザー展開開始後の、横向きグラフ限定の常時表示モード

この文書は1番だけを扱う。管理者ダッシュボード、決済、常時表示を先に実装しない。

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
- 監督下のPhase 1B受け入れではCloudflareアカウント認証済みD1 consoleとD1内viewだけを使い、HTTP管理APIを作らない。継続的な管理者ダッシュボードの前に、専用の強い認証、最小権限、読取専用の初期画面を追加する
- 重複加算を防ぐ短期idempotency
- 日別データの90日ローリング削除
- 本人による表示名訂正、allowlist書き出し、端末プロフィール削除
- 稼働DBからの即時cascade削除と、復旧スナップショット残存期間の公開

Cloudflare公式仕様を2026-08-11に再確認した。D1 Time Travelは常時有効で、稼働DBから削除後もFreeプランでは最長7日、Paidプランでは最長30日、復旧可能な履歴に残る場合がある。公開文面では最大30日の残存可能性とプラン別期間を案内する。

将来、血糖・健康データや本人データの公開共有を扱う設計へ変更する場合は、この最小限利用分析とは分けて、明示同意を含む別の安全設計を行う。

## 9. 管理者、任意支援、Plusの分離

既存のUsage DashboardはAI Worker全体の運用カウンターであり、将来の利用者別管理者ダッシュボードではない。利用者別画面は認証必須とし、運営と改善に必要な表示名、説明済みの最小限の回数、収集停止状態だけを見せる。

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

- アカウント作成・ログイン・本人確認・復旧
- 人を端末横断で識別する利用者ID
- 利用者一覧と利用者別集計
- 認証された管理者ダッシュボード
- 支援との明示連携
- Plus 30日パス

Phase 1Bの端末プロフィール、D1、API、開始・停止、書き出し、サーバー削除は別設計として実装済みであり、この未完了一覧には含めない。上記の残作業は別の実装判断と、必要な場合はCloudflare変更前の明示確認を挟む。

## 12. Phase 1B: 端末プロフィールのopt-in実装

早いユーザー公開と将来の利用者別集計を両立するため、最初からアカウント作成やログインを求めず、ブラウザごとの「端末プロフィール」を使う。これは人を一意に表すアカウントではない。同じ人が2台の端末で使うと2件として見え、ブラウザの保存データを消した場合は別端末へ復旧・統合できない。Plus利用権、決済、本人確認には流用しない。

公開デモを見るだけの人には、表示名や端末プロフィールを求めない。自分の血糖データを新しくつなぐフォームでは表示名を必須にするが、本名は不要とする。接続確認後の `GlucoScopeを始める` 操作に端末プロフィール作成を統合し、利用状況共有だけの大きな独立パネルは設けない。

開始前には、次の短い案内とPrivacy Notesへの `詳しく` リンクを示す。

> 表示名と基本的な利用回数を、GlucoScopeをよくするために記録します。血糖値や接続情報は記録しません。

法律文書のようなチェックボックスは追加しない。Gluroo限定中継の確認は、接続先情報をCloudflareで一時処理する別の境界として維持し、この利用プロフィール案内へ混ぜない。端末プロフィール作成の直前だけTurnstileを表示し、actionは `glucoscope-usage-profile` とする。

利用プロフィール用TurnstileまたはUsage Workerだけが失敗した場合は、検証済みのCGM接続を止めない。必須表示名と接続情報をブラウザへ保存してユーザーモードを開始し、利用プロフィールは未登録・利用記録OFFのままとする。Gluroo限定中継そのものの同意、Turnstile、署名付きticket、接続先検証はこのfail-open境界へ含めず、従来どおりfail-closedを維持する。ブラウザへの表示名または接続情報の保存に失敗した場合も、接続成功扱いにしない。

Phase 1Bで扱ってよいのは次だけとする。

- 表示名（新しい個人データ接続では必須、本名は不要）
- 1日につき最大1回の利用日
- 新しく正常に完了したAI分析の回数
- 通常のグルコの想い出 No.1〜50 の現在数

AI分析は、OpenAIから新しく正常に生成され、`generation.complete=true` で、共有・端末キャッシュ・stale fallbackではない応答だけを候補とする。現在のユーザーモードではAI分析自体が準備中のため、一般公開でのAI回数はその別工程が完了するまで増えない。

グルコの想い出は、血糖状態から影響を受け得るLucky Gluco No.51〜70と、最新値100 mg/dLをきっかけにするUnicorn Glucoを必ず除外する。ID、初めて出会った日、出会った回数も送らず、No.1〜50の異なる件数を0〜50の整数で送る。

端末内の識別情報は `glucoscope.usageProfile.v1` へ分離する。既存の `glucoscope.localProfile.v1` と `local-profile.js` はネットワークを使わないPhase 1A境界を維持する。サーバーが作る不透明なprofile IDとbearer tokenはURL、query、hash、ログへ入れず、サーバーではtokenのhashだけを保存する。`glucoscope.usageProfile.v1` が存在するページでは公開Cloudflare Web Analyticsを読み込まず、任意表示名だけの `glucoscope.localProfile.v1` は停止条件にしない。

通常UIには、利用記録の停止・再開と、サーバー上の端末プロフィール・利用記録の削除だけを小さな管理導線として置く。allowlist JSON書き出しは同じ場所の小さな補助リンクとする。停止または削除を押した時は、通信結果を待たず端末側を先に停止し、pending AI eventも消して新しい利用イベントを送らない。サーバー削除が成功するまでは端末tokenを残し、成功後だけ利用プロフィール用キーを削除する。端末内の表示名、データ接続、血糖データ、AIキャッシュ、グルコの想い出は連動して削除しない。

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

## 16. 監督下の再受け入れ開始（2026-08-12 JST）

別の明示確認後、active Version `5d160aed-7b27-48e6-b0a8-783534f97b6f` へ本番通信の100%を向け、runtimeの `USAGE_COLLECTION_ENABLED=true` で監督下の一時受け入れを再開した。同じ公開候補でフロントの `USAGE_PROFILE_ENABLED` とusage-profile meta gateを `true` にし、公開デモを見るだけでは表示名やprofileを求めず、自分のデータを新しくつなぐ時だけ本名でなくてよい表示名を必須にする。

許可Originのpreflight `204`、許可Originからの無効なダミーTurnstile tokenが `403 turnstile_failed`、不許可OriginとOriginなしが `403` であることを確認した。この境界確認後も `profiles`、`usage_daily`、`event_receipts` は `0 / 0 / 0` である。Gitに保存する `wrangler.jsonc` は `USAGE_COLLECTION_ENABLED=false` のまま維持し、停止Version `7cb71965-74c3-47f9-b589-75cf6d669edb` とdeployment `25be2258-b72a-4e2c-8bf1-ab47781c48dc` を直前のclean stopped checkpoint兼rollback先として残す。一般利用者向け限定中継も独立して `RELAY_ENABLED=false` を維持する。

この一時有効化では、再callbackによる誤エラーが起きないprofile作成、停止、再開、削除、補助リンクからのallowlist書き出しを、利用者が管理する1台の端末で確認する。Usage Workerまたは利用プロフィールだけの失敗は確認済みCGM接続を止めず、Gluroo限定中継の安全確認、接続先検証、ブラウザ保存成功は引き続きfail-closedとする。
