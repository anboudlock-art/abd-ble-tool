"""跨源去重：按标准化后的 (exporter, hs, date, country) 主键合并。"""
from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Iterator

from ..crawlers.base import ShipmentRecord
from .normalize import normalize_company_name, normalize_country, normalize_hs


def _key(r: ShipmentRecord) -> tuple:
    return (
        normalize_company_name(r.exporter_name),
        normalize_hs(r.hs_code),
        r.ship_date.isoformat() if r.ship_date else "",
        normalize_country(r.destination_country),
    )


_SOURCE_PRIORITY = {"tendata": 0, "importgenius": 1, "gacc": 2}


def dedupe(records: Iterable[ShipmentRecord]) -> Iterator[ShipmentRecord]:
    by_key: dict[tuple, ShipmentRecord] = {}
    for rec in records:
        k = _key(rec)
        existing = by_key.get(k)
        if existing is None:
            by_key[k] = rec
            continue
        # 保留更高优先级的源；同源合并 value/quantity 的 None 字段
        if _SOURCE_PRIORITY.get(rec.source, 99) < _SOURCE_PRIORITY.get(existing.source, 99):
            by_key[k] = _fill_missing(rec, existing)
        else:
            by_key[k] = _fill_missing(existing, rec)
    yield from by_key.values()


def _fill_missing(primary: ShipmentRecord, other: ShipmentRecord) -> ShipmentRecord:
    return replace(
        primary,
        exporter_name=primary.exporter_name or other.exporter_name,
        quantity=primary.quantity if primary.quantity is not None else other.quantity,
        unit=primary.unit or other.unit,
        value_usd=primary.value_usd if primary.value_usd is not None else other.value_usd,
    )
