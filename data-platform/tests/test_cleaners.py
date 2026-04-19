from src.cleaners.normalize import (
    normalize_company_name,
    normalize_country,
    normalize_hs,
)


def test_normalize_company_strips_suffix():
    assert normalize_company_name("Hangzhou Greatstar Industrial CO.,LTD.") == "HANGZHOU GREATSTAR INDUSTRIAL"
    assert normalize_company_name("  shanghai m&g  hardware  ltd ") == "SHANGHAI M&G HARDWARE"


def test_normalize_company_chinese_suffix():
    assert normalize_company_name("宁波长城精密有限公司") == "宁波长城精密"


def test_normalize_hs_pads_and_trims():
    assert normalize_hs("8203") == "82030000"
    assert normalize_hs("82031000.00") == "82031000"
    assert normalize_hs("HS-8205.10") == "82051000"
    assert normalize_hs(None) == ""


def test_normalize_country_variants():
    assert normalize_country("NG") == "NG"
    assert normalize_country("nigeria") == "NG"
    assert normalize_country("South Africa") == "ZA"
    assert normalize_country("RSA") == "ZA"
