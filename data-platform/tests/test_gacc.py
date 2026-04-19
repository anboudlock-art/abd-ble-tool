import json
from pathlib import Path

import pytest

from src.crawlers.gacc import GACCSource, _match_columns


SETTINGS = {
    "customs": {
        "sources": {
            "gacc": {
                "enabled": True,
                "base_url": "http://example.test",
                "cache_dir": "",  # filled per-test
            }
        }
    }
}


def _settings(tmp_path: Path) -> dict:
    s = json.loads(json.dumps(SETTINGS))
    s["customs"]["sources"]["gacc"]["cache_dir"] = str(tmp_path / "cache")
    return s


def test_query_parses_and_caches(tmp_path, monkeypatch):
    captured = {}

    def fake_post(self, path, data):
        captured["path"] = path
        captured["data"] = dict(data)

        class R:
            def json(_self):
                return {
                    "Success": True,
                    "data": [
                        {
                            "HS_CODE_8": "82030000",
                            "AMOUNT_USD": "12345.67",
                            "QUANTITY": "1000",
                            "UNIT": "KGM",
                            "COUNTRY_CODE": "NGA",
                            "YEAR": "2024",
                            "MONTH": "06",
                        },
                        {
                            "HS_CODE_8": "82051000",
                            "AMOUNT_USD": "500",
                            "QUANTITY": "80",
                            "UNIT": "KGM",
                        },
                    ],
                }

            text = ""

        return R()

    monkeypatch.setattr(GACCSource, "_post", fake_post)
    src = GACCSource(_settings(tmp_path))

    records = list(src.fetch("NG", 2024, 6))

    assert captured["path"] == "/indexEn/query/queryData"
    assert captured["data"]["countryCode"] == "NGA"
    assert captured["data"]["year"] == "2024"
    assert captured["data"]["monthFrom"] == "06"
    assert captured["data"]["direction"] == "export"
    assert captured["data"]["currencyType"] == "usd"

    assert len(records) == 2
    r = records[0]
    assert r.hs_code == "82030000"
    assert r.destination_country == "NG"
    assert r.value_usd == 12345.67
    assert r.quantity == 1000.0
    assert r.unit == "KGM"
    assert r.source == "gacc"

    cache_files = list((Path(tmp_path) / "cache").glob("*.json"))
    assert len(cache_files) == 1
    cached = json.loads(cache_files[0].read_text("utf-8"))
    assert cached["data"][0]["HS_CODE_8"] == "82030000"


def test_query_uses_cache_on_second_call(tmp_path, monkeypatch):
    call_count = {"n": 0}

    def fake_post(self, path, data):
        call_count["n"] += 1

        class R:
            def json(_self):
                return {"Success": True, "data": [{"HS_CODE_8": "82030000", "AMOUNT_USD": "1"}]}

            text = ""

        return R()

    monkeypatch.setattr(GACCSource, "_post", fake_post)
    src = GACCSource(_settings(tmp_path))

    list(src.fetch("NG", 2024, 6))
    list(src.fetch("NG", 2024, 6))
    assert call_count["n"] == 1  # second call served from disk cache


def test_query_handles_failure_gracefully(tmp_path, monkeypatch):
    import httpx

    def fake_post(self, path, data):
        raise httpx.ConnectError("unreachable")

    monkeypatch.setattr(GACCSource, "_post", fake_post)
    src = GACCSource(_settings(tmp_path))
    assert list(src.fetch("NG", 2024, 6)) == []


def test_settings_override_merges_into_default(tmp_path, monkeypatch):
    captured = {}

    def fake_post(self, path, data):
        captured["path"] = path
        captured["data"] = dict(data)

        class R:
            def json(_self):
                return {"Success": True, "data": []}

            text = ""

        return R()

    monkeypatch.setattr(GACCSource, "_post", fake_post)
    s = _settings(tmp_path)
    s["customs"]["sources"]["gacc"]["query"] = {
        "path": "/newapi/query",
        "request_params": {"country": "cntry"},
    }
    src = GACCSource(s)
    list(src.fetch("ZA", 2024, 3))
    assert captured["path"] == "/newapi/query"
    assert captured["data"]["cntry"] == "ZAF"
    # other params unaffected by override
    assert captured["data"]["year"] == "2024"


def test_match_columns_finds_chinese_aliases():
    cols = ["商品编号", "国别（地区）", "数量", "计量单位", "美元值"]
    out = _match_columns(cols)
    assert out["hs_code"] == "商品编号"
    assert out["value_usd"] == "美元值"
    assert out["quantity"] == "数量"
    assert out["unit"] == "计量单位"
    assert out["country"] == "国别（地区）"


def test_ingest_excel_parses_bulletin(tmp_path):
    pd = pytest.importorskip("pandas")
    pytest.importorskip("openpyxl")

    xlsx = tmp_path / "bulletin.xlsx"
    df = pd.DataFrame(
        [
            {"商品编号": "82030000", "数量": "1000", "计量单位": "千克", "美元值": "12345.67"},
            {"商品编号": "82051000", "数量": "500", "计量单位": "千克", "美元值": "4321.00"},
            {"商品编号": "合计", "数量": "1500", "计量单位": "", "美元值": "16666.67"},
        ]
    )
    df.to_excel(xlsx, index=False)

    src = GACCSource({"customs": {"sources": {"gacc": {"base_url": "http://x", "cache_dir": str(tmp_path / "c")}}}})
    records = list(src.ingest_excel(xlsx, country="NG", year=2024, month=6))
    assert len(records) == 2
    assert records[0].hs_code == "82030000"
    assert records[0].value_usd == 12345.67
    assert records[0].destination_country == "NG"
    assert records[0].ship_date.isoformat() == "2024-06-01"
