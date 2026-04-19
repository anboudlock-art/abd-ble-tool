"""数据标准化：厂商名、HS 编码、国别代码。"""
from __future__ import annotations

import re

_COMPANY_SUFFIXES = (
    "CO.,LTD.", "CO., LTD.", "CO.LTD.", "CO LTD", "COMPANY LIMITED",
    "LIMITED", "LTD.", "LTD", "INC.", "INC", "CORP.", "CORP",
    "有限公司", "股份有限公司", "有限责任公司",
)

_WS_RE = re.compile(r"\s+")

_COUNTRY_ALIASES = {
    "NIGERIA": "NG",
    "SOUTH AFRICA": "ZA", "RSA": "ZA",
    "EGYPT": "EG", "ARAB REPUBLIC OF EGYPT": "EG",
    "KENYA": "KE",
    "ETHIOPIA": "ET",
    "MOROCCO": "MA",
    "ALGERIA": "DZ",
    "GHANA": "GH",
}


def normalize_company_name(raw: str | None) -> str:
    if not raw:
        return ""
    s = raw.strip().upper()
    s = _WS_RE.sub(" ", s)
    for suffix in _COMPANY_SUFFIXES:
        if s.endswith(suffix):
            s = s[: -len(suffix)].strip()
            break
    s = s.rstrip(",.;:")
    return s.strip()


def normalize_hs(raw: str | None, length: int = 8) -> str:
    if not raw:
        return ""
    digits = re.sub(r"\D", "", str(raw))
    if not digits:
        return ""
    return digits[:length].ljust(length, "0") if len(digits) < length else digits[:length]


def normalize_country(raw: str | None) -> str:
    if not raw:
        return ""
    s = raw.strip().upper()
    if len(s) == 2 and s.isalpha():
        return s
    return _COUNTRY_ALIASES.get(s, s[:2] if s.isalpha() else "")
