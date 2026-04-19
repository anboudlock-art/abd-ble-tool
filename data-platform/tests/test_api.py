from datetime import date

import pytest
from fastapi.testclient import TestClient

from src.api.app import create_app
from src.storage.db import (
    init_db,
    insert_shipment,
    session_factory,
    session_scope,
    upsert_manufacturer,
)
from tests.conftest import shared_memory_engine


@pytest.fixture
def client():
    engine = shared_memory_engine()
    init_db(engine)
    factory = session_factory(engine)
    with session_scope(factory) as s:
        a = upsert_manufacturer(s, name="ALPHA CO", source="seed", source_id="a")
        b = upsert_manufacturer(s, name="BRAVO CO", source="seed", source_id="b")
        for d, mfr, val in [
            (date(2024, 1, 5), a, 100.0),
            (date(2024, 2, 15), a, 200.0),
            (date(2024, 2, 20), b, 1000.0),
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
    app = create_app(settings={"storage": {"db_url": "unused"}}, factory=factory)
    return TestClient(app)


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_ranking_endpoint(client):
    r = client.get("/api/manufacturers/ranking", params={"country": "NG", "year": 2024})
    assert r.status_code == 200
    body = r.json()
    assert body[0]["manufacturer_name"] == "BRAVO CO"
    assert body[0]["total_value_usd"] == 1000.0


def test_trends_endpoint(client):
    r = client.get("/api/shipments/trends", params={"year": 2024})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2
    assert body[1]["month"] == 2
    assert body[1]["shipment_count"] == 2


def test_search_endpoint_filter_by_manufacturer(client):
    r = client.get("/api/shipments/search", params={"manufacturer": "ALPHA"})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2
    assert all(row["manufacturer_name"] == "ALPHA CO" for row in body)
