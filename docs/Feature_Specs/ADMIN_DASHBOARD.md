# GlucoScope 認証付き管理者ダッシュボード

Status: production deployed 2026-08-14 JST / administrator 1名のbrowser acceptance completed 2026-08-15 JST / Plus合計の受け口をローカル実装済み・未デプロイ

Last reviewed: 2026-08-15

2026年8月14日、専用WorkerのVersion `d17e89e9-bc15-40fb-90a0-2e85cb19cf42` をdeployment `392fb7b5-792c-4990-b939-6ab97481beb1` で本番へ反映した。専用hostname全体を、正確な管理者メール1件だけを許可するCloudflare Accessで保護し、Access通過後もWorkerが署名付きJWTとSecretに保存した同じメールとの一致をD1読取前に再検証する。2026年8月15日、管理者1名のbrowser acceptanceを完了した。未認証requestはAccessへの `302` で停止し、許可された管理者の `GET /` はサーバー描画の読取専用empty stateを表示した。query付きURLと未知のpathは `404` となり、script、画像、外部linkは0件だった。公開サイトからはリンクせず、preview URL、application log、invocation logも無効のままとする。

Canonical principles: `docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md`

Implementation: `workers/gluco-admin-dashboard/`

## 1. 目的

少人数の先行体験で、GlucoScopeが届いているか、利用記録が動いているかを、運営と改善に必要な最小限の情報だけで確認する。

この画面は一般利用者向けではなく、管理者1名だけが使う。人を評価・ランキングしたり、表示名と回数から血糖状態、治療、努力、生活習慣を推測したりしない。

既存の公開 `Usage Dashboard` はAI Worker全体の運用カウンターであり、この利用者別画面とは別のままとする。

## 2. 固定する構成

- `glucoscope-admin-dashboard` という専用Cloudflare Workerを新設する
- 公開GitHub Pagesと既存Usage WorkerのHTTP APIへ管理者画面を追加しない
- 専用Workerのホスト全体をCloudflare Accessで保護する
- Access通過後も、WorkerでAccess JWTを必ず再検証する
- 既存D1 `glucoscope-usage` を `USAGE_DB` として直接bindする
- 既存view `admin_device_usage` へ固定した1つの `SELECT` だけを実行する
- PlusはD1を直接bindせず、`PLUS_ADMIN_SUMMARY` Service Bindingから有効な30日パスの合計1項目だけを受け取る
- HTMLはWorkerでサーバー描画し、ブラウザから呼ぶJSON APIを作らない
- 公開サイトからリンクせず、検索エンジンにも登録させない

専用WorkerへD1を直接bindするのは、既存Usage Workerを再デプロイせずに初期画面を追加するための最小構成である。D1 bindingには読取専用ACLの設定項目がないため、初期版では、別Workerへの分離、書込経路の不在、固定SELECT、ソース検査テストを最小権限の境界とする。

将来、管理機能が増える場合は、D1を持つ非公開の読取serviceとService Bindingへ分離する。それまでは操作・削除・変更・CSV出力・自由SQLを追加しない。

Plus合計の受け口は、target service `glucoscope-plus-entitlement` のnamed entrypoint `AdminPlusAggregateEntrypoint` を呼ぶ。許可するmethodは引数なしの `getActivePlusSummary()` だけとし、返却値から非負の安全な整数 `activePlusCount` だけを採用する。binding未接続、呼出失敗、欠損、文字列、負数、小数、過大値はすべて「確認できません」とし、0へ変換しない。Plus側が正常に実数0を返した時だけ0と表示してよい。

## 3. 強い認証

Cloudflare Accessを第一の入口とし、Allow policyは管理者の正確なメールアドレス1件だけにする。`Everyone`、メールドメイン全体、または「One-time PINでログインできた全員」を許可条件にしない。

Workerでは `jose` を使い、`Cf-Access-Jwt-Assertion` について次を検証する。

- RS256署名
- `TEAM_DOMAIN` と一致するissuer
- `POLICY_AUD` と一致するapplication audience
- `iat` claimの存在と `exp` の有効期限
- 署名済み `email` claim
- `ADMIN_ALLOWED_EMAIL` Secretとの完全一致（大文字小文字は正規化）

