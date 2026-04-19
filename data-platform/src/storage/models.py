from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Manufacturer(Base):
    __tablename__ = "manufacturers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    province: Mapped[str | None] = mapped_column(String(64))
    city: Mapped[str | None] = mapped_column(String(64))
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str | None] = mapped_column(String(128))
    website: Mapped[str | None] = mapped_column(String(512))
    scraped_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_source_id"),)

    shipments: Mapped[list["Shipment"]] = relationship(back_populates="manufacturer")


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    manufacturer_id: Mapped[int | None] = mapped_column(ForeignKey("manufacturers.id"), index=True)
    hs_code: Mapped[str] = mapped_column(String(16), index=True)
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    destination_country: Mapped[str] = mapped_column(String(4), index=True)
    ship_date: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(16))
    value_usd: Mapped[float | None] = mapped_column(Float)

    manufacturer: Mapped[Manufacturer | None] = relationship(back_populates="shipments")
