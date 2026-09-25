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

Playwright は `http://localhost:50080` に対して動きます。dev サーバーに向ける場合は `BASE_URL=http://localhost:9000`。初回は `npx playwright install chromium webkit`。

### API（フロントが使うもの）

| エンドポイント | 内容 |
|----------------|------|
| `GET /api/root/{folder}` | フォルダ直下のサブフォルダと本（`sort`, `order`, `page`） |
| `GET /api/all` | 全冊フラット |
| `GET /api/search?q=` | タイトル前方一致。`#タグ` でメタデータ検索 |
| `GET /api/neighbors?path=` | 同じフォルダ内の前後の本（次巻ナビ用） |
| `GET /api/progress?path=&position=&progress=` | 読書位置の保存 |
| `GET /api/access?path=` | 最終アクセスの記録 |
| `GET /api/rescan` | 再スキャンを開始 |
| `GET /api/status` | 冊数、最終スキャン結果 |
| `GET /book/cbz?path=&page=` / `/book/cbz/pages` | CBZ のページ画像とページ数（CBR も同様） |
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
