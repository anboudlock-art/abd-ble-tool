"""Shared types and abstract source for customs crawlers."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable


@dataclass
class ShipmentRecord:
    hs_code: str
    destination_country: str
    ship_date: date
    exporter_name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    value_usd: float | None = None
    source: str = ""
    raw: dict = field(default_factory=dict)


class CustomsSource(ABC):
    name: str = ""

    def __init__(self, settings: dict):
        self.settings = settings

    @abstractmethod
    def fetch(self, country: str, year: int, month: int | None = None) -> Iterable[ShipmentRecord]:
        ...
