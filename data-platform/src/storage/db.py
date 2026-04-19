"""Database engine, session and upsert helpers."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Manufacturer, Shipment


def create_engine_from_config(settings: dict) -> Engine:
    url = settings["storage"]["db_url"]
    return create_engine(url, future=True)


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def upsert_manufacturer(
    session: Session,
    *,
    name: str,
    source: str,
    source_id: str | None = None,
    province: str | None = None,
    city: str | None = None,
    category: str | None = None,
    website: str | None = None,
) -> Manufacturer:
    stmt = None
    if source_id:
        stmt = select(Manufacturer).where(
            Manufacturer.source == source, Manufacturer.source_id == source_id
        )
    else:
        stmt = select(Manufacturer).where(
            Manufacturer.source == source, Manufacturer.name == name
        )
    existing = session.execute(stmt).scalar_one_or_none()
    if existing:
        existing.name = name
        existing.province = province or existing.province
        existing.city = city or existing.city
        existing.category = category or existing.category
        existing.website = website or existing.website
        existing.scraped_at = datetime.utcnow()
        return existing

    row = Manufacturer(
        name=name,
        source=source,
        source_id=source_id,
        province=province,
        city=city,
        category=category,
        website=website,
    )
    session.add(row)
    session.flush()
    return row


def insert_shipment(
    session: Session,
    *,
    hs_code: str,
    destination_country: str,
    ship_date,
    manufacturer_id: int | None = None,
    category: str | None = None,
    quantity: float | None = None,
    unit: str | None = None,
    value_usd: float | None = None,
) -> Shipment:
    row = Shipment(
        hs_code=hs_code,
        destination_country=destination_country,
        ship_date=ship_date,
        manufacturer_id=manufacturer_id,
        category=category,
        quantity=quantity,
        unit=unit,
        value_usd=value_usd,
    )
    session.add(row)
    return row
