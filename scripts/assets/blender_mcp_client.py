"""Execute a Python source file through Blender's official MCP socket bridge.

The Blender Foundation add-on owns the protocol. This small client is kept in
the repository so asset builds are reproducible even when the Codex host does
not expose the configured MCP server as a first-class tool during a live task.
"""

from __future__ import annotations

import argparse
import json
import socket
from pathlib import Path


def execute(
    host: str,
    port: int,
    source: str,
    timeout: float = 300,
) -> dict[str, object]:
    request = json.dumps(
        {
            "type": "execute",
            "code": source,
            "strict_json": False,
        }
    ).encode("utf-8") + b"\0"

    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(request)
        response = bytearray()
        while b"\0" not in response:
            chunk = connection.recv(65536)
            if not chunk:
                break
            response.extend(chunk)

    if not response:
        raise RuntimeError("Blender MCP returned an empty response")
    payload, _, _ = response.partition(b"\0")
    parsed = json.loads(payload.decode("utf-8"))
    if parsed.get("status") != "ok":
        raise RuntimeError(parsed.get("message", "Blender MCP execution failed"))
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=9876, type=int)
    parser.add_argument(
        "--timeout",
        default=300,
        type=float,
        help="Socket timeout in seconds for long-running Blender builds.",
    )
    args = parser.parse_args()

    response = execute(
        args.host,
        args.port,
        args.source.read_text(encoding="utf-8"),
        timeout=args.timeout,
    )
    print(json.dumps(response, indent=2, default=repr))


if __name__ == "__main__":
    main()
