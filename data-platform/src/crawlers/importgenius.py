"""ImportGenius 付费 API 数据源。

ImportGenius 提供提单级（bill-of-lading）数据，含发货方/收货方名称，非洲覆盖
以苏伊士运河、南非港口为主。认证方式为 API key，按查询计费。

真实 endpoint 与字段以账户开通后的 API 文档为准，此处保留可替换的 URL 模板。
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import CustomsSource, ShipmentRecord

log = logging.getLogger(__name__)


class ImportGeniusSource(CustomsSource):
    name = "importgenius"

    def __init__(self, settings: dict):
        super().__init__(settings)
        cfg = settings["customs"]["sources"]["importgenius"]
        if not cfg.get("api_key"):
            raise ValueError("importgenius.api_key missing in settings")
        self.base_url = cfg["base_url"]
        self.api_key = cfg["api_key"]
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=60.0,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def _post(self, path: str, payload: dict) -> httpx.Response:
        resp = self._client.post(path, json=payload)
        resp.raise_for_status()
        return resp

    def fetch(self, country: str, year: int, month: int | None = None) -> Iterable[ShipmentRecord]:
        start, end = _date_range(year, month)
        page = 1
        while True:
            log.info("importgenius fetch country=%s %s..%s page=%s", country, start, end, page)
            # TODO: 替换为真实 ImportGenius search endpoint。示例结构：
            #   payload = {
            #       "origin_country": "CN",
            #       "destination_country": country,
            #       "date_from": start.isoformat(),
            #       "date_to": end.isoformat(),
            #       "page": page,
            #       "page_size": 500,
            #   }
            #   resp = self._post("/shipments/search", payload)
            #   body = resp.json()
            #   for row in body.get("results", []):
            #       yield self._parse(row)
            #   if not body.get("has_next"):
            #       break
            #   page += 1
            break

    def _parse(self, row: dict) -> ShipmentRecord:
        return ShipmentRecord(
            hs_code=str(row.get("hs_code", "")),
            destination_country=row.get("destination_country", ""),
            ship_date=_parse_date(row.get("shipment_date")),
            exporter_name=row.get("shipper_name"),
            quantity=_to_float(row.get("quantity")),
            unit=row.get("unit"),
            value_usd=_to_float(row.get("value_usd")),
            source=self.name,
            raw=row,
        )


def _date_range(year: int, month: int | None) -> tuple[date, date]:
    if month:
        start = date(year, month, 1)
        end = date(year + (month == 12), (month % 12) + 1, 1)
    else:
        start, end = date(year, 1, 1), date(year + 1, 1, 1)
    return start, end


def _parse_date(val) -> date:
    if isinstance(val, date):
        return val
    if val:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00")).date()
    return date.min


def _to_float(val) -> float | None:
    if val in (None, ""):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
