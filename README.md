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

- **キーボード**: `←` `→`（or `A` `D`）レーン移動 / `Space`・`↑`・`W` ジャンプ
- **ゲームパッド**: 左スティック・十字キーでレーン移動 / A・B・X・Y・十字上でジャンプ（どのボタンでもデモ解除・リトライ）
- **スマホ**: 左右スワイプ / 上スワイプ（タップでジャンプ）
- 起動直後はオートパイロットのデモモード。操作すると0mから本番が始まる
- **ゴール**: 2000m走り切るとフィニッシュゲートをくぐって STAGE CLEAR（残ライフ×クリアボーナス）
- ライフ3つ。障害物に当たると減り、尽きると GAME OVER → 任意入力でリトライ（デモ中は不死）

## 見栄えの構成要素

| 要素 | 実装 |
|---|---|
| 空・太陽・星 | カスタムGLSLシェーダー（ストライプ入りシンセウェーブ太陽） |
| ネオングリッド床 | スクロールするシェーダー（fwidthでAA） |
| プレイヤー | InstancedMeshミラータイル約500枚のディスコボール（空をCubeCameraで焼いて反射） |
| ビル群 | Canvas生成の発光窓テクスチャ + フォグ |
| 発光 | UnrealBloomPass（HDR値 >1.0 の素材だけ滲む設計） |
| 質感 | 色収差 + ビネット + 走査線のカスタムShaderPass |

## サウンド・演出

| 要素 | 実装 |
|---|---|
| 効果音 | WebAudioのプロシージャル合成（リング取得・ジャンプ・クラッシュ・ゲームオーバー）。アセット不要 |
| リング音階 | コンボが上がるほどペンタトニックで音が上昇 |
| BGM | `public/bgm.mp3`（ElevenLabs生成）をループ。初回操作で再生、ゲームオーバーでダッキング |
| ヒットストップ | 被弾時に世界を凍結＋激しいシェイク。致命傷は長めに固めてからリザルトへ |
| リザルト | スコアのカウントアップ、ハイスコア記録（localStorage）、NEW RECORD演出 |

ブラウザの自動再生制約により、音は初回のキー入力／タップで開始する。

## 構成

- `src/main.js` — ゲーム本体（シーン構築・シェーダー・ゲームループ）
- `src/audio.js` — WebAudio効果音合成 + BGMループ
- `index.html` — HUD（スコア・コンボ・ライフ・ゲームオーバーはDOM/CSS）
- `public/bgm.mp3` — BGM音源
- `wrangler.jsonc` — Cloudflare Workers static assets デプロイ設定
