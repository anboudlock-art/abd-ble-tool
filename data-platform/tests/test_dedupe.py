from datetime import date

from src.cleaners.dedupe import dedupe
from src.crawlers.base import ShipmentRecord


def _rec(source, exporter, value_usd=None, quantity=None):
    return ShipmentRecord(
        hs_code="82030000",
        destination_country="NG",
        ship_date=date(2024, 6, 1),
        exporter_name=exporter,
        quantity=quantity,
        unit="PCS",
        value_usd=value_usd,
        source=source,
    )


def test_dedupe_prefers_tendata_over_gacc():
    records = [
        _rec("gacc", "HANGZHOU GREATSTAR CO.,LTD.", value_usd=100),
        _rec("tendata", "HANGZHOU GREATSTAR CO.,LTD.", value_usd=120),
    ]
    out = list(dedupe(records))
    assert len(out) == 1
    assert out[0].source == "tendata"
    assert out[0].value_usd == 120


def test_dedupe_fills_missing_fields_from_lower_priority():
    records = [
        _rec("tendata", "HANGZHOU GREATSTAR CO.,LTD.", value_usd=None, quantity=10),
        _rec("gacc", "HANGZHOU GREATSTAR CO.,LTD.", value_usd=100, quantity=None),
    ]
    out = list(dedupe(records))
    assert len(out) == 1
    assert out[0].source == "tendata"
    assert out[0].value_usd == 100
    assert out[0].quantity == 10


def test_dedupe_keeps_distinct_exporters():
    records = [
        _rec("tendata", "A CO.,LTD."),
        _rec("tendata", "B CO.,LTD."),
    ]
    assert len(list(dedupe(records))) == 2
