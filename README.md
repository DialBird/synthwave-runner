# NEON RUSH — synthwave runner

Claude（Fable 5）によるリッチUI再現実験。Three.js + ポストプロセス全部盛りの3Dランナーゲーム。

## 開発・デプロイ

```bash
pnpm install
pnpm dev                # 開発サーバー (Vite)
pnpm build              # dist/ にビルド
pnpm preview            # ビルド結果をローカル確認
pnpm run deploy         # Cloudflare Workers (static assets) にデプロイ
```

デプロイは `wrangler.jsonc` の static assets 構成を使用（`wrangler login` が初回に必要）。

## 遊び方

- `←` `→`（または `A` `D`）: レーン移動
- `Space` / `↑`: ジャンプ
- スマホ: 左右スワイプ / 上スワイプ
- 起動直後はオートパイロットのデモモード。キー入力で操作が切り替わる
- ライフ3つ。障害物に当たると減り、尽きるとGAME OVER → 任意キーでリトライ（デモ中は不死）

## 見栄えの構成要素

| 要素 | 実装 |
|---|---|
| 空・太陽・星 | カスタムGLSLシェーダー（ストライプ入りシンセウェーブ太陽） |
| ネオングリッド床 | スクロールするシェーダー（fwidthでAA） |
| プレイヤー | InstancedMeshミラータイル約500枚のディスコボール（空をCubeCameraで焼いて反射） |
| ビル群 | Canvas生成の発光窓テクスチャ + フォグ |
| 発光 | UnrealBloomPass（HDR値 >1.0 の素材だけ滲む設計） |
| 質感 | 色収差 + ビネット + 走査線のカスタムShaderPass |

## 構成

- `src/main.js` — ゲーム本体（シーン構築・シェーダー・ゲームループ）
- `index.html` — HUD（スコア・コンボ・ライフ・ゲームオーバーはDOM/CSS）
- `wrangler.jsonc` — Cloudflare Workers static assets デプロイ設定
