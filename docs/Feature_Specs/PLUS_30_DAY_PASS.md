# GlucoScope Plus 30日パス

Status: approved core product, adult-or-guardian buyer, and conditional full-refund decisions / sales region, tax, public support, deletion, and retention details pending owner, professional, and implementation acceptance / stopped non-public staging only / not available for purchase

Last reviewed: 2026-08-15

Canonical principles: `docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md`

## 1. 目的

Plus 30日パスは、GlucoScopeを長く育てるために、追加の便利機能を30日間使えるようにする有料サービスである。

Plusは医療サービスではない。診断、治療判断、インスリン量、薬、機器設定、緊急時の判断を提供しない。購入により、より正しい医療判断、より良い血糖値、健康上の効果が得られるとは案内しない。

価格と主な機能は決定済みだが、販売はまだ開始しない。本人または保護者の確認と復旧、返金受付、税、問い合わせ対応、Stripeテスト決済、安全確認を終えるまで購入導線を公開しない。

## 2. 決定した初期商品

| 項目 | 決定内容 |
| --- | --- |
| 商品名 | Plus 30日パス |
| 価格 | 300円 |
| 決済 | 1回払い |
| 自動更新 | なし |
| 有効期間 | Stripeの決済成功から連続30日 |
| FreeのAI分析 | このブラウザの登録プロフィールにつき、成功した新規分析を1日1回まで |
| PlusのAI分析 | 認証済みPlusアカウントにつき、成功した新規分析を1日5回まで |
| カスタム期間 | Plus特典 |
| Share Studio | Plus特典。認証済みアカウントごとに1回だけ無料体験あり |
| 初期販売の対象 | 購入とメールを管理する18歳以上の本人、または子どものために購入・復旧・問い合わせを管理する18歳以上の保護者 |
| 販売開始 | 未定。テストモードと公開前確認の完了後 |

購入前には「300円」「30日間」「1回払い」「自動更新なし」を同じ画面で見せる。期限が来ても自動で料金は発生せず、続けたい人だけが自分で新しいパスを購入する。

## 3. 最初から固定する境界

- 現在の血糖値、今日・昨日・7日・30日のグラフ、ふりかえり、安全に関する案内は、Plusの購入を必須にしない。
- 任意の開発支援は、機能特典のない支援のまま残す。支援履歴からPlus利用権を自動付与しない。
- 利用記録の端末プロフィール、profile ID、token、表示名を、購入者の本人確認やPlus利用権に流用しない。
- Plusは別の認証済みアカウントと専用利用権ストアで管理する。
- Stripeへ血糖値、グラフ、TIR/TAR/TBR、平均、CV、GMI、GlucoScore、AIへ送った内容、AIお手紙本文、CGM種別、接続URL、合言葉、relay ticketを送らない。
- カード番号などの決済情報はStripeの画面で扱い、GlucoScopeの画面・Worker・D1・ログでは受け取らない。
- 子どもや高齢者を含め、購入中、利用中、期限切れ、再購入、問い合わせの言葉を短く分かりやすくする。
- 購入を急かすカウントダウン、繰り返すポップアップ、医療上の不安を利用した訴求は行わない。
- Plusや利用回数の機能が失敗しても、CGMの接続、現在血糖、基本グラフを止めない。

## 4. FreeとPlusの境界

### Freeのまま残すもの

- 公開デモ
- 自分の現在血糖と基本グラフ
- 今日、昨日、7日、30日の期間切替
- ふりかえり指標とGlucoScore
- 通常のグルコのメッセージと想い出
- 接続設定、削除、Privacyと安全案内
- 成功した新規AI分析を1日1回
- Share Studioを、認証済みアカウントごとに1回だけ試す権利

### Plusで使えるもの

- 成功した新規AI分析を1日5回まで
- グラフのカスタム期間
- Share Studioの継続利用
- Share Studioの複数テンプレート、見た目、文章、含める項目の選択
- 端末内で保存したShare Studioテンプレートの再利用

Plusの有無で、血糖値や人の努力を格付けしない。Plus限定のGlucoScore、医療上の優先表示、緊急機能、より強い健康助言は作らない。

## 5. AI利用回数の数え方

1日は日本時間の0時から23時59分59秒までとする。Freeの「1日1回」は、現在の利用記録で使うブラウザプロフィール単位である。同じ人が別のブラウザを使ったり保存情報を消したりすると別プロフィールになり得るため、これを人の人数とは呼ばない。

Plusの「1日5回」は、認証済みPlusアカウント単位とする。ブラウザや端末を変えても同じアカウントの回数として扱う。ブラウザから送られた「Plusです」という申告だけを信用せず、サーバー側で有効な利用権を確認する。

次の場合だけ1回として数える。

- OpenAIから文面を受け取った
- 安全・医療・Privacy・事実関係・内部情報の検査に合格した
- 利用者へ表示できる最終文面として確定した

次は回数を消費しない。

- 文書・品質チェックで止まった
- 書き直し後も安全に表示できなかった
- OpenAIや通信のエラー
- Turnstileの失敗や期限切れ
- 全体の費用・回数上限による停止
- 利用者が途中で閉じた、期間や接続を切り替えた
- 端末内に保存済みの同じお手紙を再表示した

同時に複数回押して上限を超えないよう、生成前に短時間の予約を作る。表示可能な成功時だけ予約を確定し、失敗時は解除する。応答が失われた予約は短時間で失効させ、同じrequest IDを重複加算しない。

AIの全利用者共通の費用・障害防止上限は、Free/Plusの個人上限とは別に残す。個人上限に余裕があっても全体上限で一時停止する場合があることを、短く案内する。

