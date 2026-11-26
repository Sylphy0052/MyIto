"""生成物を配信用に仕上げる（手元側。rembg・Pillow・ffmpegが要る）。

  uv run --with "rembg[cpu]" --with pillow python3 finalize.py --in out --only portrait
  python3 finalize.py --in out --only bgm      # ffmpegだけで動く

立ち絵: <in>/expressions/<日本語の表情>.png → rembg(isnet-anime)で透過 → 幅512へ縮小 → WebP。
BGM: <in>/raw/<category>-<n>.* → 前後の無音を除去 → 終わり4秒を頭へ重ねてループ化 → -20 LUFS・TP -2 → mp3。
novel-writerのcutout.py・audiogen_sfx.py（_decode・loopable・_wav）・audiogen_theme.py（finish）から移植した。
"""

from __future__ import annotations

import argparse
import array
import io
import math
import subprocess
import sys
import wave
from pathlib import Path

# 日本語の表情名とclient/public/gm/のファイル名の対応
EXPRESSION_FILES = {
    "通常": "normal",
    "笑顔": "smile",
    "照れ": "shy",
    "怒り": "angry",
    "泣き": "cry",
    "驚き": "surprised",
    "困惑": "confused",
}
RM_MODEL = "isnet-anime"
ALPHA_EDGE = 16  # 余白とみなす透明度の上限（cutout.ALPHA_EDGEと同じ）
PORTRAIT_WIDTH = 512
PORTRAIT_TOTAL_BYTES = 1_000_000
QUALITY_STEPS = (90, 85, 80, 75, 70, 65, 60, 50, 40)

CATEGORIES = ("lobby", "ito", "doors", "win", "lose")
RATE = 44100
CHANNELS = 2
CROSSFADE_SECONDS = 4.0
LUFS = -20
TRUE_PEAK = -2
MP3_BITRATE = "128k"
FFMPEG_TIMEOUT = 300
# 先頭・末尾の無音を切る（audio_qc.TRIMと同じ）
TRIM = (
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,"
    "areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse"
)


# 立ち絵 -----------------------------------------------------------------------


def cutout(source: Path):
    from PIL import Image
    from rembg import remove

    session = _session()
    image = Image.open(source).convert("RGB")
    cut = remove(image, session=session)
    # 人物の外側の透明な余白を切り詰める
    box = cut.getchannel("A").point(lambda a: 255 if a > ALPHA_EDGE else 0).getbbox()
    return cut.crop(box) if box else cut


_cached_session = None


def _session():
    global _cached_session
    if _cached_session is None:
        from rembg import new_session

        _cached_session = new_session(RM_MODEL)
    return _cached_session


def encode_webp(image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=quality, method=6)
    return buffer.getvalue()


def finalize_portrait(src_dir: Path, dest: Path, quality: int | None) -> None:
    from PIL import Image

    images = {}
    for jp, en in EXPRESSION_FILES.items():
        source = src_dir / f"{jp}.png"
        if not source.is_file():
            raise SystemExit(f"表情の画像が無い: {source}")
        cut = cutout(source)
        height = round(cut.height * PORTRAIT_WIDTH / cut.width)
        images[en] = cut.resize((PORTRAIT_WIDTH, height), Image.LANCZOS)
    # 品質を下げながら、7枚の合計が上限に収まる最初の値を採る（--qualityで固定もできる）
    steps = (quality,) if quality is not None else QUALITY_STEPS
    for q in steps:
        encoded = {en: encode_webp(im, q) for en, im in images.items()}
        total = sum(len(b) for b in encoded.values())
        if quality is not None or total <= PORTRAIT_TOTAL_BYTES:
            break
    else:
        print(f"警告: 最低品質でも{total}バイトで上限を超えた", file=sys.stderr)
    dest.mkdir(parents=True, exist_ok=True)
    for en, data in encoded.items():
        (dest / f"{en}.webp").write_bytes(data)
    print(f"立ち絵: quality={q} 合計{total}バイト -> {dest}")


