"""端到端抓取管道：crawler → cleaner → storage。"""
from __future__ import annotations

import argparse
import logging
from typing import Iterable

from .. import config
from ..classifiers.products import classify_hs
from ..cleaners.dedupe import dedupe
from ..cleaners.normalize import normalize_company_name, normalize_country, normalize_hs
from ..crawlers.base import ShipmentRecord
from ..crawlers.customs import build_sources, fetch_all
from ..storage.db import (
    create_engine_from_config,
    init_db,
    insert_shipment,
    session_factory,
    session_scope,
    upsert_manufacturer,
)

log = logging.getLogger(__name__)


def _clean(records: Iterable[ShipmentRecord]) -> Iterable[ShipmentRecord]:
    for r in records:
        yield ShipmentRecord(
            hs_code=normalize_hs(r.hs_code),
            destination_country=normalize_country(r.destination_country),
            ship_date=r.ship_date,
            exporter_name=normalize_company_name(r.exporter_name) or None,
            quantity=r.quantity,
            unit=r.unit,
            value_usd=r.value_usd,
            source=r.source,
            raw=r.raw,
        )


def ingest(settings: dict, country: str, year: int, month: int | None = None) -> int:
    sources = build_sources(settings)
    raw = fetch_all(sources, country, year, month)
    cleaned = list(dedupe(_clean(raw)))

    engine = create_engine_from_config(settings)
    init_db(engine)
    factory = session_factory(engine)

    inserted = 0
    with session_scope(factory) as session:
        for rec in cleaned:
            manufacturer_id = None
            if rec.exporter_name:
                mfr = upsert_manufacturer(
                    session, name=rec.exporter_name, source=rec.source or "customs"
                )
                manufacturer_id = mfr.id
            insert_shipment(
                session,
                hs_code=rec.hs_code,
                destination_country=rec.destination_country,
                ship_date=rec.ship_date,
                manufacturer_id=manufacturer_id,
                category=classify_hs(rec.hs_code, settings),
                quantity=rec.quantity,
                unit=rec.unit,
                value_usd=rec.value_usd,
            )
            inserted += 1
    log.info("ingested %d shipments", inserted)
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="End-to-end customs ingest")
    parser.add_argument("--country", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    ingest(config.load(), args.country, args.year, args.month)


if __name__ == "__main__":
    main()
