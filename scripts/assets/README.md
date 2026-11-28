# AI GMの立ち絵・BGMの生成スクリプト

Issue #51 用です。AI GMの立ち絵（8表情）とBGM（lobby / ito / doors / win / lose 各3曲。ゲーム中はitoと10の扉で曲を分ける）を、ComfyUIで作ります。立ち絵はAI GMのみで使います。

ComfyUIはGPUサーバのdocker内で1台動かし、同じコンテナ内で生成ドライバ（`gen_portrait.py` / `gen_bgm.py`）を走らせます。透過・縮小・音声加工は手元の `finalize.py` で行います。ComfyUIは `scripts/assets/` からimportしません。HTTP APIだけを使います。

## ファイル

| ファイル | 実行場所 | 内容 |
| --- | --- | --- |
| `comfy.py` | コンテナ | ComfyUI HTTP APIの最小クライアント（標準ライブラリのみ）。接続先は環境変数 `COMFY_URL`（既定 `http://127.0.0.1:8188`） |
| `gen_portrait.py` | コンテナ | `base`: 1024x1536の立ち絵を数候補、`expressions`: 選んだ1枚から顔だけinpaintして8表情 |
| `gen_bgm.py` | コンテナ | ACE-Step v1 3.5Bで80秒のインスト曲を分類ごとに3曲 |
| `finalize.py` | 手元 | 立ち絵をrembgで透過してWebPへ、BGMをループ化・音量調整してmp3へ |
| `character.json` | - | キャラ設定（銀髪ショート、紺のベストと白シャツ、ヘアクリップと赤いリボン、可愛い案内役の少女） |
| `bgm_prompts.json` | - | 分類ごとのBGMのtags（各3曲）とnegative |

## 必要なモデルとノード

- unet `chosenMixAnima_v10.safetensors`、clip `qwen_3_06b_base.safetensors`、vae `qwen_image_vae.safetensors`
- 顔検出 `checkpoints/sam3.1_multiplex_fp16.safetensors`（ノード `SAM3_Detect`）
- BGM `checkpoints/ace_step_v1_3.5b.safetensors`

## 計算機サーバでの流し方

以下のコマンドは、環境ごとの値を次の変数で書いています。実行前に自分の環境の値を入れてください。

| 変数 | 中身 |
| --- | --- |
| `COMFY_IMAGE` | ComfyUIを含むdockerイメージ（CUDA 13系） |
| `MODELS_DIR` | モデル置き場。コンテナ内 `/models` へmountする |
| `COMFYUI_DIR` | ComfyUI本体。コンテナ内 `/ComfyUI` へmountする |
| `EXTRA_MODEL_PATHS` | `extra_model_paths.yaml`。`/ComfyUI/extra_model_paths.yaml` へ読み取り専用でmountする |

GPUサーバ上のパスは、作業dirと同じくサーバから見えるNAS上に置きます。

`cs.py` は計算機サーバを選んでジョブを流す手元のスクリプトです。

```bash
# 1. サーバを選んで作業dirを作る（GPUあり）
cs.py prepare myito-gm --gpu

# 2. スクリプトを送る
cs.py push myito-gm scripts/assets --exclude out

# 3. 立ち絵の候補を作る（ComfyUIを起動してからドライバを流す）
cs.py run myito-gm --gpus 1 --hours 2 \
  --docker $COMFY_IMAGE \
  --docker-args="-v $MODELS_DIR:/models -v $EXTRA_MODEL_PATHS:/ComfyUI/extra_model_paths.yaml:ro -v $COMFYUI_DIR:/ComfyUI" \
  -- 'W=$PWD; export HOME=$W/home TRITON_CACHE_DIR=$W/home/triton; mkdir -p $HOME $TRITON_CACHE_DIR $W/io/output $W/io/input $W/io/user; (cd /ComfyUI && python main.py --listen 127.0.0.1 --port 8188 --output-directory $W/io/output --input-directory $W/io/input --temp-directory $W/io --user-directory $W/io/user > $W/comfy.log 2>&1 &); for i in $(seq 1 120); do python3 -c "import urllib.request;urllib.request.urlopen(\"http://127.0.0.1:8188/system_stats\",timeout=2)" 2>/dev/null && break; sleep 3; done; cd $W/assets && python3 gen_portrait.py base --out out/candidates --count 4'

# 4. 候補を手元へ取り、1枚選ぶ
cs.py fetch myito-gm assets/out/candidates ./out/candidates
```

起動待ちは `/system_stats` が返るまでのループです (上のコマンドに含めてあります)。

