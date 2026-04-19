"""海关出口数据爬虫（骨架）。

真实实现需对接具体数据源（海关总署统计、ImportGenius、Panjiva 等），
当前版本提供命令行入口与数据模型占位，便于阶段一接入时替换。
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from .. import config

log = logging.getLogger(__name__)


@dataclass
class ShipmentRecord:
    hs_code: str
    exporter_name: str
    destination_country: str
    ship_date: date
    quantity: float | None
    unit: str | None
    value_usd: float | None


class CustomsCrawler:
    def __init__(self, settings: dict):
        self.settings = settings
        self.base_url = settings["customs"]["base_url"]

    def fetch(self, country: str, year: int) -> Iterable[ShipmentRecord]:
        log.info("fetching customs data country=%s year=%s", country, year)
        # TODO: 接入真实数据源。示例数据源候选：
        #   - 海关总署统计月报（公开聚合数据）
        #   - 第三方付费数据（ImportGenius, Panjiva, Tendata）
        #   - 目的国海关进口申报（部分国家公开）
        return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Customs export data crawler")
    parser.add_argument("--country", required=True, help="ISO-2 country code, e.g. NG")
    parser.add_argument("--year", type=int, required=True)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    settings = config.load()
    crawler = CustomsCrawler(settings)
    count = sum(1 for _ in crawler.fetch(args.country, args.year))
    log.info("fetched %d records", count)


if __name__ == "__main__":
    main()
