> このリポジトリは [projects-shelf/Book](https://github.com/projects-shelf/Book)（作者: [PepperCat](https://github.com/PepperCat-YamanekoVillage)、MITライセンス）を自宅PCでセルフホストするために取り込み、Windows ネイティブの単一 exe として作り替えたフォークです。
> 解説記事（上流）: [セルフホストできる軽量な電子書籍配信サーバーをつくった](https://yamanekovillage.com/articles/shelf_book/)
> 上流の取り込み時点は git タグ `upstream-import` で参照できます。

# shelf | Book（自宅PC向けフォーク）

漫画・電子書籍（CBZ / CBR / EPUB / PDF）を LAN 内の iPhone などから読むための軽量サーバー。
Go の単一 exe にフロントエンドを埋め込んであり、Docker も nginx もデータベースも不要です。メモリ使用量は 15〜20 MB。

## 使う（Windows）

ビルド済みなら、常設フォルダへの配置・本の移動・自動起動登録を 1 コマンドで行えます。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Target D:\ShelfBook -BooksFrom <今の本のフォルダ> -Autostart
```

手動で置く場合:

1. `dist\shelf.exe` の隣に `books\` フォルダを作り、本を入れる（サブフォルダ可。作品ごとにフォルダ分けし、巻はゼロ埋めした番号にしておくと並びが安定します）。
2. `shelf.exe` をダブルクリックで起動。`http://localhost:50080` で本棚が開きます。同じ Wi-Fi の iPhone からは起動ログに出る `http://<PCのIP>:50080` を Safari で開き、共有→ホーム画面に追加。
3. データベースと表紙は隣の `data\` に作られます。本の追加・削除は 10 分ごとに自動で反映されます（すぐ反映したいときは `http://localhost:50080/api/rescan` を開く）。

初回起動時に Windows のセキュリティ警告が出たら「アクセスを許可する」を押してください。閉じてしまった場合や iPhone から繋がらない場合は、管理者 PowerShell で次を実行します（自動作成されたブロック規則を消して、ポートを開けます）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-firewall.ps1
```

ログオン時に自動起動させる（ウィンドウなしの `shelfw.exe` を使用。管理者権限は不要）:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```

解除は `-Remove` を付けて実行。ログは `data\server.log` に出ます。

### ログインと管理画面

- 管理画面 `http://localhost:50080/admin` は、**サーバーを動かしている PC のブラウザからだけ**開けます。初回起動時に自動で開きます。
- **スマホのログイン**: 管理画面に出る QR コードをスマホのカメラで読むと、その端末がログイン済みになります（QR は 5 分で失効、1 回限り）。ログインは端末ごとに 1 年保持され、管理画面の端末一覧から個別にログアウトできます。
- **パスワード（任意）**: 外出先で新しい端末からログインするとき用です。管理画面で設定・変更・削除できます。忘れたら管理画面で設定し直してください。保存されるのはハッシュだけです。
- **ログインが必要な接続**: 公開 URL（Tailscale Funnel、Cloudflare Tunnel など）を通ってきた接続だけです。LAN内/Wi-Fi接続と Tailscale、この PC 自身からはログイン不要（管理画面で変更可。PC 自身は常にログイン不要）。
- 公開 URL を QR コードに載せるには `-public-url https://...` を指定します。
- 自前のリバースプロキシ（nginx など）で公開する場合は、必ず `X-Forwarded-For` を付けてください。付けないと外からの接続が「この PC から」に見え、ログインも管理画面の制限も効きません。

### 家の外から読む（Tailscale）

[Tailscale](https://tailscale.com/) を使うと、自分の端末同士だけを暗号化してつなげます。ポート開放は不要で、他人からは届きません（このサーバーにはログイン機能が無いので、ルーターのポート開放やトンネルでネットに公開するのはやめてください）。

1. PC と iPhone の両方に Tailscale を入れ、同じアカウントでログインする。
2. iPhone の Safari で `http://<PC の名前>:50080` を開いてホーム画面に追加する（PC の名前は Tailscale アプリの端末一覧に出ます）。この URL は家の中でも外でも使えます。
3. iPhone では VPN は同時に 1 つしか使えません。他の VPN アプリをオンにすると Tailscale が切れます。

### 通信量の節約

家の外（Tailscale やインターネット経由）から読むと、漫画のページを自動で縦 1200px・JPEG 画質 70 に縮めて送ります。1 冊あたりの通信量はおよそ半分になります（実測 67 MB → 31 MB）。

- 白黒ページとカラーページはページごとに自動で判定し、カラーはカラーのまま縮めます。
- 巻を開くと、残りのページを裏で先回りして変換し `data\saver` に保存します（1 巻 20 秒ほど、メモリは一時的に 10〜15 MB 増える程度）。素早くめくっても変換待ちになりません。キャッシュは既定で 2 GB までで、古いものから消えます。
- 設定の「画質」で 自動 / クオリティ / セーブ を選べます。自動モードに設定すると、LAN内/Wi-Fi接続では元画像を読み込むクオリティモード、リモート接続では通信量を約半分に抑えるセーブモードになります。
- 画面の部品（JS・CSS・PDF エンジン）は gzip で圧縮して送ります（初回 6.9 MB → 2.7 MB）。

### 設定

フラグまたは環境変数で指定します。既定値は exe の隣の `books` と `data`、ポート 50080。

| フラグ | 環境変数 | 既定値 | 内容 |
|--------|----------|--------|------|
| `-books` | `BOOKS_DIR` | `books` | 本のフォルダ |
| `-data` | `DATA_DIR` | `data` | DB・表紙・ログの保存先 |
| `-port` | `PORT` | 50080 | 待ち受けポート |
| `-scan-interval` | `SCAN_INTERVAL` | 10m | 自動再スキャン間隔（0 で無効） |
| `-page-size` | `PAGE_SIZE` | 20 | 一覧1ページあたりの表示数 |
| `-cover-size` | `COVER_SIZE` | 300 | 表紙サムネイルの短辺(px) |
| `-cover-quality` | `COVER_QUALITY` | 75 | 表紙JPEGの品質 |
| `-saver` | `SAVER` | true | 家の外からのアクセスで漫画のページを縮めて送る |
| `-saver-height` | `SAVER_HEIGHT` | 1200 | 節約モードのページの高さ(px) |
| `-saver-quality` | `SAVER_QUALITY` | 70 | 節約モードの JPEG 品質 |
| `-saver-cache-mb` | `SAVER_CACHE_MB` | 2048 | 節約モードの変換キャッシュの上限(MB) |
| `-public-url` | `PUBLIC_URL` | なし | 公開 URL（ペアリングの QR コードに載せる） |
| `-open-admin` | `OPEN_ADMIN` | true | 初回起動時に管理画面をブラウザで開く |
| `-7z` | `SEVENZIP` | 自動検出 | 7-Zip の実行ファイル（CBR 用） |
| `-log` | `LOG_FILE` | `data\server.log` | ログファイル（`-` でコンソールのみ） |

### 外部ツール

- **CBZ / EPUB**: 不要（Go 標準ライブラリで読みます）
- **CBR**: [7-Zip](https://www.7-zip.org/) が必要。`C:\Program Files\7-Zip\7z.exe` を自動検出します
- **PDF**: 閲覧は不要。表紙とメタデータには poppler の `pdftoppm` / `pdfinfo` が PATH にあれば使います（無ければ表紙なし・ファイル名がタイトルになります）

## 開発する

必要なもの: Go 1.24 以上、Node 22 以上（Bun は使いません）。

```powershell
# 全部ビルド（フロント → exe に埋め込み → dist\shelf.exe, dist\shelfw.exe）
powershell -ExecutionPolicy Bypass -File build.ps1
# フロントを変えていないとき
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipFront
```

バックエンドだけ:

```powershell
cd back
go test ./...
go run . -books ..\books -data ..\data -log -
```

フロントだけ（保存即反映。API は起動中のサーバー `localhost:50080` に転送）:

```powershell
cd front
npm ci
npm run dev          # http://localhost:9000
npm run typecheck
npm test             # Playwright スモークテスト（Chromium / WebKit / iPhone エミュレーション）
```

Playwright は `dist\shelf.exe` を生成したテスト用蔵書（`tests/fixtures/make-library.mjs`）で自動起動して走らせるので、先に `build.ps1` を実行しておきます。稼働中のサーバーに対して走らせる場合は `BASE_URL=http://localhost:50080`。初回は `npx playwright install chromium webkit`。

### API（フロントが使うもの）

| エンドポイント | 内容 |
|----------------|------|
| `GET /api/root/{folder}` | フォルダ直下のサブフォルダと本（`sort`, `order`, `page`） |
| `GET /api/all` | 全冊フラット |
| `GET /api/series` | シリーズ（本が直接入っているフォルダ）の一覧。巻数・読了数付き |
| `GET /api/home` | ホーム用: 読みかけ（シリーズごとに 1 冊）、次の巻、新着（シリーズ単位） |
| `GET /api/search?q=` | タイトル前方一致。`#タグ` でメタデータ検索 |
| `GET /api/neighbors?path=` | 同じフォルダ内の前後の本（次巻ナビ用） |
| `GET /api/progress?path=&position=&progress=` | 読書位置の保存 |
| `GET /api/access?path=` | 最終アクセスの記録 |
| `GET /api/rescan` | 再スキャンを開始 |
| `GET /api/client` | この接続が家の外扱いか（自動画質の判定結果） |
| `GET /api/auth/status`, `POST /api/auth/login`, `/pair`, `/logout` | ログイン状態、パスワードログイン、QR ペアリング、ログアウト |
| `/api/admin/*` | 管理画面用（この PC からのみ。変更系は `X-Shelf-Admin: 1` ヘッダー必須） |
| `GET /api/status` | 冊数、最終スキャン結果 |
| `GET /book/cbz?path=&page=[&q=saver\|original]` / `/book/cbz/pages` | CBZ のページ画像とページ数（CBR も同様）。`q` を省くと接続元で自動判定。応答ヘッダー `X-Shelf-Quality` に実際の画質 |
| `GET /book/epub?path=` / `/book/pdf?path=` | ファイルそのもの（Range 対応） |
| `GET /cover/{path}.jpg` | 表紙 |

## Linux で動かす（任意）

Docker を使う場合は同梱の `Dockerfile` / `docker-compose.yml` で単一コンテナになります（7-Zip と poppler 同梱）。

```shell
mkdir books
docker compose up -d --build
```

方針と作業計画は [ROADMAP.md](./ROADMAP.md) を参照。

---

## 上流について

上流 [projects-shelf/Book](https://github.com/projects-shelf/Book) は Go + SQLite のバックエンドと React のフロントで構成され、Docker で動かす前提でした。このフォークでは以下を変更しています。

- gin、cgo（WebP エンコーダ）、SQLite を外し、標準ライブラリ + x/image だけの純 Go にした（Windows exe を簡単に作れる）。蔵書カタログはメモリ上に持ち `data\library.json` に保存する（SQLite の Go 移植だけで約 40 MB 使っていたため）
- CBZ / EPUB を `archive/zip` で直接読む（7z 呼び出しの空白区切りパースで内部パスにスペースがあると読めなかった問題を根治。ページ配信 200 ms → 2 ms）
- ページと巻を自然順ソート（`v2` < `v10`）
- 表紙生成の失敗を再試行、本の追加・削除を定期スキャンで自動反映、起動即応答
- 次巻ナビ用の `/api/neighbors`
- フロント成果物を exe に埋め込み nginx を廃止

License: MIT（上流のまま）
