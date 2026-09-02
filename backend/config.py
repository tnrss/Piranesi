"""Environment-backed configuration shared by the API and migrations."""

from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent


def load_env_file(path: Path = BACKEND_DIR / ".env") -> None:
    """Load development defaults without overriding process environment."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

DATABASE_URL = os.getenv(
    "PIRANESI_DATABASE_URL",
    f"sqlite:///{BACKEND_DIR / 'piranesi.db'}",
)
FRONTEND_DIST = Path(
    os.getenv("PIRANESI_FRONTEND_DIST", PROJECT_DIR / "frontend" / "dist")
).expanduser().resolve()
SERVE_FRONTEND = os.getenv("PIRANESI_SERVE_FRONTEND", "0").lower() in {
    "1",
    "true",
    "yes",
}