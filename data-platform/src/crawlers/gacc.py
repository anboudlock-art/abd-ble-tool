"""海关总署（GACC）公开月报数据源。

两条实现路径：
1. queryData HTTP 接口（`GACCSource.fetch`）：按官网 JS 常见调用结构构造 POST，
   URL/参数名/返回字段名全部可通过 settings.yaml 覆盖（官网改版时只需改配置）。
2. Excel 月报解析（`GACCSource.ingest_excel`）：官方每月公布的《出口重点国别
   分商品量值表》xlsx 直接读取，数据口径权威、格式稳定，推荐作为主路径。

GACC 口径为国别 × HS8 月度聚合，无厂家维度——`exporter_name` 始终为 None。
"""
from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Iterable, Iterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import CustomsSource, ShipmentRecord

log = logging.getLogger(__name__)

# 默认 queryData 参数/字段映射——与常见版本一致；官网改版只需在 settings.yaml 覆盖。
DEFAULT_QUERY = {
    "path": "/indexEn/query/queryData",
    "request_params": {
        "currency": "currencyType",
        "year": "year",
        "month_from": "monthFrom",
        "month_to": "monthTo",
        "country": "countryCode",
        "direction": "direction",
        "hs_granularity": "hsCodeType",
    },
    "request_values": {
        "currency": "usd",
        "direction": "export",
        "hs_granularity": "8",
    },
    "response": {
        "list_key": "data",
        "success_key": "Success",
        "fields": {
            "hs_code": "HS_CODE_8",
            "value_usd": "AMOUNT_USD",
            "quantity": "QUANTITY",
            "unit": "UNIT",
            "country": "COUNTRY_CODE",
            "year": "YEAR",
            "month": "MONTH",
        },
    },
}

# ISO-2 → GACC 国家代码（官网使用 3 位字母码）。
ISO2_TO_GACC = {
    "NG": "NGA", "ZA": "ZAF", "EG": "EGY", "KE": "KEN",
    "ET": "ETH", "MA": "MAR", "DZ": "DZA", "GH": "GHA",
    "CN": "CHN",
}

# Excel 月报的中文列头（官方《出口重点国别（地区）分商品量值表》结构）。
EXCEL_HEADERS = {
    "hs_code": ("商品编号", "HS编码", "HS Code"),
    "value_usd": ("美元值", "金额(美元)", "金额", "Value(USD)"),
    "quantity": ("数量", "Quantity"),
    "unit": ("计量单位", "单位", "Unit"),
    "country": ("国别（地区）", "国别", "国家", "Country"),
}


class GACCSource(CustomsSource):
    name = "gacc"

    def __init__(self, settings: dict):
        super().__init__(settings)
        cfg = settings["customs"]["sources"]["gacc"]
        self.base_url = cfg["base_url"]
        self.cache_dir = Path(cfg.get("cache_dir", "data/raw/gacc"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._query_cfg = _merge(DEFAULT_QUERY, cfg.get("query", {}))
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=30.0,
            headers={
                "User-Agent": cfg.get(
                    "user_agent",
                    "Mozilla/5.0 (Linux) DataPlatform/0.1 (+gacc-reader)",
                ),
                "Accept": "application/json",
            },
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def _post(self, path: str, data: dict) -> httpx.Response:
        resp = self._client.post(path, data=data)
        resp.raise_for_status()
        return resp

    def fetch(self, country: str, year: int, month: int | None = None) -> Iterable[ShipmentRecord]:
        gacc_country = ISO2_TO_GACC.get(country.upper(), country.upper())
        months = [month] if month else range(1, 13)
        p = self._query_cfg["request_params"]
        v = self._query_cfg["request_values"]

        for m in months:
            payload = {
                p["currency"]: v["currency"],
                p["year"]: str(year),
                p["month_from"]: f"{m:02d}",
                p["month_to"]: f"{m:02d}",
                p["country"]: gacc_country,
                p["direction"]: v["direction"],
                p["hs_granularity"]: v["hs_granularity"],
            }
            log.info("gacc queryData country=%s %s-%02d", gacc_country, year, m)
            raw_rows = self._query(payload, year, m, country)
            for row in raw_rows:
                parsed = self._parse_row(row, year, m, country)
                if parsed is not None:
                    yield parsed

    def _query(self, payload: dict, year: int, month: int, iso2: str) -> list[dict]:
        cache_file = self.cache_dir / f"{iso2}_{year}_{month:02d}.json"
        if cache_file.exists():
            log.debug("gacc cache hit %s", cache_file)
            return json.loads(cache_file.read_text("utf-8")).get(
                self._query_cfg["response"]["list_key"], []
            )
        try:
            resp = self._post(self._query_cfg["path"], payload)
        except httpx.HTTPError as exc:
            log.error("gacc request failed: %s", exc)
            return []

        try:
            body = resp.json()
        except json.JSONDecodeError:
            log.error("gacc non-json response (first 200b): %s", resp.text[:200])
            return []

        success_key = self._query_cfg["response"]["success_key"]
        if success_key in body and not body.get(success_key):
            log.warning("gacc response marked unsuccessful: %s", body)
            return []

        cache_file.write_text(json.dumps(body, ensure_ascii=False), "utf-8")
        return body.get(self._query_cfg["response"]["list_key"], []) or []

    def _parse_row(self, row: dict, year: int, month: int, iso2: str) -> ShipmentRecord | None:
        f = self._query_cfg["response"]["fields"]
        hs = str(row.get(f["hs_code"], "")).strip()
        if not hs:
            return None
        return ShipmentRecord(
            hs_code=hs,
            destination_country=iso2.upper(),
            ship_date=date(year, month, 1),
            exporter_name=None,
            quantity=_to_float(row.get(f["quantity"])),
            unit=row.get(f["unit"]),
            value_usd=_to_float(row.get(f["value_usd"])),
            source=self.name,
            raw=row,
        )

    def ingest_excel(self, path: str | Path, country: str, year: int, month: int) -> Iterator[ShipmentRecord]:
        """解析官方月报 xlsx。列头匹配 EXCEL_HEADERS 的任一中文/英文别名。"""
        import pandas as pd  # 延迟导入：CI 场景可跳过

        df = pd.read_excel(path, dtype=str)
        colmap = _match_columns(df.columns.tolist())
        if "hs_code" not in colmap or "value_usd" not in colmap:
            log.error("excel 缺少必要列 hs_code / value_usd；实际列: %s", df.columns.tolist())
            return
        for _, row in df.iterrows():
            hs = str(row[colmap["hs_code"]]).strip()
            if not hs or not hs[0].isdigit():
                continue  # 跳过合计行/表头残留
            yield ShipmentRecord(
                hs_code=hs,
                destination_country=country.upper(),
                ship_date=date(year, month, 1),
                exporter_name=None,
                quantity=_to_float(row.get(colmap.get("quantity"))),
                unit=row.get(colmap.get("unit")) if "unit" in colmap else None,
                value_usd=_to_float(row.get(colmap["value_usd"])),
                source=self.name,
                raw=row.to_dict(),
            )


def _merge(base: dict, override: dict) -> dict:
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in base.items()}
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _match_columns(cols: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for field, aliases in EXCEL_HEADERS.items():
        for col in cols:
            if col and any(a in str(col) for a in aliases):
                out[field] = col
                break
    return out


def _to_float(val) -> float | None:
    if val in (None, ""):
        return None
    try:
        return float(str(val).replace(",", ""))
    except (TypeError, ValueError):
        return None
