# GlucoScope 最初のお知らせ・Plus同時公開手順

Status: paid core accepted / reliability fix deployed / iPhone Share Studio retest pending / first announcement held

Last reviewed: 2026-08-23 JST

## 1. 今回の公開範囲

今回の公開は、すでに小規模な一般提供中のGlucoScopeとPlus 30日パスについて、最終課金テスト後に最初のお知らせを行うことを指す。

- Plusは400円の1回払い、支払い確認から連続30日間、自動更新なし。
- Freeの現在血糖、今日・昨日のグラフ、1日1回のやさしい分析は維持する。
- Plusは7日・30日・カスタム、しっかり分析、通常画面とShare Studioで共有する1日合計5回までの成功AI分析、Share Studioの継続利用を提供する。失敗と保存済み表示は回数に含めない。
- Glurooの限定中継を、承認済みの少人数より広げない。
- 管理者Dashboardと管理者Share Studioを公開しない。
- 公開デモ、Nightscout直接接続、Free表示は、Plus障害から独立して使える状態を維持する。

## 2. 最終課金テストの合格条件

運営者本人が、個人情報や決済参照IDを公開記録へ残さず、次を画面で確認する。

1. Checkoutが「GlucoScope Plus 30日パス」、400円、1回払いとして表示され、自動更新・Subscriptionがない。
2. 支払い後にPlusが有効になり、終了日時と「自動更新なし」を確認できる。
3. 7日・30日・カスタム期間を開ける。
4. しっかり分析のグルコのお話し、AIお手紙、ChatGPTに相談を利用できる。
5. 無料体験を使った後でも、Share Studioで新しい4枚セットを作り、端末へ保存できる。
6. 再読込後も、残り期間を重ねず同じPlusを確認できる。同じメールでの復旧は既に本番受入済みのため、この最終テストで繰り返さない。
7. Stripeの支払確認メールまたは領収書が届き、400円、現在の商品名、公開問い合わせ先が一致する。

2026年8月23日、支払い、Plus開始、終了日時、自動更新なし、再読込後の維持、7日・30日・カスタム、しっかり分析、Stripe領収書は実機で合格した。Share Studioは4枚生成には成功したが、5回中2回で失敗表示が出たため、最初のお知らせは保留する。AI Worker Version `5b0a2593-ec64-4c7e-9129-60e0deb51762`へ最終書き直しを100%反映し、bindings、runtime、handlersが直前Versionと一致すること、usage `200`、正しいpreflight `204`、不正OriginとOriginなしPOST `403`を確認した。終了日時の強調に加え、Plusの通常AIとShare Studioを別々の成功5回枠として表示・強制し、同じiPhoneで連続生成を再確認してから合格とする。個人の終了日時、メール、決済参照、血糖値はこの記録へ残さない。

途中で二重購入を促す、支払い済みなのにPlusが始まらない、期限が30日より不自然に長い、基本の血糖表示が止まる、または上の特典のどれかが使えない場合は公開を止める。

## 3. 公開直前の読み取り確認

1. `main`、`origin/main`、GitHub Pagesの配信commitが一致し、Pages build、custom domain、HTTPS強制が正常である。
2. Plus、Usage、AI Workerのactive Versionを再取得し、PROJECT_BIBLEとREADMEのcurrent snapshot、binding、Secret名、D1、service binding、flag、Cronにdriftがない。
3. `https://plus.glucoscope.app`は、正しいOriginのpreflightだけを許可し、未認証sessionを`401`、不正Originを`403`、全応答を`no-store`にする。
4. 販売条件、Plus利用条件、Privacy、問い合わせ・返金ページが`200`で、400円、1回払い、30日、自動更新なし、日本国内、18歳以上の本人または保護者、免税事業者、公開問い合わせ先を同じ内容で示す。
5. Stripe Dashboardでは、今回の支払いが1件だけ成功し、Subscriptionを作らず、Webhookと利用権が同じ購入へ一度だけ対応していることを確認する。
6. Resendとsupport受信箱に異常なbounce、complaint、suppression、未解決の不達がないことを確認する。

Secret値、メールアドレス、確認コード、Stripe ID、カード情報、血糖値、接続URL・合言葉は、コマンド出力、Git、公開文書、スクリーンショットへ残さない。

## 4. 公開変更

Share Studioの再確認前に必要な不具合修正だけは、AI Workerをlive-compatibleな新Versionへ段階反映してよい。公開中Versionとの差分がコードだけで、plain vars、Secret名、Durable Object、KV、service binding、compatibility date、migrationが一致することを配信前に機械確認する。失敗時は直前の通常動作Versionへ100%を戻す。Pagesは同じ修正commitを公開し、最初のお知らせの文面変更は実機再確認後まで行わない。

1. Roadmapの「最初のお知らせへ進みます」を、最初のお知らせを開始した現在形へ更新する。
2. README、PROJECT_BIBLE、Plus仕様へ、合格日、確認範囲、Pages commit、当日のcurrent Versionと直接rollbackを記録する。
3. データ接続の「先行体験」表記は維持する。限定中継を広げたとは案内しない。
4. 特定商取引法に基づく表記、Plus利用条件、Plus問い合わせは購入画面から誰でも開ける状態を維持する。現在の`noindex,nofollow`方針は、別の検索公開判断を行うまで変更しない。
5. 対象ファイルだけをstageし、秘密情報の差分検索、JavaScript構文確認、全テスト、`git diff --check`を通してから`main`へfast-forwardでpushする。
6. Pages build後、iPhone Safariとホーム画面アイコンで、トップ、購入案内、販売条件、利用条件、Privacy、問い合わせの上端とリンクを確認する。

## 5. 切り戻し

操作前にCloudflareからactive Versionを再取得し、次の記録がまだcurrentであることを機械確認する。IDが変わっている場合は、この文書だけで操作しない。

- Plusの通常動作rollback: `b584808c-0f63-4d18-8970-964dfec62212`
- Plusの緊急停止: `6faa0065-8fdd-4563-985e-9e775999717b`
- Usageの直接rollback: `e745f53a-aea0-427e-8421-278d3549e30d`
- AIの通常動作rollback: `ef238ad4-7dc7-4b79-bb92-b9c93605c6c3`
- AIの緊急停止: `46f44888-002b-4847-8553-5cd12e3d7ac5`

公開文面だけの問題は、Workerを動かさずPagesの直前commitへ戻す。決済・Webhook・利用権の問題は新しいCheckoutを停止し、Free表示を維持する。D1を直接編集して帳尻を合わせず、返金は返金・問い合わせ運用手順に従う。限定中継は今回の公開で変更しない。

## 6. 公開後24時間

- 新しいCheckout、支払い成功、Webhook、Plus開始が1対1であることを匿名集計だけで確認する。
- Plus特典の失敗、二重購入、確認メール不達、返金、異議申立て、support受信を確認する。
- AIの個人上限と全体費用停止、Share Studio、CGM表示の独立性を監視する。
- 解決できない決済、メール、利用権、主要特典の障害が見つかった時は、新しいCheckoutを止めてから原因を調べる。
- 問題がなければ、最初のお知らせの結果と残る少人数運用項目をPROJECT_BIBLEへ記録する。
