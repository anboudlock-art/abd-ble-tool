"""海关总署（GACC）公开月报数据源。

GACC 月报为国别 × HS 8 位聚合数据，公开免费，但无厂家维度。
数据格式：HTML 表格与 Excel 附件，需抓取后解析。本模块提供查询与解析骨架。

端点参考：http://stats.customs.gov.cn/queryData/query?... （具体接口由官网 JS 调用
拼接，字段随版本调整，保留 TODO 供对接时填写）。
"""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import CustomsSource, ShipmentRecord

log = logging.getLogger(__name__)


class GACCSource(CustomsSource):
    name = "gacc"

    def __init__(self, settings: dict):
        super().__init__(settings)
        cfg = settings["customs"]["sources"]["gacc"]
        self.base_url = cfg["base_url"]
        self.cache_dir = Path(cfg.get("cache_dir", "data/raw/gacc"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._client = httpx.Client(base_url=self.base_url, timeout=30.0)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def _get(self, path: str, params: dict) -> httpx.Response:
        resp = self._client.get(path, params=params)
        resp.raise_for_status()
        return resp

    def fetch(self, country: str, year: int, month: int | None = None) -> Iterable[ShipmentRecord]:
        months = [month] if month else range(1, 13)
        for m in months:
            log.info("gacc fetch country=%s %s-%02d", country, year, m)
            # TODO: 调用真实 queryData 接口。示例参数（需按官网实际字段调整）：
            #   payload = {
            #       "currencyType": "usd",
            #       "dateQuery": f"{year}{m:02d}",
            #       "countryCode": country,
            #       "indicator": "export",
            #   }
            #   resp = self._get("/queryData/query", payload)
            #   for row in resp.json().get("data", []):
            #       yield self._parse(row, year, m, country)
            yield from ()

    def _parse(self, row: dict, year: int, month: int, country: str) -> ShipmentRecord:
        return ShipmentRecord(
            hs_code=str(row.get("hsCode", "")),
            destination_country=country,
            ship_date=date(year, month, 1),
            exporter_name=None,  # GACC 月报无厂家维度
            quantity=_to_float(row.get("quantity")),
            unit=row.get("unit"),
            value_usd=_to_float(row.get("valueUsd")),
            source=self.name,
            raw=row,
        )


def _to_float(val) -> float | None:
    if val in (None, ""):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
