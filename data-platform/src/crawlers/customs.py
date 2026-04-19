"""Orchestrator CLI: 跨多数据源抓取中国出口非洲海关数据。"""
from __future__ import annotations

import argparse
import logging
from typing import Iterable

from .. import config
from .base import CustomsSource, ShipmentRecord
from .gacc import GACCSource
from .importgenius import ImportGeniusSource
from .tendata import TendataSource

log = logging.getLogger(__name__)

REGISTRY: dict[str, type[CustomsSource]] = {
    "gacc": GACCSource,
    "importgenius": ImportGeniusSource,
    "tendata": TendataSource,
}


def build_sources(settings: dict, names: list[str] | None = None) -> list[CustomsSource]:
    configured = settings["customs"]["sources"]
    selected = names or [k for k, v in configured.items() if v.get("enabled")]
    sources: list[CustomsSource] = []
    for name in selected:
        cls = REGISTRY.get(name)
        if cls is None:
            raise ValueError(f"unknown customs source: {name}")
        sources.append(cls(settings))
    return sources


def fetch_all(
    sources: list[CustomsSource], country: str, year: int, month: int | None = None
) -> Iterable[ShipmentRecord]:
    for src in sources:
        try:
            yield from src.fetch(country, year, month)
        except Exception as exc:  # noqa: BLE001
            log.error("source %s failed: %s", src.name, exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Customs export data crawler")
    parser.add_argument("--country", required=True, help="ISO-2 country code, e.g. NG")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, help="1-12; omit to fetch full year")
    parser.add_argument(
        "--source",
        action="append",
        choices=list(REGISTRY.keys()),
        help="Restrict to specific source(s); repeat flag. Default: all enabled.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    settings = config.load()
    sources = build_sources(settings, args.source)
    log.info("using sources: %s", [s.name for s in sources])
    count = sum(1 for _ in fetch_all(sources, args.country, args.year, args.month))
    log.info("fetched %d records total", count)


if __name__ == "__main__":
    main()
