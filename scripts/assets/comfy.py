"""ComfyUI HTTP APIの最小クライアント（標準ライブラリのみ）。

novel-writerのanima_comfy.py（_request・_json・upload・wait・run）から必要部分を移植した。
接続先は環境変数COMFY_URL（既定 http://127.0.0.1:8188）。
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

POLL_SECONDS = 2
# 状況の問い合わせが続けて失敗しても待ち続ける回数（ComfyUI側は生成を続けている）
HISTORY_RETRIES = 3


class ComfyError(RuntimeError):
    pass


def base_url() -> str:
    return os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")


def _request(
    url: str,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> bytes:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:800]
        raise ComfyError(f"{url} が{error.code}: {body}") from error
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise ComfyError(f"ComfyUI（{url}）へ接続できない: {error}") from error


def _json(url: str, payload: Any = None, timeout: int = 30) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {} if payload is None else {"Content-Type": "application/json"}
    raw = _request(url, data, headers, timeout)
    try:
        return json.loads(raw)
    except ValueError as error:
        raise ComfyError(f"{url} の応答を読めない: {raw[:200]!r}") from error


def upload(path: Path, name: str | None = None) -> str:
    """画像をComfyUIのinputへ送り、返ったファイル名を返す（LoadImageで使う）。"""
    name = name or f"myito_{uuid.uuid4().hex[:12]}.png"
    boundary = uuid.uuid4().hex
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            path.read_bytes(),
            f"\r\n--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue',
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    return json.loads(_request(f"{base_url()}/upload/image", body, headers, 60))["name"]


def submit(workflow: dict[str, Any]) -> str:
    """workflowを投げてprompt_idを返す。"""
    return _json(f"{base_url()}/prompt", {"prompt": workflow})["prompt_id"]


def wait(prompt_id: str, timeout: int = 600) -> dict[str, Any]:
    """終わりを待ち、ノードごとの出力を返す。"""
    end = time.time() + timeout
    failures = 0
    while time.time() < end:
        try:
            history = _json(f"{base_url()}/history/{prompt_id}")
        except ComfyError as error:
            failures += 1
            if failures > HISTORY_RETRIES:
                raise
            print(
                f"[comfy] 状況の問い合わせに失敗（{failures}回目、待ち続ける）: {error}"
            )
            time.sleep(POLL_SECONDS)
            continue
        failures = 0
        if prompt_id in history:
            status = history[prompt_id].get("status", {})
            if status.get("status_str") == "error":
                raise ComfyError(f"生成失敗: {status.get('messages', [])[-1:]}")
            if status.get("completed"):
                return history[prompt_id]["outputs"]
        time.sleep(POLL_SECONDS)
    raise ComfyError(f"{timeout}秒でタイムアウト")


def fetch(entry: dict[str, str], timeout: int = 120) -> bytes:
    """出力のエントリ（filename・subfolder・type）を/viewで取る。"""
    query = urllib.parse.urlencode(
        {k: entry[k] for k in ("filename", "subfolder", "type")}
    )
    return _request(f"{base_url()}/view?{query}", timeout=timeout)


def run_named(
    workflow: dict[str, Any], kind: str = "images", timeout: int = 600
) -> list[tuple[str, bytes]]:
    """workflowを流し、出力のうちkind（images / audio）を（ComfyUIでのファイル名, バイト列）で全部返す。"""
    outputs = wait(submit(workflow), timeout)
    entries = [e for o in outputs.values() for e in o.get(kind, [])]
    if not entries:
        raise ComfyError(f"{kind}の出力が返らなかった")
    return [(e["filename"], fetch(e)) for e in entries]


def run(workflow: dict[str, Any], kind: str = "images", timeout: int = 600) -> list[bytes]:
    """run_namedのバイト列だけ版。"""
    return [data for _, data in run_named(workflow, kind, timeout)]
