from __future__ import annotations

import socket
import sys
from pathlib import Path

import uvicorn


def is_port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def pick_port(host: str, start: int = 9000, end: int = 9010) -> int:
    for port in range(start, end + 1):
        if is_port_available(host, port):
            return port
    raise RuntimeError(f"No free port found between {start} and {end}")


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from app.main import app

    host = "127.0.0.1"
    port = pick_port(host, 9000, 9010)
    print(f"Starting WeRunOps backend on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, reload=False)
