from __future__ import annotations

from pydantic import BaseModel


class RankingItem(BaseModel):
    manufacturer_id: int
    manufacturer_name: str
    shipment_count: int
    total_value_usd: float
    total_quantity: float


class TrendItem(BaseModel):
    year: int
    month: int
    shipment_count: int
    total_value_usd: float
    total_quantity: float


class ShipmentItem(BaseModel):
    id: int
    manufacturer_name: str | None
    hs_code: str
    category: str | None
    destination_country: str
    ship_date: str
    quantity: float | None
    unit: str | None
    value_usd: float | None
