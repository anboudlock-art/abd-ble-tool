from src.crawlers.customs import REGISTRY, build_sources


BASE_SETTINGS = {
    "customs": {
        "sources": {
            "gacc": {
                "enabled": True,
                "base_url": "http://stats.customs.gov.cn",
                "cache_dir": "/tmp/gacc",
            },
            "importgenius": {
                "enabled": False,
                "base_url": "https://api.importgenius.com/v1",
                "api_key": "k",
            },
            "tendata": {
                "enabled": False,
                "base_url": "https://api.tendata.com/v1",
                "api_key": "k",
                "account": "a",
            },
        }
    }
}


def test_registry_contains_all_three():
    assert set(REGISTRY.keys()) == {"gacc", "importgenius", "tendata"}


def test_default_picks_enabled_sources():
    sources = build_sources(BASE_SETTINGS)
    assert [s.name for s in sources] == ["gacc"]


def test_explicit_selection_overrides_enabled_flag():
    sources = build_sources(BASE_SETTINGS, ["gacc", "importgenius", "tendata"])
    assert [s.name for s in sources] == ["gacc", "importgenius", "tendata"]


def test_unknown_source_raises():
    import pytest

    with pytest.raises(ValueError):
        build_sources(BASE_SETTINGS, ["unknown"])