# BGM --------------------------------------------------------------------------


def _ffmpeg(args: list[str], data: bytes) -> bytes:
    completed = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            *args,
            "pipe:1",
        ],
        input=data,
        capture_output=True,
        timeout=FFMPEG_TIMEOUT,
    )
    if completed.returncode != 0:
        raise SystemExit(
            f"ffmpegが失敗: {completed.stderr.decode(errors='replace').strip()[-300:]}"
        )
    return completed.stdout


def decode(data: bytes) -> array.array:
    """前後の無音を切った、RATEのステレオの浮動小数のサンプル（フレームごとに交互）。"""
    out = _ffmpeg(
        ["-af", TRIM, "-ac", str(CHANNELS), "-ar", str(RATE), "-f", "f32le"], data
    )
    samples = array.array("f")
    frame = 4 * CHANNELS
    samples.frombytes(out[: len(out) // frame * frame])
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def loopable(samples: array.array) -> array.array:
    """終わりのCROSSFADE_SECONDS秒を頭へ等パワーで重ね、続けて鳴らすと継ぎ目なくつながるようにする。"""
    frames = int(CROSSFADE_SECONDS * RATE)
    overlap = frames * CHANNELS
    if len(samples) < overlap * 3:
        raise SystemExit(
            f"ループにするには短すぎる（{len(samples) / CHANNELS / RATE:.1f}秒）"
        )
    tail_start = len(samples) - overlap
    out = array.array("f", samples[overlap:tail_start])
    for index in range(overlap):
        position = (index // CHANNELS + 0.5) / frames
        fade_in = math.sin(position * math.pi / 2)
        fade_out = math.cos(position * math.pi / 2)
        out.append(samples[tail_start + index] * fade_out + samples[index] * fade_in)
    return out


def to_wav(samples: array.array) -> bytes:
    pcm = array.array("h", (int(max(-1.0, min(1.0, v)) * 32767) for v in samples))
    if sys.byteorder != "little":
        pcm.byteswap()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(2)
        writer.setframerate(RATE)
        writer.writeframes(pcm.tobytes())
    return buffer.getvalue()


def finalize_bgm(src_dir: Path, dest: Path) -> None:
    sources = sorted(p for c in CATEGORIES for p in src_dir.glob(f"{c}-*.*"))
    if not sources:
        raise SystemExit(f"BGMの生音声が無い: {src_dir}/<category>-<n>.*")
    dest.mkdir(parents=True, exist_ok=True)
    for source in sources:
        wav = to_wav(loopable(decode(source.read_bytes())))
        mp3 = _ffmpeg(
            [
                "-af", f"loudnorm=I={LUFS}:TP={TRUE_PEAK}",
                "-ar", str(RATE), "-ac", str(CHANNELS),
                "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-f", "mp3",
            ],
            wav,
        )  # fmt: skip
        target = dest / f"{source.stem}.mp3"
        target.write_bytes(mp3)
        print(f"BGM: {target} ({len(mp3)}バイト)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--in",
        dest="src",
        type=Path,
        required=True,
        help="fetchした出力の親（expressions/とraw/を含む）",
    )
    parser.add_argument("--only", choices=("portrait", "bgm"), help="省略で両方")
    parser.add_argument(
        "--public",
        type=Path,
        default=Path("client/public"),
        help="配置先（既定: client/public）",
    )
    parser.add_argument(
        "--quality",
        type=int,
        help="WebPのqualityを固定（省略で合計1MB以内になるよう自動）",
    )
    args = parser.parse_args()
    if args.only in (None, "portrait"):
        finalize_portrait(args.src / "expressions", args.public / "gm", args.quality)
    if args.only in (None, "bgm"):
        finalize_bgm(args.src / "raw", args.public / "bgm")


if __name__ == "__main__":
    main()
