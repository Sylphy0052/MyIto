"""BGMの生の音声（SaveAudioの出力。通常はflac）を作る（ComfyUIと同じコンテナ内で動かす。標準ライブラリのみ）。

novel-writerのaudiogen_theme.py（ACE-Step v1 3.5B、workflow）から移植した。
ループ加工と音量の調整はffmpegが要るので、手元でfinalize.pyが行う。

  python3 gen_bgm.py --out out/raw [--category lobby --category win] [--seed 1000]
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import comfy

HERE = Path(__file__).resolve().parent
CKPT = "ace_step_v1_3.5b.safetensors"
SECONDS = 80.0
STEPS = 50
CFG = 5.0
LYRICS = "[instrumental]"
CATEGORIES = ("lobby", "ito", "doors", "win", "lose")


def workflow(tags: str, negative: str, seed: int) -> dict[str, Any]:
    """ACE-Stepのworkflow（audiogen_theme.workflowと同じ。1曲だけ作る）。"""
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {
            "class_type": "TextEncodeAceStepAudio",
            "inputs": {
                "clip": ["1", 1],
                "tags": tags,
                "lyrics": LYRICS,
                "lyrics_strength": 1.0,
            },
        },
        "3": {
            "class_type": "TextEncodeAceStepAudio",
            "inputs": {
                "clip": ["1", 1],
                "tags": negative,
                "lyrics": "",
                "lyrics_strength": 1.0,
            },
        },
        "4": {
            "class_type": "EmptyAceStepLatentAudio",
            "inputs": {"seconds": SECONDS, "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": seed,
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        "6": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
        },
        "7": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["6", 0], "filename_prefix": "myito-bgm/take"},
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--prompts", type=Path, default=HERE / "bgm_prompts.json")
    parser.add_argument(
        "--out", type=Path, required=True, help="生のwavの出力先（例: out/raw）"
    )
    parser.add_argument(
        "--category", action="append", choices=CATEGORIES, help="省略で全分類"
    )
    parser.add_argument(
        "--seed", type=int, help="基準のseed（曲ごとに+1）。省略でランダム"
    )
    args = parser.parse_args()

    data = json.loads(args.prompts.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    for category in args.category or CATEGORIES:
        for n, tags in enumerate(data["categories"][category], start=1):
            seed = args.seed + n if args.seed is not None else random.randrange(2**32)
            name, raw = comfy.run_named(
                workflow(tags, data["negative"], seed), kind="audio", timeout=1800
            )[0]
            # SaveAudioの出力形式（flac等）のまま保存する。ffmpegがfinalize側で読む
            path = args.out / f"{category}-{n}{Path(name).suffix}"
            path.write_bytes(raw)
            print(f"保存: {path} (seed={seed})")


if __name__ == "__main__":
    main()
