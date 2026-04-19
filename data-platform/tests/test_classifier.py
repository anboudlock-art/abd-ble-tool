from src.classifiers.products import classify_hs

SETTINGS = {
    "classification": {
        "categories": {
            "hardware_tools": {"hs_prefixes": ["8203", "8205"]},
            "building_hardware": {"hs_prefixes": ["7318", "8301"]},
        }
    }
}


def test_hardware_tools_match():
    assert classify_hs("820310", SETTINGS) == "hardware_tools"


def test_building_hardware_match():
    assert classify_hs("830110", SETTINGS) == "building_hardware"


def test_no_match_returns_none():
    assert classify_hs("9999", SETTINGS) is None
