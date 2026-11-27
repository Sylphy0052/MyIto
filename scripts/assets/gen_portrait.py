"""AI GMの立ち絵と表情差分を作る（ComfyUIと同じコンテナ内で動かす。標準ライブラリのみ）。

novel-writerのanima_comfy.py（workflow・detect_people・redraw_box）・anima_gen.py・expressions.pyから移植した。

  python3 gen_portrait.py base --out out/candidates --count 4
  python3 gen_portrait.py expressions --base out/candidates/base-1234.png --out out/expressions
"""

from __future__ import annotations

import argparse
import json
import random
import uuid
from pathlib import Path
from typing import Any

import comfy

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 1024, 1536
STEPS, CFG, SAMPLER, SCHEDULER = 30, 4.0, "euler", "simple"
UNET = "chosenMixAnima_v10.safetensors"
CLIP = "qwen_3_06b_base.safetensors"
VAE = "qwen_image_vae.safetensors"

# 顔の検出（SAM3）。anima_comfy.pyのDETECT_*と同じ値
DETECT_CHECKPOINT = "sam3.1_multiplex_fp16.safetensors"
DETECT_THRESHOLD = 0.3
BOX_MARGIN = 0.03  # 枠を広げる幅（短辺に対する割合）
SHAPE_GROW = 0.03  # 顔のマスクを太らせる幅（短辺に対する割合）
REDRAW_BLUR = (31, 10.0)  # 描き直した所の縁をぼかす（ImageBlurの半径・sigma）
DENOISE = 0.75  # expressions.DENOISE

# expressions.pyのEXPRESSIONS・TAGS。通常は元の画像のまま
EXPRESSIONS = ("通常", "笑顔", "照れ", "怒り", "泣き", "驚き", "困惑", "ドヤ顔")
TAGS = {
    "笑顔": "smile, open mouth, laughing, happy, closed eyes, ^_^",
    "照れ": "heavy blush, embarrassed, shy, light smile, looking away",
    "怒り": "angry, frown, v-shaped eyebrows, clenched teeth, puffed cheeks, angry vein",
    "泣き": "crying, streaming tears, sad, wavy mouth, frown",
    "驚き": "surprised, shocked, wide-eyed, wide open mouth, raised eyebrows",
    "困惑": "confused, @_@, troubled eyebrows, sweatdrop, frown, closed mouth",
    "ドヤ顔": "smug, closed mouth, smirk, raised eyebrow, looking sideways",
}

Box = tuple[int, int, int, int]


def load_character(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def positive_of(
    ch: dict[str, Any], extra_tags: str = "", with_text: bool = True
) -> str:
    """品質・人数・絵師・外見のタグの順に並べ、立ち絵は後ろへ自然文を付ける。"""
    tags = [
        *ch["quality_tags"],
        *ch["subject_tags"],
        *ch["artist_tags"],
        *ch["appearance_tags"],
    ]
    if extra_tags:
        tags.append(extra_tags)
    head = ", ".join(dict.fromkeys(tags))
    if not with_text:
        return head
    return f"{head}\n\n{ch['text']} {ch['portrait_text']}"


def workflow(positive: str, negative: str, seed: int) -> dict[str, Any]:
    """Anima（txt2img）のworkflow。anima_comfy.workflowのrefs・LoRA・hires無し版。"""
    return {
        "60": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "61": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": "stable_diffusion"},
        },
        "62": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["61", 0]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["61", 0]},
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": SAMPLER,
                "scheduler": SCHEDULER,
                "denoise": 1,
                "model": ["60", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["62", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"myito-gm-{uuid.uuid4().hex[:12]}",
                "images": ["8", 0],
            },
        },
    }


def image_size(path: Path) -> tuple[int, int]:
    """PNGの幅と高さ。"""
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise comfy.ComfyError(f"PNGではない: {path.name}")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def detect_faces(uploaded: str, size: tuple[int, int]) -> list[Box]:
    """SAM3で「face」を探し、広げた枠（x0, y0, x1, y1）を返す（anima_comfy.detect_peopleの1文字版）。"""
    wf: dict[str, Any] = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": DETECT_CHECKPOINT},
        },
        "2": {"class_type": "LoadImage", "inputs": {"image": uploaded}},
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "face", "clip": ["1", 1]},
        },
        "11": {
            "class_type": "SAM3_Detect",
            "inputs": {
                "model": ["1", 0],
                "image": ["2", 0],
                "conditioning": ["10", 0],
                "threshold": DETECT_THRESHOLD,
                "refine_iterations": 0,
                "individual_masks": True,
            },
        },
        "12": {"class_type": "PreviewAny", "inputs": {"source": ["11", 1]}},
    }
    outputs = comfy.wait(comfy.submit(wf))
    width, height = size
    margin = round(BOX_MARGIN * min(size))
    return [
        (
            max(0, round(b["x"]) - margin),
            max(0, round(b["y"]) - margin),
            min(width, round(b["x"] + b["width"]) + margin),
            min(height, round(b["y"] + b["height"]) + margin),
        )
        for b in json.loads(outputs["12"]["text"][0])[0]
    ]