`TEAM_DOMAIN` と `POLICY_AUD` は秘密情報ではない設定値である。`ADMIN_ALLOWED_EMAIL` は個人情報をGitに残さないためCloudflare Secretにする。設定不足、placeholder、token不足、検証失敗、別メールはすべて同じ `403` で安全に失敗し、理由やtoken内容を画面・ログへ出さない。

初期の管理者1名運用では、正確なメールAllow policy、メールOne-time PIN、15分sessionを使用する。メールOne-time PINはMFAではないため、管理者のメールアカウント側で二段階認証を有効にする。管理者追加や運用範囲拡大の前には、MFA対応IdPを優先して再検討する。

## 4. 読み取ってよい項目

初期画面へ表示してよいのは次だけとする。

- 表示名
- 利用記録中 / 停止中
- 最大90日分の利用日数
- 新しく正常に完了したAI分析の合計回数
- 通常のグルコの想い出 No.1〜50 の現在数
- 有効なPlus 30日パスを持つアカウントの合計数

「1行=1人」ではなく「1行=1端末プロフィール」と明記する。同じ人が別の端末またはブラウザで使うと別々に表示される。
Plusは上段の合計だけであり、端末プロフィールカードへPlus状態を付けない。Plusアカウントと端末プロフィールを結び付けない。

## 5. 選択・返却・表示してはいけない項目

次はD1 queryの返却、サーバー描画HTML、URL、エラー、ログ、fixture、スクリーンショットへ含めない。

- profile ID
- profile token、token hash
- 作成、更新、最終利用などの日時
- 日別の行、利用日そのもの、event receipt
- 血糖値、測定時刻、グラフ、TIR/TAR/TBR、平均、CV、GMI、GlucoScore
- AIへ送った内容、AIお手紙本文、分析期間、分析モード
- CGM種類、Nightscout / Gluroo URL、Secret、relay ticket、接続情報
- 治療、薬、食事、症状、機器設定
- IPアドレス、raw User-Agent、referrer、query、fingerprint
- 購入者ごとのPlus状態、メールアドレス、Stripe ID、決済額、購入・返金・支援履歴

並び順のためにD1内の `last_seen_at` を固定SELECTの `ORDER BY` だけで使えるが、値は返さない。

## 6. 読取専用境界

- 利用できるrouteは認証後の `GET /` と `HEAD /` だけ
- D1を読むのは `GET /` だけ。`HEAD /` は認証後、同じ安全headerを空bodyで返す
- Plus合計serviceを呼ぶのも、Access認証に成功した正確な `GET /` だけ。`HEAD /`、query string、別path、write method、認証失敗では呼ばない
- query string、別path、POST、PATCH、PUT、DELETEを受け付けない
- 検索、filter、profile詳細、任意SQLを受け付けない
- D1へ `INSERT`、`UPDATE`、`DELETE`、`REPLACE`、DDL、migrationを実行しない
- 画面から停止・再開・訂正・削除を行わない
- 書き出し、コピー、raw JSON表示を作らない
- 最大100端末プロフィールとし、超えた場合は最近使われた100件までと案内する

本人による表示名訂正、停止、再開、書き出し、削除は既存の本人用profile token経路だけに残す。管理者画面から代行しない。

## 7. 画面とプライバシー

ITに詳しくなくても読める日本語を優先し、次の4つの概要だけを最初に表示する。

1. 端末プロフィール数
2. 利用記録中
3. 停止中
4. Plus利用中

Plus合計を取得できた時は正確な `activePlusCount` と「有効な30日パス」を表示する。取得できない時は `--` と「確認できません」を表示し、障害や未接続を0人と誤解させない。

その下に許可した5項目だけの端末プロフィールカードを表示する。横スクロール前提のtableを使わず、320px幅でも1列で自然に読めること。血糖値等を表示しないこと、端末プロフィール単位であること、AIは新しく正常に完了したものだけを数えることを短く説明する。

画面名は「利用者の利用状況」とする。手動の「更新」リンクと、画面を取得した時刻をJSTで表示する。取得時刻はHTMLを生成した時刻であり、端末プロフィールの作成・更新・最終利用日時ではない。端末プロフィールが0件の時は「まだ端末プロフィールはありません。登録が完了するとここに表示されます。」と表示する。

ブラウザ側JavaScript、外部画像、外部font、analytics、auto refreshを使わない。すべての応答を `no-store` とし、CSP、no-referrer、frame拒否、MIME sniffing拒否を付ける。`X-Robots-Tag: noindex, nofollow, noarchive` を付ける。

