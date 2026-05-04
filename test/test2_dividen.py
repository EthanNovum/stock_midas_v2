from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DEFAULT_DB_PATH = BACKEND / "data" / "midas.sqlite3"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from app.services import akshare_sync
from app.timeutils import now_iso


@dataclass
class DividendUpdateStats:
    total: int
    updated: int = 0
    failed: int = 0


def connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def build_history_request() -> SimpleNamespace:
    return SimpleNamespace(trade_date=None, start_date=None, end_date=None, symbols=None, limit=1)


def latest_close_from_db(conn: sqlite3.Connection, symbol: str) -> tuple[float, str] | None:
    row = conn.execute(
        """
        SELECT close, trade_date
        FROM stock_daily_prices
        WHERE symbol = ?
        ORDER BY trade_date DESC
        LIMIT 1
        """,
        (symbol,),
    ).fetchone()
    if row is None:
        return None

    close = akshare_sync.to_float(row["close"])
    if close <= 0:
        return None
    return close, str(row["trade_date"])


def latest_close_from_akshare(ak: Any, code: str, request: SimpleNamespace) -> tuple[float, str] | None:
    hist = akshare_sync.fetch_history(ak, code, request)
    if hist is None or hist.empty or "收盘" not in hist.columns:
        return None

    latest = hist.tail(1).iloc[0]
    close = akshare_sync.to_float(latest.get("收盘"))
    if close <= 0:
        return None
    return close, akshare_sync.latest_date_str(latest.get("日期"), request)


def select_dividend_update_targets(
    conn: sqlite3.Connection,
    limit: int | None = None,
    only_missing: bool = False,
) -> list[sqlite3.Row]:
    where = ["market = 'A'"]
    if only_missing:
        where.append("(dividend_yield IS NULL OR dividend_yield <= 0)")

    params: list[object] = []
    sql = f"""
        SELECT symbol, name
        FROM stock_fundamentals
        WHERE {' AND '.join(where)}
        ORDER BY symbol ASC
    """
    if limit:
        sql += " LIMIT ?"
        params.append(limit)

    return list(conn.execute(sql, params).fetchall())


def fetch_dividend_yield_for_symbol(
    ak: Any,
    conn: sqlite3.Connection,
    symbol: str,
    request: SimpleNamespace,
) -> tuple[float, float, str]:
    code = akshare_sync.strip_symbol(symbol).zfill(6)
    latest = latest_close_from_db(conn, symbol)
    if latest is None:
        latest = latest_close_from_akshare(ak, code, request)
    if latest is None:
        raise RuntimeError("没有可用收盘价")

    close, trade_date = latest
    dividend_yield = akshare_sync.fetch_dividend_yield(ak, code, close, trade_date)
    return dividend_yield, close, trade_date


def migrate_dividend_yields_to_midas(
    conn: sqlite3.Connection,
    limit: int | None = None,
    only_missing: bool = False,
    progress_callback: Callable[[int, int, str], None] | None = None,
    ak: Any | None = None,
) -> DividendUpdateStats:
    if ak is None:
        import akshare as ak

    targets = select_dividend_update_targets(conn, limit=limit, only_missing=only_missing)
    request = build_history_request()
    stats = DividendUpdateStats(total=len(targets))

    for index, row in enumerate(targets, start=1):
        symbol = str(row["symbol"])
        name = str(row["name"])
        try:
            dividend_yield, close, trade_date = fetch_dividend_yield_for_symbol(ak, conn, symbol, request)
            conn.execute(
                """
                UPDATE stock_fundamentals
                SET dividend_yield = ?, updated_at = ?
                WHERE symbol = ?
                """,
                (round(float(dividend_yield), 2), now_iso(), symbol),
            )
            conn.commit()
            stats.updated += 1
            message = f"{symbol} {name} 股息率={dividend_yield:.2f}% 收盘价={close:.2f} 日期={trade_date}"
        except Exception as exc:
            conn.rollback()
            stats.failed += 1
            message = f"{symbol} {name} 更新失败: {exc}"

        if progress_callback:
            progress_callback(index, stats.total, message)

    return stats


def print_progress(completed: int, total: int, message: str) -> None:
    percent = completed / total * 100 if total else 100
    print(f"[{completed}/{total} {percent:5.1f}%] {message}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="更新 A 股股票股息率并迁移写入 midas.sqlite3")
    parser.add_argument("--limit", type=int, default=None, help="最多更新多少只股票；不传则更新库内全部 A 股")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="sqlite 数据库路径")
    parser.add_argument("--only-missing", action="store_true", help="只更新 dividend_yield 为空或小于等于 0 的股票")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.limit is not None and args.limit <= 0:
        raise SystemExit("--limit 必须大于 0")
    if not args.db.exists():
        raise SystemExit(f"数据库不存在: {args.db}")

    with connect_db(args.db) as conn:
        stats = migrate_dividend_yields_to_midas(
            conn,
            limit=args.limit,
            only_missing=args.only_missing,
            progress_callback=print_progress,
        )

    print(f"完成: total={stats.total}, updated={stats.updated}, failed={stats.failed}")
    return 0 if stats.failed == 0 else 1


def test_select_dividend_update_targets_respects_limit_and_only_missing(tmp_path: Path):
    db_path = tmp_path / "midas-test.sqlite3"
    with connect_db(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE stock_fundamentals (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                market TEXT NOT NULL,
                dividend_yield REAL
            )
            """
        )
        conn.executemany(
            "INSERT INTO stock_fundamentals (symbol, name, market, dividend_yield) VALUES (?, ?, ?, ?)",
            [
                ("000001.SZ", "平安银行", "A", None),
                ("000002.SZ", "万科A", "A", 0.0),
                ("600519.SH", "贵州茅台", "A", 1.5),
                ("00700.HK", "腾讯控股", "HK", None),
            ],
        )

        rows = select_dividend_update_targets(conn, limit=2, only_missing=True)

    assert [row["symbol"] for row in rows] == ["000001.SZ", "000002.SZ"]


def test_migrate_dividend_yields_updates_sqlite_row(tmp_path: Path):
    class FakeAk:
        @staticmethod
        def stock_dividend_cninfo(symbol: str):
            import pandas as pd

            assert symbol == "000001"
            return pd.DataFrame([{"除权日": "2026-04-01", "派息比例": 3.0}])

    db_path = tmp_path / "midas-test.sqlite3"
    with connect_db(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE stock_fundamentals (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                market TEXT NOT NULL,
                dividend_yield REAL,
                updated_at TEXT
            );
            CREATE TABLE stock_daily_prices (
                symbol TEXT NOT NULL,
                trade_date TEXT NOT NULL,
                close REAL NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT INTO stock_fundamentals (symbol, name, market, dividend_yield, updated_at) VALUES (?, ?, ?, ?, ?)",
            ("000001.SZ", "平安银行", "A", None, "old"),
        )
        conn.execute(
            "INSERT INTO stock_daily_prices (symbol, trade_date, close) VALUES (?, ?, ?)",
            ("000001.SZ", "2026-04-30", 10.0),
        )

        stats = migrate_dividend_yields_to_midas(conn, limit=1, ak=FakeAk)
        row = conn.execute("SELECT dividend_yield FROM stock_fundamentals WHERE symbol = '000001.SZ'").fetchone()

    assert stats == DividendUpdateStats(total=1, updated=1, failed=0)
    assert row["dividend_yield"] == 3.0


if __name__ == "__main__":
    raise SystemExit(main())
