"""产品分类：按 HS 编码前缀映射到业务类目。"""
from __future__ import annotations

from .. import config


def classify_hs(hs_code: str, settings: dict | None = None) -> str | None:
    settings = settings or config.load()
    categories = settings.get("classification", {}).get("categories", {})
    for name, rule in categories.items():
        for prefix in rule.get("hs_prefixes", []):
            if hs_code.startswith(prefix):
                return name
    return None