## 8. ログ境界

Workerソースでapplication logを作らず、Cloudflare observabilityとinvocation logsを無効のままにする。

Secret値、Access JWT、管理者メール、表示名、profile行、D1の件数または内容、Plusアカウント情報、購入者メール、Stripe ID、購入履歴をGit、command argument、CI output、運用メモへコピーしない。本番確認結果は「認証成功」「項目allowlist合格」「D1行数不変」のような境界結果だけを記録する。

## 9. 本番設定と運用境界（2026-08-14設定済み）

初期の管理者1名運用では、次の設定と境界を固定する。実際のメールアドレス、Accessの識別子・設定値、保護されたhostnameは、Gitや運用記録へコピーしない。

1. 許可する正確な管理者メール1件だけをAccess Allow policyと `ADMIN_ALLOWED_EMAIL` Secretへ設定する
2. メールOne-time PINと15分sessionを使用し、メールアカウント側の二段階認証を有効にする
3. `Everyone`、メールdomain全体、Login Methods、Bypass policyをAllow条件へ追加しない
4. Access issuerとapplication audienceをWorker設定へ保持し、値そのものは文書や運用記録へコピーしない
5. 専用Workerだけへ既存D1をbindし、既存Usage Worker、収集switch、relay、公開Pagesを変更しない
6. `PLUS_ADMIN_SUMMARY` は `glucoscope-plus-entitlement` の `AdminPlusAggregateEntrypoint` だけへbindし、Plus D1を管理者Workerへ直接bindしない
7. `preview_urls=false`、observability無効、公開サイトからのlinkなしを維持する

初期はAccess保護した専用Worker production URLを使う。運用範囲が広がる前に、MFA対応IdPと専用custom domainへの移行を再検討する。

## 10. 受け入れ条件

- ローカルのsyntax、unit test、types、strict dry-runが合格する
- 実際のRSA署名でissuer、audience、time、email検証をテストする
- 未認証、別メール、期限切れ、wrong issuer、wrong audience、偽造tokenがすべて拒否される
- 認証失敗時にD1を読まない
- 認証失敗、HEAD、query付きURL、別path、write methodでPlus serviceを呼ばない
- D1を読むproduction SQLが固定SELECT 1つだけ
- sourceにwrite SQLとapplication loggingがない
- 返却オブジェクトとHTMLにprofile ID、日時、日別行がない
- 表示名がHTML escapeされる
- GET `/` 以外がD1を読まない。HEAD `/` は認証だけ行い、空bodyを返す
- Plus serviceの成功時は正確な合計だけを表示し、余分な返却項目を捨てる
- Plus serviceの未binding・失敗・不正値は `--` とし、0を偽装しない
- HTML、ログ、fixtureに購入者、メールアドレス、Stripe ID、購入履歴を含めない
- すべてのresponseがno-storeと安全headerを維持する
- 本番smokeの前後で既存3 tableの件数が変わらない
- 既存Usage Worker、収集switch、relay、公開Pagesの挙動を変えない

2026年8月15日の実browser確認では、未認証requestのAccess redirect、許可された管理者の読取専用empty state、query付きURLと未知pathの `404`、script・画像・外部linkがないことを確認した。JWTの署名、issuer、audience、有効期限、issued-at claimの存在、email、method、安全header、HTML escape、write SQL不在はlocal acceptance suiteで確認する。本番D1確認は実数を記録せず、「行数不変」という境界結果だけを残す。

## 11. 比較して採用しない初期案

### 既存Usage Workerの `/admin`

公開利用者APIと管理画面の障害範囲、CORS、Origin、認証分岐が同じWorkerへ集まる。`workers.dev` 全体をAccessで保護すると利用者APIも止まるため、初期案には使わない。

### 管理者用bearer secretだけ

ブラウザへ長期secretを持たせる必要があり、identity、短いsession、MFA、失効、Access policy監査を利用できない。単独認証として使わない。

### Usage Workerの読取RPC + Service Binding

Admin WorkerからD1 bindingを外せる利点はあるが、利用中の既存Usage Workerへnamed entrypointを追加し、先に再デプロイする必要がある。初期の読取画面には変更範囲が大きいため見送り、管理機能が増える前の次段階候補とする。