def redraw_face(
    base_png: Path, box: Box, positive: str, negative: str, seed: int, out: Path
) -> None:
    """枠の内側のうち顔のマスクだけをpositiveで描き直し、他は元の画素のままoutへ保存する（anima_comfy.redraw_boxのshape版）。"""
    width, height = image_size(base_png)
    x0, y0, x1, y1 = box
    wf = workflow(positive, negative, seed)
    uploaded = comfy.upload(base_png)
    wf.update(
        {
            "90": {"class_type": "LoadImage", "inputs": {"image": uploaded}},
            "80": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": DETECT_CHECKPOINT},
            },
            "81": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "face", "clip": ["80", 1]},
            },
            "82": {
                "class_type": "SAM3_Detect",
                "inputs": {
                    "model": ["80", 0],
                    "image": ["90", 0],
                    "conditioning": ["81", 0],
                    "threshold": DETECT_THRESHOLD,
                    "refine_iterations": 0,
                    "individual_masks": False,
                },
            },
            "83": {
                "class_type": "GrowMask",
                "inputs": {
                    "mask": ["82", 0],
                    "expand": round(SHAPE_GROW * min(width, height)),
                    "tapered_corners": True,
                },
            },
            # 太らせた形を枠の内側に限る
            "84": {
                "class_type": "MaskComposite",
                "inputs": {
                    "destination": ["94", 0],
                    "source": ["83", 0],
                    "x": 0,
                    "y": 0,
                    "operation": "multiply",
                },
            },
            "91": {
                "class_type": "VAEEncode",
                "inputs": {"pixels": ["90", 0], "vae": ["62", 0]},
            },
            "92": {
                "class_type": "SolidMask",
                "inputs": {"value": 0.0, "width": width, "height": height},
            },
            "93": {
                "class_type": "SolidMask",
                "inputs": {"value": 1.0, "width": x1 - x0, "height": y1 - y0},
            },
            "94": {
                "class_type": "MaskComposite",
                "inputs": {
                    "destination": ["92", 0],
                    "source": ["93", 0],
                    "x": x0,
                    "y": y0,
                    "operation": "add",
                },
            },
            "95": {
                "class_type": "SetLatentNoiseMask",
                "inputs": {"samples": ["91", 0], "mask": ["84", 0]},
            },
            # VAEの往復で枠の外も劣化するので、描き直した所だけを元の絵へぼかして重ねる
            "96": {"class_type": "MaskToImage", "inputs": {"mask": ["84", 0]}},
            "98": {
                "class_type": "ImageBlur",
                "inputs": {
                    "image": ["96", 0],
                    "blur_radius": REDRAW_BLUR[0],
                    "sigma": REDRAW_BLUR[1],
                },
            },
            "99": {
                "class_type": "ImageToMask",
                "inputs": {"image": ["98", 0], "channel": "red"},
            },
            "97": {
                "class_type": "ImageCompositeMasked",
                "inputs": {
                    "destination": ["90", 0],
                    "source": ["8", 0],
                    "x": 0,
                    "y": 0,
                    "resize_source": False,
                    "mask": ["99", 0],
                },
            },
        }
    )
    wf["3"]["inputs"].update({"latent_image": ["95", 0], "denoise": DENOISE})
    wf["9"]["inputs"]["images"] = ["97", 0]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(comfy.run(wf)[0])


def cmd_base(args: argparse.Namespace) -> None:
    ch = load_character(args.character)
    positive = positive_of(ch)
    negative = ", ".join(ch["negative_tags"])
    args.out.mkdir(parents=True, exist_ok=True)
    seeds = (
        [args.seed + i for i in range(args.count)]
        if args.seed is not None
        else [random.randrange(2**32) for _ in range(args.count)]
    )
    for seed in seeds:
        path = args.out / f"base-{seed}.png"
        path.write_bytes(comfy.run(workflow(positive, negative, seed))[0])
        print(f"保存: {path}")


def cmd_expressions(args: argparse.Namespace) -> None:
    ch = load_character(args.character)
    negative = ", ".join(ch["negative_tags"])
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "通常.png").write_bytes(args.base.read_bytes())
    size = image_size(args.base)
    faces = detect_faces(comfy.upload(args.base), size)
    if not faces:
        raise SystemExit("顔の枠が取れなかった")
    box = max(faces, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    for name in EXPRESSIONS[1:]:
        seed = args.seed if args.seed is not None else random.randrange(2**32)
        # 表情の差分は顔だけなので自然文は付けない
        positive = positive_of(ch, TAGS[name], with_text=False)
        out = args.out / f"{name}.png"
        redraw_face(args.base, box, positive, negative, seed, out)
        print(f"保存: {out} (seed={seed})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--character", type=Path, default=HERE / "character.json")
    sub = parser.add_subparsers(dest="command", required=True)
    base = sub.add_parser("base", help="立ち絵の候補を作る")
    base.add_argument("--out", type=Path, required=True)
    base.add_argument("--count", type=int, default=4)
    base.add_argument(
        "--seed", type=int, help="先頭のseed（候補ごとに+1）。省略でランダム"
    )
    base.set_defaults(func=cmd_base)
    expr = sub.add_parser("expressions", help="選んだ1枚から8表情を作る")
    expr.add_argument("--base", type=Path, required=True)
    expr.add_argument("--out", type=Path, required=True)
    expr.add_argument(
        "--seed", type=int, help="全表情で同じseed。省略で表情ごとにランダム"
    )
    expr.set_defaults(func=cmd_expressions)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
