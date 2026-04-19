"""Tendata（腾道）付费 API 数据源。

Tendata 为国内主流外贸数据服务商，对中国出口非洲的提单级数据覆盖较全，
返回含发货方、收货方、HS、数量、金额等字段。认证为 api_key + account。

真实 endpoint 以账户开通后的 API 文档为准，此处结构保留占位。
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import CustomsSource, ShipmentRecord

log = logging.getLogger(__name__)


class TendataSource(CustomsSource):
    name = "tendata"

    def __init__(self, settings: dict):
        super().__init__(settings)
        cfg = settings["customs"]["sources"]["tendata"]
        if not cfg.get("api_key"):
            raise ValueError("tendata.api_key missing in settings")
        self.base_url = cfg["base_url"]
        self.api_key = cfg["api_key"]
        self.account = cfg.get("account", "")
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=60.0,
            headers={
                "X-Api-Key": self.api_key,
                "X-Account": self.account,
            },
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    def _post(self, path: str, payload: dict) -> httpx.Response:
        resp = self._client.post(path, json=payload)
        resp.raise_for_status()
        return resp

    def fetch(self, country: str, year: int, month: int | None = None) -> Iterable[ShipmentRecord]:
        start, end = _date_range(year, month)
        offset = 0
        page_size = 500
        while True:
            log.info("tendata fetch country=%s %s..%s offset=%s", country, start, end, offset)
            # TODO: 替换为真实 Tendata /trade/search 或 /export/search endpoint。
            #   payload = {
            #       "exportCountry": "CN",
            #       "importCountry": country,
            #       "startDate": start.isoformat(),
            #       "endDate": end.isoformat(),
            #       "offset": offset,
            #       "limit": page_size,
            #   }
            #   resp = self._post("/trade/search", payload)
            #   body = resp.json()
            #   rows = body.get("data", [])
            #   for row in rows:
            #       yield self._parse(row)
            #   if len(rows) < page_size:
            #       break
            #   offset += page_size
            break

    def _parse(self, row: dict) -> ShipmentRecord:
        return ShipmentRecord(
            hs_code=str(row.get("hsCode", "")),
            destination_country=row.get("importCountry", ""),
            ship_date=_parse_date(row.get("tradeDate")),
            exporter_name=row.get("exporterName"),
            quantity=_to_float(row.get("quantity")),
            unit=row.get("unit"),
            value_usd=_to_float(row.get("amountUsd")),
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
