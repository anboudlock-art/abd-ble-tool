"""FastAPI 查询服务。"""
from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .. import config
from ..analytics.ranking import rank_manufacturers
from ..analytics.trends import monthly_trends
from ..storage.db import create_engine_from_config, init_db, session_factory
from ..storage.models import Manufacturer, Shipment
from .schemas import RankingItem, ShipmentItem, TrendItem

_WEB_DIR = Path(__file__).resolve().parents[2] / "web"


def create_app(settings: dict | None = None, factory: sessionmaker[Session] | None = None) -> FastAPI:
    settings = settings or config.load()
    if factory is None:
        engine = create_engine_from_config(settings)
        init_db(engine)
        factory = session_factory(engine)

    app = FastAPI(title="China→Africa Export Data Platform", version="0.1.0")

    def get_session() -> Session:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/manufacturers/ranking", response_model=list[RankingItem])
    def ranking(
        session: Session = Depends(get_session),
        category: str | None = None,
        country: str | None = None,
        year: int | None = None,
        limit: int = Query(50, ge=1, le=500),
        order_by: str = Query("value", pattern="^(value|count)$"),
    ) -> list[RankingItem]:
        rows = rank_manufacturers(
            session,
            category=category,
            country=country,
            year=year,
            limit=limit,
            order_by=order_by,
        )
        return [RankingItem(**r.__dict__) for r in rows]

    @app.get("/api/shipments/trends", response_model=list[TrendItem])
    def trends(
        session: Session = Depends(get_session),
        category: str | None = None,
        country: str | None = None,
        year: int | None = None,
    ) -> list[TrendItem]:
        pts = monthly_trends(session, category=category, country=country, year=year)
        return [TrendItem(**p.__dict__) for p in pts]

    @app.get("/api/shipments/search", response_model=list[ShipmentItem])
    def search(
        session: Session = Depends(get_session),
        category: str | None = None,
        country: str | None = None,
        hs_code: str | None = None,
        manufacturer: str | None = None,
        limit: int = Query(100, ge=1, le=1000),
    ) -> list[ShipmentItem]:
        stmt = select(Shipment, Manufacturer).join(
            Manufacturer, Shipment.manufacturer_id == Manufacturer.id, isouter=True
        )
        if category:
            stmt = stmt.where(Shipment.category == category)
        if country:
            stmt = stmt.where(Shipment.destination_country == country)
        if hs_code:
            stmt = stmt.where(Shipment.hs_code.startswith(hs_code))
        if manufacturer:
            stmt = stmt.where(Manufacturer.name.ilike(f"%{manufacturer}%"))
        stmt = stmt.order_by(Shipment.ship_date.desc()).limit(limit)

        result = []
        for ship, mfr in session.execute(stmt).all():
            result.append(
                ShipmentItem(
                    id=ship.id,
                    manufacturer_name=mfr.name if mfr else None,
                    hs_code=ship.hs_code,
                    category=ship.category,
                    destination_country=ship.destination_country,
                    ship_date=ship.ship_date.isoformat(),
                    quantity=ship.quantity,
                    unit=ship.unit,
                    value_usd=ship.value_usd,
                )
            )
        return result

    if _WEB_DIR.exists():
        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(_WEB_DIR / "index.html")

        app.mount("/static", StaticFiles(directory=_WEB_DIR), name="static")

    return app
