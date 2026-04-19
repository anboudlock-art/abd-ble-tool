from datetime import date

import pytest

from src.analytics.ranking import rank_manufacturers
from src.analytics.trends import monthly_trends
from src.storage.db import (
    init_db,
    insert_shipment,
    session_factory,
    session_scope,
    upsert_manufacturer,
)
from tests.conftest import shared_memory_engine


@pytest.fixture
def factory():
    engine = shared_memory_engine()
    init_db(engine)
    return session_factory(engine)


@pytest.fixture
def populated(factory):
    with session_scope(factory) as s:
        a = upsert_manufacturer(s, name="A CO", source="seed", source_id="a", category="hardware_tools")
        b = upsert_manufacturer(s, name="B CO", source="seed", source_id="b", category="hardware_tools")
        for d, mfr, val in [
            (date(2024, 1, 10), a, 100.0),
            (date(2024, 2, 10), a, 400.0),
            (date(2024, 2, 20), b, 250.0),
            (date(2024, 3, 5), b, 600.0),
        ]:
            insert_shipment(
                s,
                hs_code="82030000",
                destination_country="NG",
                ship_date=d,
                manufacturer_id=mfr.id,
                category="hardware_tools",
                quantity=10,
                unit="PCS",
                value_usd=val,
            )
    return factory


def test_ranking_orders_by_value(populated):
    with session_scope(populated) as s:
        rows = rank_manufacturers(s, category="hardware_tools", country="NG", year=2024)
    assert [r.manufacturer_name for r in rows] == ["B CO", "A CO"]
    assert rows[0].total_value_usd == 850.0
    assert rows[1].total_value_usd == 500.0


def test_ranking_orders_by_count(populated):
    with session_scope(populated) as s:
        rows = rank_manufacturers(s, order_by="count")
    assert {r.manufacturer_name for r in rows} == {"A CO", "B CO"}
    assert rows[0].shipment_count == 2


def test_monthly_trends_groups_by_month(populated):
    with session_scope(populated) as s:
        pts = monthly_trends(s, category="hardware_tools", country="NG", year=2024)
    months = [(p.year, p.month, p.shipment_count, p.total_value_usd) for p in pts]
    assert months == [
        (2024, 1, 1, 100.0),
        (2024, 2, 2, 650.0),
        (2024, 3, 1, 600.0),
    ]
