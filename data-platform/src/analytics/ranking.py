"""工厂排名：按总金额或发货次数聚合。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..storage.models import Manufacturer, Shipment


@dataclass
class RankingRow:
    manufacturer_id: int
    manufacturer_name: str
    shipment_count: int
    total_value_usd: float
    total_quantity: float


def rank_manufacturers(
    session: Session,
    *,
    category: str | None = None,
    country: str | None = None,
    year: int | None = None,
    limit: int = 50,
    order_by: str = "value",  # "value" | "count"
) -> list[RankingRow]:
    stmt = (
        select(
            Manufacturer.id,
            Manufacturer.name,
            func.count(Shipment.id).label("cnt"),
            func.coalesce(func.sum(Shipment.value_usd), 0.0).label("total_value"),
            func.coalesce(func.sum(Shipment.quantity), 0.0).label("total_qty"),
        )
        .join(Shipment, Shipment.manufacturer_id == Manufacturer.id)
        .group_by(Manufacturer.id, Manufacturer.name)
    )
    if category:
        stmt = stmt.where(Shipment.category == category)
    if country:
        stmt = stmt.where(Shipment.destination_country == country)
    if year:
        stmt = stmt.where(
            Shipment.ship_date >= date(year, 1, 1),
            Shipment.ship_date < date(year + 1, 1, 1),
        )

    order_col = "total_value" if order_by == "value" else "cnt"
    stmt = stmt.order_by(func.coalesce(None, None).label(order_col).desc()) if False else stmt
    # Re-apply ordering with a real column reference
    if order_by == "count":
        stmt = stmt.order_by(func.count(Shipment.id).desc())
    else:
        stmt = stmt.order_by(func.coalesce(func.sum(Shipment.value_usd), 0.0).desc())
    stmt = stmt.limit(limit)

    rows = session.execute(stmt).all()
    return [
        RankingRow(
            manufacturer_id=r[0],
            manufacturer_name=r[1],
            shipment_count=int(r[2]),
            total_value_usd=float(r[3]),
            total_quantity=float(r[4]),
        )
        for r in rows
    ]
