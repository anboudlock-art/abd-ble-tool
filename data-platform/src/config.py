from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "config" / "settings.yaml"
EXAMPLE_PATH = Path(__file__).resolve().parents[1] / "config" / "settings.example.yaml"


def load(path: Path | str | None = None) -> dict[str, Any]:
    target = Path(path) if path else DEFAULT_PATH
    if not target.exists():
        target = EXAMPLE_PATH
    with target.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}