```bash
# 5. 選んだ1枚を送り、8表情とBGMを作る
cs.py push myito-gm out/candidates/base-<seed>.png --dest assets/out
cs.py run myito-gm --gpus 1 --hours 4 \
  --docker $COMFY_IMAGE \
  --docker-args="<手順3と同じ>" \
  -- 'W=$PWD; export HOME=$W/home TRITON_CACHE_DIR=$W/home/triton; mkdir -p $HOME $TRITON_CACHE_DIR $W/io/output $W/io/input $W/io/user; (cd /ComfyUI && python main.py --listen 127.0.0.1 --port 8188 --output-directory $W/io/output --input-directory $W/io/input --temp-directory $W/io --user-directory $W/io/user > $W/comfy.log 2>&1 &); for i in $(seq 1 120); do python3 -c "import urllib.request;urllib.request.urlopen(\"http://127.0.0.1:8188/system_stats\",timeout=2)" 2>/dev/null && break; sleep 3; done; cd $W/assets && python3 gen_portrait.py expressions --base out/base-<seed>.png --out out/expressions && python3 gen_bgm.py --out out/raw'

# 6. 結果を手元へ取り、片付ける
cs.py fetch myito-gm assets/out ./out
cs.py cleanup myito-gm --kill
```

一部の表情だけ作り直すときは `expressions` に `--only 照れ ドヤ顔 --count 4` のように渡します。候補は `out/expressions/<表情>-<番号>.png` に出るので、目視で選んで `<表情>.png` へ改名してから仕上げます。

## 手元での仕上げ

リポジトリのルートで実行します。

```bash
# 立ち絵: client/public/gm/<normal|smile|shy|angry|cry|surprised|confused|smug>.webp
uv run --with "rembg[cpu]" --with pillow python3 scripts/assets/finalize.py --in out --only portrait

# BGM: client/public/bgm/<category>-<n>.mp3（ffmpegが必要）
python3 scripts/assets/finalize.py --in out --only bgm
```

- 立ち絵の表情名の対応は、通常=normal、笑顔=smile、照れ=shy、怒り=angry、泣き=cry、驚き=surprised、困惑=confused、ドヤ顔=smug です。`finalize.py` が `EXPRESSION_FILES` として持っています。
- WebPは幅512に縮小し、8枚の合計が1MB以内になる最初のqualityを自動で選びます。`--quality 80` のように固定もできます。
- BGMは前後の無音を除去し、終わり4秒を頭へ重ねてループにし、-20 LUFS・TP -2で80kのmp3にします。
- 出力先は `--public` で変えられます（既定 `client/public`）。

## 実機で分かったこと (2026-11-26)

- `cs.py run --docker` のコンテナ内では、cwdが作業dirと同じパスで見える。手順3・5の `<作業dirのコンテナ内パス>` は `$PWD` (`W=$PWD`) で足りる。
- `cs.py run` は `--` の後ろの引数をクォートせずに空白でつないでシェルに渡す。`bash -c '...'` と書くと `bash -c` には最初の語しか渡らず、`$W` が空のまま `mkdir /io` などが走って失敗する。手順3・5のようにコマンド全体を1つの文字列で渡し、中の引用符は `\"` にする。
- `--gpus 1` を併用するとA100が1枚見える (`nvidia-smi -L` で確認)。コンテナのpythonは `python` と `python3` のどちらも `/usr/local/bin` にある。ffmpegとrembgは無いので、`finalize.py` は手元で動かす。
- 非rootで動くので、HOMEが未設定だとComfyUIが `PermissionError: '/.triton'` で落ちる。`HOME` と `TRITON_CACHE_DIR` を作業dir配下へ向け、ComfyUIの `--output-directory` `--input-directory` `--temp-directory` `--user-directory` も作業dir配下にする。共有の `/ComfyUI` には書かない。
- 起動は `python main.py --listen 127.0.0.1 --port 8188 ...` をバックグラウンドで起こし、`/system_stats` が返るまで待つ。5〜6回 (15〜18秒) ほどで立ち上がった。
- BGMの生音声はflacで保存される。`finalize.py` はffmpegで読むので拡張子は問わない。仕上がりは73〜75秒 (80秒から前後の無音とクロスフェード分が減る)。
- 立ち絵は、`character.json` の構図 (正面の上半身) で候補を6枚作り、目視で1枚選んでから `expressions` を流した。`base` の候補は seed ごとに顔の向きと構図が大きく変わるので、複数枚作って選ぶ。

## 未確認

- 立ち絵のpositiveの組み立て。novel-writerの `anima_prompt.compose` は読まず、品質・人数・絵師・外見のタグの後ろに自然文を付ける順で組んでいる。LoRAと画風トリガ語は使っていない。
- 表情差分のAI判定 (novel-writerのimagereview) は移植していない。目視で選ぶ。怒りは控えめに出るので、強くしたいときは `gen_portrait.py` の `TAGS` と `DENOISE` を調整して作り直す。
