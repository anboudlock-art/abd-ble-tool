"""月度趋势：按类目 × 国别 × 月聚合金额、数量、发货次数。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..storage.models import Shipment


@dataclass
class TrendPoint:
    year: int
    month: int
    shipment_count: int
    total_value_usd: float
    total_quantity: float


def monthly_trends(
    session: Session,
    *,
    category: str | None = None,
    country: str | None = None,
    year: int | None = None,
) -> list[TrendPoint]:
    # SQLite 不支持 date_trunc；用 strftime 抽月份，再聚合
    year_expr = func.strftime("%Y", Shipment.ship_date)
    month_expr = func.strftime("%m", Shipment.ship_date)

    stmt = (
        select(
            year_expr.label("y"),
            month_expr.label("m"),
            func.count(Shipment.id),
            func.coalesce(func.sum(Shipment.value_usd), 0.0),
            func.coalesce(func.sum(Shipment.quantity), 0.0),
        )
        .group_by("y", "m")
        .order_by("y", "m")
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

    rows = session.execute(stmt).all()
    return [
        TrendPoint(
            year=int(r[0]),
            month=int(r[1]),
            shipment_count=int(r[2]),
            total_value_usd=float(r[3]),
            total_quantity=float(r[4]),
        )
        for r in rows
    ]
