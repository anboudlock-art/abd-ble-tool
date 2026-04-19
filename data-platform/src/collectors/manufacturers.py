"""头部工厂信息采集（骨架）。

目标数据源：1688、阿里巴巴国际站、中国制造网等 B2B 平台的公开工厂主页。
当前版本定义接口与记录结构，真实抓取逻辑按平台实现。
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from typing import Iterable

from .. import config

log = logging.getLogger(__name__)


@dataclass
class ManufacturerRecord:
    name: str
    source: str
    source_id: str | None
    province: str | None
    city: str | None
    category: str | None
    website: str | None


class ManufacturerCollector:
    def __init__(self, settings: dict):
        self.settings = settings
        self.sources = settings["manufacturers"]["sources"]

    def collect(self, category: str) -> Iterable[ManufacturerRecord]:
        for src in self.sources:
            log.info("collecting category=%s source=%s", category, src["name"])
            # TODO: 为每个来源实现分页抓取与解析。
            yield from ()


def main() -> None:
    parser = argparse.ArgumentParser(description="Manufacturer directory collector")
    parser.add_argument(
        "--category",
        required=True,
        choices=["hardware_tools", "building_hardware"],
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    settings = config.load()
    collector = ManufacturerCollector(settings)
    count = sum(1 for _ in collector.collect(args.category))
    log.info("collected %d manufacturers", count)


if __name__ == "__main__":
    main()
