import sqlite3


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def format_market_cap(value: float | None) -> str | None:
    if value is None:
        return None
    return f"{value:,.1f}"
