"""合成种子数据：在无真实 API 时填充一批可演示的 shipments。"""
from __future__ import annotations

import argparse
import logging
import random
from datetime import date

from . import config
from .classifiers.products import classify_hs
from .storage.db import (
    create_engine_from_config,
    init_db,
    insert_shipment,
    session_factory,
    session_scope,
    upsert_manufacturer,
)

log = logging.getLogger(__name__)

_DEMO_MANUFACTURERS = [
    ("HANGZHOU GREATSTAR INDUSTRIAL CO., LTD.", "ZJ", "HANGZHOU", "hardware_tools"),
    ("SHANGHAI M&G HARDWARE CO., LTD.", "SH", "SHANGHAI", "hardware_tools"),
    ("GUANGZHOU YOTOOL MANUFACTURE CO., LTD.", "GD", "GUANGZHOU", "hardware_tools"),
    ("NINGBO GREAT WALL PRECISION CO., LTD.", "ZJ", "NINGBO", "hardware_tools"),
    ("WENZHOU RELIABLE ELECTRIC CO., LTD.", "ZJ", "WENZHOU", "building_hardware"),
    ("FOSHAN JINYUAN HARDWARE CO., LTD.", "GD", "FOSHAN", "building_hardware"),
    ("TIANJIN HUAYUAN STEEL CO., LTD.", "TJ", "TIANJIN", "building_hardware"),
    ("QINGDAO TRUSTWORTHY LOCK CO., LTD.", "SD", "QINGDAO", "building_hardware"),
]

_HS_CODES = {
    "hardware_tools": ["82030000", "82050000", "82071900", "82079000"],
    "building_hardware": ["73181500", "83011000", "83024100", "73170000"],
}

_COUNTRIES = ["NG", "ZA", "EG", "KE", "ET", "MA", "DZ", "GH"]


def seed(settings: dict, shipments_per_mfr: int = 30, year: int = 2024, rng_seed: int = 42) -> int:
    rng = random.Random(rng_seed)
    engine = create_engine_from_config(settings)
    init_db(engine)
    factory = session_factory(engine)

    inserted = 0
    with session_scope(factory) as session:
        for name, province, city, category in _DEMO_MANUFACTURERS:
            mfr = upsert_manufacturer(
                session,
                name=name,
                source="seed",
                source_id=name,
                province=province,
                city=city,
                category=category,
            )
            for _ in range(shipments_per_mfr):
                hs = rng.choice(_HS_CODES[category])
                country = rng.choice(_COUNTRIES)
                month = rng.randint(1, 12)
                day = rng.randint(1, 28)
                qty = round(rng.uniform(500, 50_000), 2)
                unit_price = rng.uniform(0.5, 25)
                insert_shipment(
                    session,
                    hs_code=hs,
                    destination_country=country,
                    ship_date=date(year, month, day),
                    manufacturer_id=mfr.id,
                    category=classify_hs(hs, settings),
                    quantity=qty,
                    unit="PCS",
                    value_usd=round(qty * unit_price, 2),
                )
                inserted += 1
    log.info("seeded %d shipments across %d manufacturers", inserted, len(_DEMO_MANUFACTURERS))
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed synthetic demo data")
    parser.add_argument("--shipments-per-mfr", type=int, default=30)
    parser.add_argument("--year", type=int, default=2024)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    seed(config.load(), shipments_per_mfr=args.shipments_per_mfr, year=args.year)


if __name__ == "__main__":
    main()
