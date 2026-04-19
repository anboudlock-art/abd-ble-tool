from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool


def shared_memory_engine():
    """SQLite :memory: that survives across connections (required for tests)."""
    return create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