利用状況の任意記録を停止しても、FreeのAIそのものを取り上げない。個人上限を有効にする前に、「AIを使った日は、上限確認のため成功回数だけを最大90日保存する」ことを、通常の利用状況記録とは分けて短く説明し、確認を得る。利用記録が停止中の時は公開・管理者用の任意analytics eventを送らない。端末プロフィールを削除した時は、そのプロフィールに結び付いたAI回数もcascade削除し、次のAIだけを認証未完了として止める。CGM表示は止めない。

## 6. カスタム期間とShare Studio

今日、昨日、7日、30日はFreeのまま残し、任意の日付を選ぶカスタム期間だけをPlus特典にする。Plusがない時もボタン自体を隠さず、「Plusで使えます」と短く表示する。期限切れ後は基本期間へ戻し、保存済みの血糖データや接続設定を削除しない。

Share Studioは、本人が選んだ時だけ投稿用画像を端末で作り、共有前に健康情報を含むことを明示する。SNSへの自動投稿は行わず、端末の共有機能へ渡すところまでとする。接続URL、合言葉、不要な個人情報を画像へ含めない。

無料体験は、認証済みアカウントごとに完成画像を1回作れるものとする。プレビュー表示、説明を読むこと、失敗した作成は消費しない。完成画像が安全チェックを通り、利用者へ渡せる状態になった時だけ使用済みにする。同じrequest IDやWebhookで二重消費しない。

## 7. 30日の数え方と再購入

Stripeが決済成功を記録した時刻を開始時刻とし、その時刻から30日後の同時刻まで有効にする。Webhookの受信が遅れても、受信時刻へずらさない。画面には終了日時を日本時間で表示する。

自動更新は行わない。期限の前後に勝手な請求は発生しない。期限後も、現在血糖、基本グラフ、ふりかえりなどFreeの機能はそのまま使える。

有効期間中の買い間違いを防ぐため、初期版では追加購入ボタンを出さない。期限が切れた後、利用者が明示的に選んだ時だけ新しい30日パスを購入できる。同じ決済通知が複数回来ても利用権は1回だけ付与する。

期限判定の正本はサーバー時刻とし、ブラウザ時計だけでPlusを有効にしない。

## 8. 購入者の確認と復旧

Plus利用権は、利用記録とは別の専用ストアで管理する。最低限、ランダムなaccount IDとentitlement ID、正規化メールの照合用HMACと鍵version、メール確認状態、本人利用か保護者管理か、確認文面の版と確認時刻、商品、開始時刻、終了時刻、状態、Stripe参照ID、Share Studio無料体験の使用状態だけを扱う。完全なメールアドレスや復号できるメール暗号文はD1へ保存しない。メールはコード送信時のメモリと非公開メールadapterだけで扱い、HMAC鍵はデータベースやGitと分けて管理する。

複数端末、ブラウザデータ削除、機種変更へ対応するため、同じメールへ届く短時間・1回限りの6桁確認コードで復旧する。確認成功時は古いsessionをすべて失効し、新しい端末へsessionを切り替える。

コード送信時のTurnstileを通過したブラウザへ、256-bitのランダムな`verificationGrant`も返す。ブラウザはこれを同じタブのメモリだけに置き、コード確認時に添える。D1へ保存するのはそのSHA-256 hashだけとし、localStorage、画面、URL、公開状態へ出さない。これにより、コード入力時に2回目のTurnstileを求めず、コード送信をしていない外部からの推測を止める。再読み込み後は、もう一度コードを送るところから始める。

メールのlocal-partは大文字小文字を勝手に変えず、domainだけを標準IDNAのASCII表記へ揃えて小文字化する。照合HMACの鍵更新時はcurrentと直前previousの2世代をSecretで同時に持ち、確認成功時に旧HMACのaccount ID、利用権、無料体験状態を保ったままcurrent HMACへ原子的に更新する。片方だけの設定、versionの飛び越し、currentとpreviousに別accountが同時にある場合は自動統合せず停止する。旧鍵を安全に外す手順は販売前に受け入れる。

完全なメールアドレスを公開ログ、URL、利用記録D1、AI Worker、Relay Workerへ入れない。管理者の利用状況画面にもメール、Stripe ID、購入履歴を表示しない。

購入前に、Plusの復旧に使うメールアドレスを確認済みにする。Stripe Checkoutが集めたメールアドレスだけを本人確認として信用せず、購入を始めた認証済みアカウントと、決済後に利用権を受け取るアカウントをサーバー側で同じものとして確認する。メールの確認リンクまたは確認番号は短時間・1回限りとし、試行回数を制限する。確認に失敗してもFreeの機能は止めない。

確認メールの送信候補はResend Freeとし、送信元は `no-reply@auth.glucoscope.app` とする。2026年8月15日時点の無料枠は月額0米ドル、月3,000通、1日100通、送信ドメイン1つで、通常の送信記録とメール本文は最長30日保持される。hard bounceまたは迷惑メール報告があった宛先はチーム全体のSuppression Listへ入り、全送信ドメインからの送信が止まる。原因を確認・解決した後に運営者が手動で削除するまで、30日を超えて残る場合がある。原因未解決では削除せず、再送しない。送信に使う情報は、宛先アドレス、10分で無効になる6桁コード、コードの入力方法を伝える短い固定案内だけとし、氏名、表示名、血糖値、グラフ、接続情報、AI本文、購入情報は入れない。開封・クリック追跡は無効にする。Resendでの通常30日保持やSuppression Listへの保持はコードの有効期限を延ばさない。無料枠、通常の保持条件、Suppression List、送信元認証、配信失敗時の扱いを実メール前に再確認し、少人数の実メールとPrivacy Notesの受け入れを終えるまで送信を有効にしない。月額5米ドルのCloudflare Email Service / Workers Paidは契約しておらず、本番候補から外す。

