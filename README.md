# TOUCHLINE ACADEMY

高校サッカー部の監督として育成・編成・采配・大会・世代交代を楽しむ、日本語のブラウザゲームです。

公開URL: https://touchline-academy.pages.dev

## 遊び方
1. 学校名を決め、練習メニューを選んで1週間進めます。
2. 疲労が高くなったら休養。選手・編成で重点育成1人、先発11人、布陣を指定できます。
3. 試合は15分ごとに戦術・攻守意識を変更。控えを押すと最大3人まで交代できます。
4. 秋の県大会を優勝して冬の全国大会へ。3月終了で3年生が卒業し、新入生6人が加入します。
5. 操作ごとにブラウザ内へ保存。設定からJSONの書き出し・読み込みができます。

## 開発
Node.js 24以降、npmを使用。`npm ci` → `npm run build` → `npm start`。
`npm test` はゲームロジック（10シーズン、育成、保存、試合、世代交代等）を検証します。
`npm run typecheck` は型検証。`npm run test:browser` はPlaywrightでブラウザを検証します。
`npm audit` は開発時依存に3件（miniflare/undici/wrangler経由）残ります。いずれもwranglerに付随する開発用で、配信物 `dist/client` には含まれません。`npm run lint` は既存の指摘が残っています（大半は未使用のUIコンポーネント）。
Cloudflare Pagesの公開対象は `dist/client` だけです。サーバー、Functions、DB、APIキーは不要です。

## 費用・保存
公開はGitHubの`main`へのpushでCloudflare Pagesが自動ビルド・デプロイします（ビルドコマンド `npm run build`、出力 `dist/client`）。手動で公開する場合は `npx wrangler pages deploy dist/client --project-name touchline-academy`。
Cloudflare Pagesの静的配信とpages.devサブドメインを使用。独自ドメインを購入せず、有料契約や外部AI APIをゲーム内で使いません。
静的リクエストは無料・無制限。Freeプランは500ビルド/月、20,000ファイル、1ファイル25MiBなどの条件があります（2026-09-06確認）。
https://developers.cloudflare.com/pages/functions/pricing/
https://developers.cloudflare.com/pages/platform/limits/
セーブはlocalStorageのみ。端末間の自動同期やオンライン対戦はありません。容量削除に備え書き出してください。

## オリジナル制作と権利への配慮
既存ゲームのコード・画像・音声・UI・キャラクター・選手肖像・ロゴを流用していません。選手と学校・大会の設定は架空で、名前の偶然の一致は関係を示しません。
選手画像は組み込みの画像生成機能で制作し、服のマークを除去する編集をしています。生成物の権利保護や第三者権利との非抵触を法的に保証するものではありません。商標の網羅的クリアランスや専門家審査は未実施です。
米国著作権局の一般説明ではゲームのアイデア・遊び方と具体的表現を区別しています。日本を含む各法域の権利を保証する根拠とはしていません。
https://www.copyright.gov/register/tx-games.html
画像プロンプトはASSETS.md、依存パッケージのライセンスはpublic/THIRD_PARTY_NOTICES.txtに記録しています。

## ライセンス
ソースコードはMIT。本作のために制作した `public/players.png` と `public/favicon.svg` はMITの対象外で著作権を留保します。詳細はLICENSEを参照してください。

## 限界
本作はリアル寄りの選手アートを使う監督シミュレーションです。選手の3D直接操作、実在チーム・選手のデータ、音声実況は含みません。ピッチは戦術図です。
試合と日程は独自に簡略化。勝敗は能力、疲労、連携、戦術と乱数で決まります。能力上限は99。記録する年度別履歴は直近20年です。

## 作業の継続条件
現在のCodex利用上限に達したら制作を中断し、リセットや別モデルで回避せず、自動再開もしません。途中経過と残作業はPROGRESS.mdに記録します。
