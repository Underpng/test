# ROADMAP

このリポジトリは [projects-shelf/Book](https://github.com/projects-shelf/Book) のフォークとして育てる。
上流の取り込み時点は git タグ `upstream-import` で参照できる。

目的: 自宅 PC（Windows）でホストし、同じ Wi-Fi の iPhone（Safari）から漫画・電子書籍を快適に読む。
**軽さと使い心地を最優先**。Docker や WSL に依存せず、exe 1 つで動き続けること。

## 進め方（合意済みの順番）

1. **ビルド基盤** — 済
   - フロントを npm で再ビルドできるようにする（Bun 依存と arm64 固定を除去）
   - Farm dev サーバーから API へプロキシする開発ループ
   - Playwright スモークテスト（Chromium / WebKit / iPhone エミュレーション）
2. **バックエンドの堅牢化とネイティブ exe 化** — 済
   - gin と cgo を外して純 Go に。表紙は JPEG
   - CBZ / EPUB を `archive/zip` で読む。CBR は 7-Zip を `-slt` で安全にパース
   - 自然順ソート、表紙生成失敗の再試行（最大 3 回）、定期再スキャン、起動即応答
   - `/api/neighbors`（同じフォルダ内の前後の本）
   - フロントを exe に埋め込み、`build.ps1` で `shelf.exe`（コンソール）と `shelfw.exe`（ウィンドウなし）を生成
   - SQLite（modernc の Go 移植、初期化だけで約 40 MB）を廃止し、メモリ上のカタログ + `library.json` に置き換え
   - ソフトメモリ上限 96 MB とスキャン後の OS へのメモリ返却。実測: 起動後 15 MB、閲覧中 20 MB 前後、exe 14.7 MB
   - `scripts/install.ps1`（常設フォルダへ配置 + 本の移動 + 自動起動）、`install-autostart.ps1`、`setup-firewall.ps1`
   - 配置先: `D:\ShelfBook`（2026-09-25 設置、タスク `ShelfBookServer` でログオン時起動）
3. **ビューア** — 漫画側は済、EPUB は未
   - **次巻へシームレスに移動**（Kindle 風）— 済。巻末で次の巻を提示、1 ページ目で前の巻を提示。次巻の 1 ページ目を先読み
   - **漫画ビューアの作り直し**（`components/viewer/comic.tsx`）— 済
     - 指についてくるスワイプ（前後ページを両脇に常時マウントしてちらつきなし）、フリックで判定
     - タップ領域: 左右 30% でページ送り、中央でバーの表示切替。ダブルタップでズーム、ピンチでズーム、ズーム中はドラッグでパン
     - 上下のバーは起動後 2.5 秒で自動的に隠れる。上: 戻る・タイトル・ページ番号・設定。下: スライダー・巻番号
     - 見開き「自動」（横向きのときだけ見開き。表紙は単独）。既定は右綴じ + 自動
     - Safari 対策: viewport の user-scalable=no、2 本指 touchmove と gesturestart の抑止、長押しコールアウト無効
     - キーボード: ←→（綴じ方向に従う）、Space / PageDown で次、PageUp で前、Esc でバー切替
   - **ホーム画面** — 済。`/api/home` で「続きを読む」「次の巻（読み終えた巻の続き）」「新着」を 1 リクエストで返す。スマホ幅で崩れていた横スクロールを修正
   - Safari で EPUB ビューアが操作不能になる問題: まず react-reader を外して epubjs を直接制御、駄目なら foliate-js に載せ替え（未着手。EPUB を使うか次第）
4. **デザイン刷新（Material 3 / Chrome 風）**
   - Tailwind + shadcn/ui のトークン（色・角丸・フォント・影）を Material 3 に寄せる
   - トーン付きサーフェス、大きめの角丸、Google Sans 系フォント、Material Symbols
   - モバイルはボトムナビ、デスクトップはナビゲーションレール
   - 先に 1 画面のモックで方向を合わせてから全画面へ展開

## 残っている改善候補

- PDF の表紙を外部ツールなしで作る（pdfium.wasm はフロントにあるので、ブラウザ側で生成してアップロードする案）
- 自動再スキャンをファイル監視（ReadDirectoryChangesW）に置き換えて即時反映にする
- 書庫内のページ一覧をメモリにキャッシュして大きな CBZ の初回応答をさらに縮める

## 検証の方針

- 変更ごとに `go test ./...`、`npm run typecheck`、`npm test` を通す
- WebKit プロジェクトで Safari 由来の不具合を早期に拾い、iPhone 実機は最終確認に使う
- メモリは `Get-Process shelf` のワーキングセットで確認する（目標: 常時 50 MB 未満）