GlucoScope側の `account_auth_challenges` は、`expires_at < cleanup時刻 - 24時間` の行を毎時cleanupで削除する。`account_email_send_reservations` も、`reserved_at < cleanup時刻 - 24時間` の行を同時に削除する。毎時実行のため、通常はそれぞれの基準から約24〜25時間で消える。公開文では「おおむね1日」と説明する。staging D1へのbindingとmigrationは確認済みだが、stagingにはCronを設定していない。checked-inの `ACCOUNT_AUTH_CLEANUP_ENABLED` は `false` のままとし、意図した環境でのcleanup実行と失敗時の再確認を受け入れた後だけ有効にする。確認済みアカウントのメール照合HMACと購入・会計記録の保持期間は、この一時記録とは別で未決のままとする。

Cloudflare Rate Limiting bindingでは、同じ接続元ごとにrequest-codeは5回/60秒、verifyは30回/60秒とする。検証した `CF-Connecting-IP` はbindingの一時的なkeyだけに使い、D1やapplication logへ保存しない。本文読取、Turnstile、D1、メール送信より前に確認し、接続元が欠落・不正、またはbindingが失敗した場合は有効な認証経路だけを`503`で閉じる。アカウント認証が停止中ならbindingへ触れない。

Resend APIのHTTP `200`や`email.sent`は、Resendが要求を受け付けて配送を試す状態であり、受信箱への到着を保証しない。少人数の実メールでは、Resendの状態だけでなく本人の受信箱でも確認する。運営者は[Resendの利用条件](https://resend.com/legal/acceptable-use)にあるbounce率4%未満、spam complaint率0.08%未満を日次で確認し、近づいた時点でGlucoScope側の送信を止めて原因を調べる。超過時はResend側で一時停止・終了され得る前提とする。APIの秒間上限は公式ページ間で表示差があるため固定値を仕様の正本にせず、実アカウントのUsage画面と各応答の `ratelimit-*`、`retry-after`、`429` を確認して従う。外部の上限とは別に、GlucoScope側の短時間制限とrolling 24時間80件の全体上限を維持する。正本候補は[Resend Usage Limits](https://resend.com/docs/api-reference/rate-limit)、[Event Types](https://resend.com/docs/webhooks/event-types)、[Delivered表示と実受信の違い](https://resend.com/docs/knowledge-base/what-if-an-email-says-delivered-but-the-recipient-has-not-received-it)とする。

### 初期販売対象と、子ども・保護者・共用メール

- 購入とメールを管理する人は18歳以上とする。本人利用では本人が、子どもの利用では18歳以上の保護者が、購入、確認メール、別端末への復旧、返金を含む問い合わせを管理する。
- Plusアカウントは、確認したメール1つにつき1つとする。保護者のメールで子どものPlusを管理できるが、同じメールの1アカウントを兄弟姉妹ごとの別アカウントとして扱うことはできない。子どもごとに利用権、AI回数、無料体験を分ける家族機能は将来の別仕様とする。
- 子どもへ、保護者のメールやカードのパスワードを渡すよう案内しない。
- 初期版では、子どもの氏名、生年月日、血糖値、表示名、CGMの種類を保護者確認で集めない。年齢や保護者関係を血糖情報などから推測しない。
- コード送信前に、購入を管理する人が18歳以上であることを本人・保護者のどちらでも明示確認する。保護者の場合は、子どものための購入・復旧・問い合わせを管理することも別に確認する。
- 同じメールで一度確認した本人・保護者の役割は、別のコードで勝手に変更しない。変更が必要な時は問い合わせで確認する。
- 1人が複数の本人用メールを持つことは技術だけでは完全に見分けられない。「別のメールで無料体験を繰り返さない」という利用条件を明示し、見分けられると過大に案内しない。
- 確認できない場合も、現在血糖や基本グラフなどのFree機能はそのまま使えると案内する。

購入前の短い案内候補：

> 購入やメールを管理する人が18歳以上であることを確認します。子どもが使う時は、18歳以上の保護者が購入・復旧・問い合わせを管理します。子どもの名前、生年月日、血糖値は入力しません。1つのメールで管理できるPlusアカウントは1つです。Plusを購入しなくても、血糖値を見る基本機能は使えます。

### アカウント削除とShare Studio無料体験の再取得

- 購入記録がなく、Share Studio無料体験も使っていないアカウントは、全session、短命な確認記録、無料体験状態、アカウント識別子を削除する。同じメールで新しいアカウントを作り直せる。
- Share Studio無料体験を成功まで使った後にアカウントを削除する場合は、体験を成功した日から90日間だけ、メールの元に戻せない照合用HMAC、`trial_used`、自動削除に必要な期限だけを別の不正防止記録として残す。完全なメール、血糖値、表示名、CGM情報、AI本文、作成画像、購入情報は残さない。90日を過ぎた記録は自動削除する。
- この90日内も同じメールでアカウントを作り直せるが、Share Studio無料体験はもう一度使えない。90日より前に成功した体験、または体験を使っていない削除では、この照合記録を残さない。削除画面で、残す内容、理由、消える日を隠さず説明する。
- 90日記録にも鍵versionを持たせ、メールHMACのcurrent＋previous鍵更新時に、同じ体験記録を保ったまま原子的に更新する。鍵設定が不完全、versionが不明、旧・新HMACに別の記録がある場合は、無料体験を新しく付けず安全に停止する。この記録をログイン、連絡、購入者の追跡、別サービスの照合には使わない。
- 別のメールで体験を繰り返すことは利用条件で禁止するが、技術で「1人」を完全に見分けられるとは案内しない。
- 購入または未解決の支払いがあるアカウントは、現在の自動削除routeで「削除できた」と見せず、問い合わせへ案内する。全sessionの失効、Plus停止、返金の扱い、残す最小の購入記録、アカウントとの結び付きを外す日を本人へ確認してから処理する。削除だけで自動返金になるとは案内しない。

この90日ルールは販売前の方針候補であり、まだ実装していない。現状の完全削除では無料体験が新しくなるため、90日記録の実装、期限削除、同じメールでの再登録、公開説明の受け入れテストが通るまで販売ブロッカーとする。

## 9. Stripe実装方針

- Stripeが提供するホスト型Checkoutを使い、GlucoScope内にカード入力欄を作らない。
- 300円の1回払いの商品として作り、Subscriptionや自動更新を使わない。
- Checkout Sessionはサーバー側だけで作成する。
- Checkoutは1回払いの`payment` modeを使い、利用できる支払方法をコードでカードだけに固定しない。定期課金のPrice、Subscription、支払方法の将来利用を購入条件にしない。
- 利用権の付与は、成功ページを開いたことではなく、Stripeの署名付きWebhookで決済成功を確認して行う。
- Webhookの署名を検証し、同じeventやSessionを複数回処理しても利用権が重複しないようにする。
- APIキーとWebhook SecretはCloudflare Secretに保存し、Git、ブラウザ、URL、ログへ出さない。
- 可能な範囲で権限を絞ったStripeキーを使う。
- 自動税計算は、必要な登録国・地域と会計上の扱いを確認してから有効にする。Stripeアカウントがあるだけでは税登録済みとみなさない。
- Stripe Taxに対象地域の有効な登録が`Collecting`として存在すること、現在の正式一覧から選んだ商品税コード、Priceの税の扱い、事業者所在地、購入者所在地の取り扱いを確認できるまで、`automatic_tax`を有効にしない。登録や商品税コードをコードから推測・自動作成しない。
- 税を含めて最終支払額を300円にするのか、税が別に加わるのかは未決定である。購入前画面、Stripe Checkout、領収書の金額表示を一致させるまで販売しない。未確認のまま「税込」「税別」「税不要」と断定しない。
- 将来Stripe Taxを使う場合も、税務上の登録義務は運営者と税務の専門家が確認し、Stripe上の登録を追加・期限切れにする操作は自動化しない。
- 決済、Webhook、利用権WorkerはAI、Usage、Relay、管理者ダッシュボードと分け、障害時もCGM表示を止めない。

## 10. 集計画面の境界

公開Usage Dashboardには、利用記録に同意した端末プロフィールの全体集計だけを表示する。対象は前日までの完了した30日間とし、活動した端末プロフィールが10件以上の時だけ、活動した端末プロフィール数、利用日数の合計、成功した新規AI分析の合計、通常のグルコの想い出の合計を表示する。10件未満では実数をレスポンスにも含めない。表示名、メール、profile ID、account ID、端末別・日別の明細は表示しない。

認証付きの「利用者の利用状況」には、端末プロフィール、記録中、停止中に加え、有効なPlusアカウント数を上段の合計として表示する。各プロフィールへPlus状態を結び付けず、誰が購入したかは表示しない。

## 11. 返金と問い合わせ

返金は、子どもや高齢者にも分かるよう、細かい時間条件を並べず、次の短いルールとする。この運営方針は運営者本人が承認済みだが、公開文面と実際の受付方法を確認するまで販売は開始しない。

> 二重に支払われた時や、お支払い後もPlusを始められない時は、状況を確認して直します。こちらで直せない場合は、全額返金します。GlucoScope側の大きな障害で、Plusの主な機能をほとんど使えず、こちらでも解決できない場合も、状況を確認して全額返金します。部分返金は行いません。返金したPlusは終了します。カード明細への反映は、カード会社や銀行により通常5〜10営業日ほどかかる場合があります。

「大きな障害」を分単位・時間単位のSLAや長い除外一覧にはしない。Plusの主要特典をほとんど利用できなかったことと、運営側でも復旧できなかったことを、問い合わせごとに確認する。それ以外の相談も受け付けて個別に対応するが、利用者都合を含むすべての申出を同じ返金対象とは案内しない。

Plusは優先医療相談や緊急サポートを含まない。問い合わせで、血糖値、接続URL、合言葉、カード番号、パスワードの送付を求めない。本人確認に必要な最小の購入参照情報だけを案内する。

公開問い合わせ先はまだ決まっていないため、これは販売ブロッカーである。販売前に、ログインできない人も開ける公開ページへ、返金を希望する時の連絡先と返答までの目安を置く。問い合わせ番号など、カード番号や血糖情報を送らずに状況を確認できる短い参照情報を用意する。メールアドレス、Stripe参照ID、問い合わせ内容の保存期間と削除方法も販売前に決める。

### 購入記録の最小保持候補

購入記録は、アカウントの復旧や問い合わせに使う結び付きと、会計・返金・異議申立てのために残す最小記録を分ける。血糖値、グラフ、CGM接続情報、AI本文、表示名、カード番号、完全なメールアドレスは、どちらにも入れない。

- 会計上の最小記録は、商品、金額、通貨、支払い・返金の状態と日時、Plusの対象期間、Stripeの取引を照合する参照番号だけとする。販売前の保持候補は7年だが、これはすべての運営形態に同じ法定期間だという断定ではない。個人・法人の区分、帳簿の種類、電子取引の扱いを税務・法務の専門家に確認し、必要な期間へ確定するまで販売しない。
- 復旧や問い合わせのため、購入記録をメール照合HMACとアカウントへ結び付ける期間は、有効なPlus、未完了の支払い、返金、異議申立て、本人確認中の問い合わせがある間だけ延長できる。それらがすべて終わった後は、最後の支払いまたは最終解決の遅い方から180日以内に結び付きを外す。
- 結び付きを外した後の会計記録は、ログイン、Plus復旧、Share Studio無料体験の判定、通常の利用状況画面に使わない。Stripe参照番号を含むため「完全に匿名」とは案内せず、会計・監査・返金の確認に用途を限定する。
- 未解決の返金や異議申立てがある間は、解決に必要な結び付きを残せる。解決後は新しい期限を明示し、期限切れを定期的に削除または切り離す。将来の役に立つかもしれないという理由だけで延長しない。

この7年と180日は販売前の最小安全候補であり、法務・税務判断そのものではない。個人情報は利用目的に必要な期間だけ保持し、必要がなくなった時は遅滞なく消す原則と、運営者に適用される帳簿・電子取引の保存義務を販売前に照合する。

販売前に最新版を再確認する公的資料：

- 消費者庁「成年年齢引下げについて」：日本の成年年齢は2022年4月1日から18歳。https://www.caa.go.jp/policies/policy/consumer_education/consumer_education/lower_the_age_of_adulthood/introduction
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」：利用目的に必要な保存期間を定め、必要がなくなった時は遅滞なく消去する努力義務を確認する。https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
- 国税庁「帳簿書類等の保存期間及び保存方法」および「記帳や帳簿等保存・青色申告」：運営形態や帳簿の種類によって5年、7年、10年などがあり得るため、7年候補を一律の法定期間と断定しない。https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5930.htm / https://www.nta.go.jp/publication/pamph/koho/kurashi/html/01_2.htm
- 国税庁「電子取引データの保存方法をご確認ください」：オンライン決済を含む電子取引の保存方法も別に確認する。https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/03-7.pdf

## 12. 購入前に見せる短い説明案

次の文面は、税の扱いを決め、利用者が支払う最終額を300円と確認できた場合の案である。税が別に加わる場合は、主ボタンを含むすべての価格表示を、Stripe Checkoutの最終額と一致する表現へ直してから公開する。

> Plus 30日パスは300円の1回払いです。購入した時から30日間、AI分析を1日5回まで使え、グラフのカスタム期間とShare Studioを使えます。自動では更新されません。血糖値を見る基本機能は、Plusに入らなくても使えます。

購入画面では、この説明を折りたたまず、次の順で大きく表示する。

1. `300円・1回だけのお支払い`
2. `購入できた時から30日間`
3. `自動更新はありません`
4. `AI分析は成功した時だけ1日5回まで。カスタム期間とShare Studioも使えます`
5. `血糖値を見る基本機能は、購入しなくても使えます`
6. `Plusは医療サービスではなく、診断や治療の判断はしません`

主ボタンは「300円で30日パスを購入する」、戻るボタンは「今は購入しない」とする。「購読する」「サブスクを始める」「無料期間」など、自動更新と誤解しやすい言葉を使わない。購入を急かす残り時間、在庫表示、血糖値を理由にした勧誘は表示しない。

決済後の状態別案内候補：

- 確認中：`お支払いを確認しています。もう一度購入せず、このままお待ちください。血糖値を見る機能は使えます。`
- 完了：`Plusを使えるようになりました。終了は○月○日 ○時です。自動では更新されません。`
- 未完了：`お支払いは完了していません。Plusは始まっていません。料金が発生しているように見える時は、お問い合わせから確認できます。`
- 復旧：`購入した時に確認したメールで、Plusをこの端末へ戻せます。`

期限切れ時の案内案：

> Plusの30日間が終わりました。血糖値や基本グラフは、これまでどおり見られます。もう一度使いたい時だけ、新しい30日パスを選べます。自動で料金が発生することはありません。

## 13. 販売開始前に残る決定事項

1. Resendで認証済みの `auth.glucoscope.app` と公式テスト宛先による受理・`delivered`確認は完了した。開封・クリック追跡を無効にしたまま、次は少人数の本人受信箱、Turnstileを含む復旧、配信失敗時の手順、Privacy Notesの説明を受け入れる。無料枠、通常最長30日の保持、Suppression Listへ30日を超えて残り得る例外、原因解決後に手動削除する運用を本人受信箱への送信前に再確認する
2. 18歳以上の本人または保護者をコード送信前に確認し、確認した役割と版をCheckout前にサーバー側で照合する実環境受け入れ。兄弟姉妹を分ける家族機能は将来の別仕様とする
3. 決定済みの全額返金方針を実行できる受付手順、公開問い合わせ先、返答までの目安
4. 二重購入と「決済成功・利用権なし」の自動復旧・確認手順
5. Stripeの事業者表示、領収書、必要な取引条件表示
6. 300円を税込の最終支払額にするか、税を別にするか、税登録と商品税コード
7. GlucoScope側の大きな障害を確認し、解決できない時に全額返金する運用手順
8. 会計記録7年・アカウント結び付き最大180日の候補を、運営形態に適用される法務・税務要件へ確定し、期限削除・切り離し・訂正を自動確認する方法
9. 公開Usage Dashboardの10件基準を、実利用が増えた後も定期的に見直す手順
10. 利用状況記録を停止した人へ、AI上限のための必要最小限の成功回数を別記録する説明と確認
11. account削除後、成功したShare Studio無料体験から90日だけ最小HMAC記録を残す実装、同じメールでの再登録、期限削除、公開説明
12. メールHMAC旧鍵の安全な廃止、認証routeの全体rate limit、challenge保持データの定期削除手順

## 14. GO条件

- Free 1回/日、Plus 5回/日をサーバー側で原子的に予約・確定・解除できる
- 文書チェック、通信失敗、Turnstile失敗、保存済み再表示を回数へ含めない実行型テストがある
- 同時実行、二重応答、期限切れ予約で上限を超えないテストがある
- カスタム期間とShare Studioの権限をサーバー側の利用権で確認する
- Share Studio無料体験を成功時だけ1回消費し、二重消費しない
- Freeの基本機能を誤って止めない自動テストがある
- 利用状況記録の停止中もFree AIの上限確認だけは動き、任意analyticsへは送られず、プロフィール削除後はAIだけが安全に止まるテストがある
- Webhook署名検証と冪等処理のテストがある
- 購入、期限切れ、再購入、返金、削除、復旧の実行型テストがある
- 決済失敗や利用権障害でもCGM表示と接続が継続する
- Privacy Notes、Support Policy、購入画面、返金案内が同じ内容になっている
- コード送信前に、本人・保護者の役割と「管理する人は18歳以上」を確認し、保護者では購入・復旧・問い合わせを管理する確認も必須にする。確認がない、版が古い、役割が競合する時はCheckoutを作らず、Freeを止めないテストがある
- 1つのメールを兄弟姉妹ごとの別アカウントへ分ける機能は、子どもごとの利用権、復旧、AI回数、無料体験を分ける家族機能の受け入れまで提供しない
- Share Studio無料体験の成功後にアカウントを削除しても、成功日から90日以内の同じメールでは再体験できず、再登録とFree利用はできる。90日後は照合記録が自動削除される実行型テストがある
- 90日体験記録のHMAC鍵更新で使用済み状態を失わず、鍵設定不備や新旧記録の衝突では再体験を許さず停止する実行型テストがある
- 購入記録のあるアカウント削除では、sessionとPlus停止、返金の扱い、最小会計記録、アカウント結び付きの解除を確認し、未解決時に完全削除を装わないテストがある
- 会計記録の保持期間とアカウント結び付き最大180日の候補を専門家確認で確定し、期限後の削除・切り離しが実行型テストで固定されている
- 実カード情報やSecretをログ・Git・ブラウザへ出さない確認がある
- Stripeテストモードで少額決済、返金、二重Webhook、期限切れを本番相当環境で受け入れている
- 公開前に価格と税の表記を専門家または利用する決済・会計手順で確認している
- Resendへ送る内容が宛先アドレス、10分で無効になる6桁コード、短い固定の入力案内だけであり、血糖値、氏名、表示名、接続情報、AI本文、購入情報を含まないテストがある
- 開封・クリック追跡が無効で、月3,000通・1日100通より低い運営上の全体送信上限、配信失敗時の手順、通常最長30日の保持とSuppression Listへより長く残る例外の公開説明、原因解決後に手動削除する運用を実環境で受け入れている
- 確認コードの一時記録を期限後24時間超、全体送信予約を送信試行後24時間超で削除する毎時cleanupを、停止flag、本番で使うD1 binding、失敗時の再確認とともに実環境で受け入れている
- Resendの受理と実際の受信箱到着を分けて確認し、bounce率とspam complaint率を日次確認して閾値へ近づく前に送信を止める手順、実アカウントのUsageと応答headerへ従う手順を受け入れている

### Stripeテストモード受け入れ項目

- CheckoutがJPY 300の1回払いとして表示され、Subscription、自動更新、将来の定期請求を作らない
- 購入前の認証済みアカウントと、Webhookから利用権を受け取るアカウントが一致する
- 正しい署名のWebhookだけを受け入れ、署名なし、改ざん、期限外のWebhookを拒否する
- 成功ページを直接開いただけでは利用権を付けず、支払い未完了、失敗、キャンセル、期限切れSessionでも付けない
- 支払いが遅れて成功した場合は正しい決済時刻から30日を付け、画面を閉じても復旧できる
- 同じevent、Checkout Session、支払い通知の再送、順序逆転、並行処理で利用権を重複付与しない
- 購入ボタンの連打、複数タブ、古いCheckout Session、有効期間中の再購入で、重複請求や重なる30日を作らない
- 「決済確認中」の間は再購入を促さず、後から成功または失敗へ安全に確定する
- 別端末とブラウザ保存削除後に、確認済みメールで同じPlusを復旧でき、別人へ復旧できない
- サーバー時刻の期限直前・期限ちょうど・期限後を確認し、期限後に自動請求せずFreeへ安全に戻る
- 全額返金、一部返金、異議申立て、二重決済について、決定した方針どおりに利用権と案内が変わる
- 税登録がないテスト環境では`automatic_tax`が無効である。将来有効にする場合は、対象地域の登録が`Collecting`であること、正式な商品税コードと税の扱い、Checkout最終額、領収書を別々に確認する
- 購入画面、Checkout、完了画面、領収書で、価格、1回払い、30日、自動更新なし、税の表示が一致する
- カード番号とSecretをGlucoScopeのブラウザやログへ出さない。メールと決済参照IDは必要な認証・購入・問い合わせ画面だけで扱い、URLや不要なログへ出さない。血糖値、接続情報、AI本文は決済経路へ入れない
- 18歳以上の本人と保護者（高齢者を含む）の実機確認で、役割確認、「今は購入しない」「確認中」「完了」「期限切れ」「問い合わせ」を一人で見つけられる。確認できない時もFreeを続けられる
- 決済、メール、利用権、問い合わせのどこかが失敗しても、現在血糖と基本グラフを止めない

## 15. 2026年8月15〜16日のローカル／停止中stagingチェックポイント

- commit `b5669df` のPlus利用権専用Workerを、公開しない停止中stagingとしてCloudflareへ配置した。`glucoscope-plus-entitlement-staging` のVersion `bbc6c159-ce64-4fbf-a120-a43f9c5ca5d9`へ100%を向けているが、`workers_dev=false`で実URLは`404`、preview URL、route、Cronはなく、observabilityも無効である。Secretは0件で、アカウント認証、cleanup、RPC、購入、Checkout、Webhook、販売準備、税確認のflagはすべて`false`のままである。これは公開や販売ではない。
- APACのstaging専用D1 `glucoscope-plus-staging` にmigration `0001`〜`0005`を適用し、12個のapplication tableがすべて0件であることをデプロイ後に確認した。request-codeとverifyのrate limitは将来の本番用IDと重ならないstaging専用IDを使う。認証flagが`false`のため、現在これらのbindingは利用されない。
- その後、localhostだけに限定した一時的なremote previewで、古い行と新しい行の合成データを使って受け入れ確認した。cleanupは古い行だけを削除し、新しい行を残した。request-codeは安全な`503`の後に専用上限の`429`、verifyは`400`の後に別の専用上限の`429`を確認した。無効な仮Turnstile値とResend値により、外部providerやメール送信は呼ばれていない。previewを停止し、既知の合成行をすべて削除した後、12個のapplication tableが再びすべて0件になった。公開経路、実メール、Secretは使っていない。
- 6桁の確認コードと、タブ内メモリだけで扱う256-bitの`verificationGrant`で同じメールへ復旧するアカウント認証、sessionの総入れ替え、ログアウト、購入記録がないアカウントの削除をローカル実装した。完全なメールはD1へ保存せず、元に戻せない照合用HMACだけを扱う。current＋previous鍵による同一accountの原子的なrekeyと、設定不備・重複account時の停止も実SQLiteで確認した。Cloudflare Email Service用の未接続試作をResend REST API用の停止中adapterへ置き換えた。stagingのD1 bindingだけを接続し、Resend API key、Turnstile/HMAC Secretは未接続である。
- 同日、運営者は `glucoscope.app` を年間14.20米ドルで取得し、自動更新をオフにした。確認メールの送信元は `no-reply@auth.glucoscope.app`、送信候補はResend Freeとする。月額5米ドルのCloudflare Email Service / Workers Paidは契約しておらず、月額請求はない。Resendの無料枠は同日時点で月3,000通、1日100通、送信ドメイン1つ、月額0米ドルで、通常の送信記録とメール本文は最長30日保持される。hard bounceまたは迷惑メール報告の宛先は、原因を確認・解決した後に運営者が手動で削除するまで、チーム全体のSuppression Listへ30日を超えて残る場合がある。メールには宛先、10分で無効になる6桁コード、短い固定の入力案内だけを使い、開封・クリック追跡を使わない。`auth.glucoscope.app` はResendで送信元認証済みで、必要なSPF、DKIM、MX、DMARCの4件をCloudflare DNSへ手動追加し、公開DNSでも確認した。受信機能と追跡は無効である。rolling 24時間で80件までの全体送信予約上限をD1で原子的に確保する基盤も追加し、pending、sent、failedのすべてを消費として扱う。確認コードの一時記録は期限後24時間超、全体送信予約は作成後24時間超で消す毎時cleanupを追加したが、checked-inのcleanup flagは停止中で、stagingにもCronはない。8月15日時点ではstagingのD1 bindingだけを接続し、Resend API keyと関連Worker Secretは未接続で、メールは送っていなかった。
- 2026年8月16日JST、localhostからprivate service bindingだけを通す1通限定の非公開受け入れを行った。個人の宛先ではなくResend公式の配信成功テスト宛先を使い、Resendで1通の受理と`delivered`を確認した。これはWorkerからResendまでとResendのテスト配信の確認であり、本人受信箱やTurnstileを含むE2E受け入れではない。試験で作成したchallengeと送信予約の行は特定して削除し、12個のapplication tableがすべて0件へ戻ったことを確認した。試験後は停止Version `bbc6c159-ce64-4fbf-a120-a43f9c5ca5d9`へ通信の100%を戻した。公開route、preview URL、Cronはなく、公開アカウント画面とPlus販売は試験中も試験後も停止したままである。
- この受け入れで、Cloudflare Workers runtimeではResendへの`fetch`に `redirect: "error"` を指定すると`TypeError`になり、送信を完了できない相互運用上の問題が分かった。adapterは `redirect: "manual"` へ変更し、`3xx`を追跡せず拒否する。これによりAuthorization headerと本文をredirect先へ転送しない。`302`と`307`の実行型テストでこの境界を固定した。
- Free 1回/日、Plus 5回/日のAI成功回数について、10分の予約、成功確定、失敗解除、重複防止、90日削除の基盤を追加した。個人上限のフラグは停止中である。
- カスタム期間とShare Studioの共通権限判定を追加した。制限フラグは停止中のため、現在のカスタム期間の動作は変わらない。Share Studio画面と体験消費の本番接続はまだない。
- 管理者画面は、将来のPlus内部サービスから有効なPlusアカウント合計だけを受け取れる。未接続や失敗を0件に見せず「確認できません」とする。
- 公開Usage Dashboard候補は、前日までの完了した30日間に活動した端末プロフィールが10件以上になった時だけ全体の実数を表示する。10件未満のレスポンスには実数を入れない。
- Stripe test mode専用のローカルadapterを追加した。CheckoutはJPY 300の`mode=payment`だけを作り、`payment_method_types`、`automatic_tax`、Subscriptionをコードから指定しない。raw bodyのWebhook署名を確認した後、Checkout Session、Price、Product、支払い状態、test mode、アカウント対応をStripeへ再取得して検証し、成功時だけ既存の利用権処理へ渡す。成功した一部・全額返金では利用権を`refunded`へ変更し、二重通知でも重複処理しない実行型SQLiteテストを追加した。購入、Checkout HTTP、Webhookのflagはすべて停止中で、Stripe ID、API key、Webhook Secretは接続していない。staging D1が接続済みでも決済経路は始まらない。
- Checkoutには、販売準備を示す独立した停止ゲートも追加した。最終支払総額の扱い、購入者条件、版付き規約、特定商取引法に基づく表記、返金方針、問い合わせ先の同一サイト公開先がすべて確定しない限り、認証、D1、Stripeへ触れる前に停止する。checked-in設定は未確定・空欄・停止のままである。
- 18歳以上の本人または保護者を明示確認する非公開基盤を追加した。確認した役割、確認版、時刻だけをアカウントへ保存し、子どもの氏名、生年月日、血糖値、表示名は収集しない。同じメールの役割変更は停止し、Checkout前にサーバー側で現在版を照合する。1メールは1 Plusアカウントのため、兄弟姉妹を別々に管理する家族機能は将来対応とする。関連flagはすべて停止中である。

これは販売開始や本番制限の完了ではない。公開デモから個人上限を回避できない仕組み、本人受信箱とTurnstileを含む本人確認・復旧のE2E受け入れ、返金規約、税、領収書、サポート、実際のStripe test mode・複数タブ・返金の受け入れ、本番環境と公開順の受け入れが残っている。

## 16. English summary

GlucoScope Plus is a proposed JPY 300 one-time pass for 30 consecutive days. It never renews automatically. Free users keep the core glucose experience, one successful new AI analysis per JST day, and one successful Share Studio trial per verified account. An active Plus account receives up to five successful new AI analyses per JST day, custom graph dates, and continued Share Studio use. Quality-check failures, provider or network failures, Turnstile failures, global-limit failures, aborted work, and browser-local cache hits do not consume an AI use. Plus remains separate from optional donations and the browser Usage profile. The adult managing the purchase and email must be 18 or older. They may act for themselves or as a guardian managing a child's purchase, recovery, and support. This confirmation collects no child name, birth date, display name, glucose value, or CGM type. One verified email maps to one Plus account; separating siblings under one mailbox requires a future family feature. The verified buyer role and confirmation version are stored on the account and checked again on the server before Checkout; a later code cannot silently change the role. Payment data stays on Stripe-hosted Checkout, and verified idempotent webhooks are required before granting an entitlement. Verification email is planned through Resend Free from `auth.glucoscope.app`. The provider receives the destination address; the message contains a six-digit code that expires after 10 minutes and short fixed input instructions. It contains no glucose, name, connection, AI, or purchase content, and open/click tracking stays off. Resend may retain ordinary sending records and message bodies for up to 30 days. A hard-bounce or spam-complaint destination can remain longer on the team-wide Suppression List until the cause is resolved and the operator removes it manually. GlucoScope's disabled hourly cleanup deletes verification challenges more than 24 hours after code expiry and global send reservations more than 24 hours after the attempt; the hourly interval makes this about 24 to 25 hours. Verified-account and purchase/accounting retention remains separately unresolved. An API `200` or `email.sent` is provider acceptance, not inbox-delivery proof. Daily operating review keeps bounce below 4% and spam complaints below 0.08%, while the real account Usage page and response rate-limit headers take precedence over any fixed per-second number in this specification. Cloudflare Email Service / Workers Paid is not subscribed. If a duplicate charge or a paid pass that did not start cannot be corrected, or a major GlucoScope-side outage made the main Plus features mostly unusable and cannot be resolved, the approved policy is a full refund after review; it is not an all-reasons refund promise. Plus is not available for purchase until email delivery, provider-retention acceptance, the public refund-support process, tax, privacy, professional review, and production acceptance are complete.

Code checkpoint `b5669df` is deployed only as a stopped, non-public staging Worker. Version `bbc6c159-ce64-4fbf-a120-a43f9c5ca5d9` receives 100% of that Worker, but it has no `workers.dev` route, preview, custom route, Cron, observability, or exposed closed-test Secrets; its live URL returns `404`, and every account, cleanup, RPC, purchase, Checkout, webhook, sales, and tax flag is false. The dedicated APAC staging D1 has migrations `0001`–`0005` applied and all 12 application tables at zero rows. Staging rate-limit IDs are distinct from the future production IDs. Public accounts and sales remain no-go.

A temporary localhost-only remote preview then used synthetic old and fresh rows. Cleanup removed only the old rows; request-code returned a safe `503` before `429`, and verify returned `400` before `429`. Invalid placeholder Turnstile and Resend values prevented provider or email calls. The preview was stopped, all known synthetic rows were deleted, and all 12 application tables returned to zero. No public route, real email, or Secret was used.

On 2026-08-16 JST, a separate one-message closed acceptance reached staging only from localhost through a private service binding. It used Resend's official delivered test recipient rather than a personal destination. Resend accepted the message and reported it delivered. This proves only the Worker-to-Resend request and Resend test-delivery path; personal-inbox delivery and Turnstile end-to-end acceptance remain pending. The exact temporary D1 rows were deleted, all 12 application tables returned to zero, and stopped Version `bbc6c159-ce64-4fbf-a120-a43f9c5ca5d9` was restored to 100%. No public route, preview URL, or Cron exists, and public account UI and sales stayed off. The acceptance also found that Cloudflare Workers throws `TypeError` for the adapter's former `redirect: "error"` fetch option. The adapter now uses `redirect: "manual"` and rejects all `3xx` without forwarding Authorization or the request body to a redirect destination; focused tests cover `302` and `307`.
