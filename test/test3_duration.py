from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
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
class DailyPriceSyncStats:
    total_symbols: int
    updated_symbols: int = 0
    failed_symbols: int = 0
    inserted_or_updated_rows: int = 0


def connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def parse_yyyymmdd(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise argparse.ArgumentTypeError(f"日期格式必须是 yyyymmdd 或 yyyy-mm-dd: {value}")


def resolve_date_range(
    start_date: date | None,
    end_date: date | None,
    days_from_now: int | None,
) -> tuple[date, date]:
    end = end_date or date.today()
    if start_date:
        start = start_date
    else:
        days = days_from_now if days_from_now is not None else 120
        if days <= 0:
            raise ValueError("--days-from-now 必须大于 0")
        start = end - timedelta(days=days)

    if start > end:
        raise ValueError("start_date 不能晚于 end_date")
    return start, end


def normalize_symbol(raw_symbol: str) -> str:
    code = akshare_sync.strip_symbol(str(raw_symbol).strip()).zfill(6)
    return akshare_sync.normalize_symbol(code)


def symbol_code(symbol: str) -> str:
    return akshare_sync.strip_symbol(symbol).zfill(6)


def fetch_a_stock_symbols(ak: Any) -> list[dict[str, str]]:
    frame = ak.stock_info_a_code_name()
    if frame is None or frame.empty:
        raise RuntimeError("AkShare A 股代码列表接口返回空数据")

    rows: list[dict[str, str]] = []
    for _, item in frame.iterrows():
        code = str(item.get("code", item.get("证券代码", item.get("代码", "")))).strip()
        if not code:
            continue
        name = str(item.get("name", item.get("证券简称", item.get("名称", code)))).strip() or code
        rows.append({"symbol": normalize_symbol(code), "name": name})
    return rows


def select_symbols(
    conn: sqlite3.Connection,
    limit: int | None = None,
    symbols: list[str] | None = None,
    ak: Any | None = None,
) -> list[dict[str, str]]:
    if symbols:
        return [{"symbol": normalize_symbol(symbol), "name": normalize_symbol(symbol)} for symbol in symbols[:limit]]

    if ak is None:
        import akshare as ak

    try:
        rows = fetch_a_stock_symbols(ak)
    except Exception:
        rows = [
            {"symbol": row["symbol"], "name": row["name"]}
            for row in conn.execute(
                """
                SELECT symbol, name
                FROM stock_fundamentals
                WHERE market = 'A'
                ORDER BY symbol ASC
                """
            ).fetchall()
        ]

    return rows[:limit] if limit else rows


def build_history_request(start_date: date, end_date: date) -> SimpleNamespace:
    return SimpleNamespace(
        trade_date=None,
        start_date=start_date,
        end_date=end_date,
        symbols=None,
        limit=1,
        full_universe=False,
    )


def upsert_daily_price_rows(
    conn: sqlite3.Connection,
    rows: list[dict[str, object]],
    timestamp: str | None = None,
) -> int:
    if not rows:
        return 0

    updated_at = timestamp or now_iso()
    conn.executemany(
        """
        INSERT INTO stock_daily_prices (
            symbol, trade_date, open, close, high, low, volume, amount,
            change, pct_change, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, trade_date) DO UPDATE SET
            open=excluded.open,
            close=excluded.close,
            high=excluded.high,
            low=excluded.low,
            volume=excluded.volume,
            amount=excluded.amount,
            change=excluded.change,
            pct_change=excluded.pct_change,
            updated_at=excluded.updated_at
        """,
        [
            (
                row["symbol"],
                row["trade_date"],
                row["open"],
                row["close"],
                row["high"],
                row["low"],
                row["volume"],
                row["amount"],
                row["pct_change"],
                row["pct_change"],
                updated_at,
            )
            for row in rows
        ],
    )
    return len(rows)


def fetch_daily_price_rows_for_symbol(
    ak: Any,
    symbol: str,
    start_date: date,
    end_date: date,
) -> list[dict[str, object]]:
    request = build_history_request(start_date, end_date)
    hist = akshare_sync.fetch_history(ak, symbol_code(symbol), request)
    return akshare_sync.history_price_rows(symbol, hist, request)


def migrate_daily_prices_to_midas(
    conn: sqlite3.Connection,
    start_date: date | None = None,
    end_date: date | None = None,
    days_from_now: int | None = None,
    limit: int | None = None,
    symbols: list[str] | None = None,
    progress_callback: Callable[[int, int, str], None] | None = None,
    ak: Any | None = None,
) -> DailyPriceSyncStats:
    if ak is None:
        import akshare as ak

    start, end = resolve_date_range(start_date, end_date, days_from_now)
    targets = select_symbols(conn, limit=limit, symbols=symbols, ak=ak)
    stats = DailyPriceSyncStats(total_symbols=len(targets))

    for index, target in enumerate(targets, start=1):
        symbol = target["symbol"]
        name = target["name"]
        try:
            rows = fetch_daily_price_rows_for_symbol(ak, symbol, start, end)
            if not rows:
                raise RuntimeError("没有返回可写入的日线数据")
            written = upsert_daily_price_rows(conn, rows)
            conn.commit()
            stats.updated_symbols += 1
            stats.inserted_or_updated_rows += written
            message = f"{symbol} {name} 写入 {written} 条日线"
        except Exception as exc:
            conn.rollback()
            stats.failed_symbols += 1
            message = f"{symbol} {name} 更新失败: {exc}"

        if progress_callback:
            progress_callback(index, stats.total_symbols, message)

    return stats


def print_progress(completed: int, total: int, message: str) -> None:
    percent = completed / total * 100 if total else 100
    print(f"[{completed}/{total} {percent:5.1f}%] {message}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取 A 股日线行情并迁移写入 midas.sqlite3")
    parser.add_argument("--start-date", type=parse_yyyymmdd, default=None, help="起始日期，格式 yyyymmdd")
    parser.add_argument("--end-date", type=parse_yyyymmdd, default=None, help="结束日期，格式 yyyymmdd；不传则为今天")
    parser.add_argument("--days-from-now", type=int, default=None, help="从今天向前抓取多少个自然日；未传 start-date 时生效")
    parser.add_argument("--limit", type=int, default=None, help="最多抓取多少只股票；不传则抓取全部 A 股")
    parser.add_argument("--symbols", nargs="*", default=None, help="指定股票代码，例如 600519 000001.SZ")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="sqlite 数据库路径")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.limit is not None and args.limit <= 0:
        raise SystemExit("--limit 必须大于 0")
    if not args.db.exists():
        raise SystemExit(f"数据库不存在: {args.db}")

    with connect_db(args.db) as conn:
        stats = migrate_daily_prices_to_midas(
            conn,
            start_date=args.start_date,
            end_date=args.end_date,
            days_from_now=args.days_from_now,
            limit=args.limit,
            symbols=args.symbols,
            progress_callback=print_progress,
        )

    print(
        "完成: "
        f"symbols={stats.total_symbols}, updated={stats.updated_symbols}, "
        f"failed={stats.failed_symbols}, rows={stats.inserted_or_updated_rows}"
    )
    return 0 if stats.failed_symbols == 0 else 1


def test_resolve_date_range_accepts_yyyymmdd_and_days_from_now():
    start = parse_yyyymmdd("20260101")
    end = parse_yyyymmdd("20260131")

    assert resolve_date_range(start, end, None) == (date(2026, 1, 1), date(2026, 1, 31))
    assert resolve_date_range(None, date(2026, 1, 31), 10) == (date(2026, 1, 21), date(2026, 1, 31))


def test_select_symbols_prefers_explicit_symbols_and_limit(tmp_path: Path):
    db_path = tmp_path / "midas-test.sqlite3"
    with connect_db(db_path) as conn:
        rows = select_symbols(conn, limit=1, symbols=["600519", "000001.SZ"], ak=None)

    assert rows == [{"symbol": "600519.SH", "name": "600519.SH"}]


def test_upsert_daily_price_rows_updates_sqlite_row(tmp_path: Path):
    db_path = tmp_path / "midas-test.sqlite3"
    with connect_db(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE stock_daily_prices (
                id INTEGER PRIMARY KEY,
                symbol TEXT NOT NULL,
                trade_date TEXT NOT NULL,
                open REAL NOT NULL,
                close REAL NOT NULL,
                high REAL,
                low REAL,
                volume INTEGER,
                amount REAL,
                change REAL,
                pct_change REAL,
                updated_at TEXT NOT NULL,
                UNIQUE(symbol, trade_date)
            )
            """
        )

        count = upsert_daily_price_rows(
            conn,
            [
                {
                    "symbol": "600519.SH",
                    "trade_date": "2026-01-02",
                    "open": 10.0,
                    "close": 11.0,
                    "high": 12.0,
                    "low": 9.5,
                    "volume": 1000,
                    "amount": 10000.0,
                    "pct_change": 1.2,
                }
            ],
            timestamp="now",
        )
        upsert_daily_price_rows(
            conn,
            [
                {
                    "symbol": "600519.SH",
                    "trade_date": "2026-01-02",
                    "open": 11.0,
                    "close": 12.0,
                    "high": 12.5,
                    "low": 10.5,
                    "volume": 2000,
                    "amount": 20000.0,
                    "pct_change": 9.09,
                }
            ],
            timestamp="later",
        )
        row = conn.execute(
            "SELECT close, volume, updated_at FROM stock_daily_prices WHERE symbol='600519.SH'"
        ).fetchone()

    assert count == 1
    assert dict(row) == {"close": 12.0, "volume": 2000, "updated_at": "later"}


def test_migrate_daily_prices_to_midas_writes_fake_akshare_rows(tmp_path: Path):
    import pandas as pd

    class FakeAk:
        @staticmethod
        def stock_zh_a_hist_tx(**_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-01-02", "open": 10.0, "close": 11.0, "high": 12.0, "low": 9.5, "amount": 1000},
                    {"date": "2026-01-05", "open": 11.0, "close": 12.0, "high": 12.5, "low": 10.5, "amount": 1200},
                ]
            )

    db_path = tmp_path / "midas-test.sqlite3"
    with connect_db(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE stock_daily_prices (
                id INTEGER PRIMARY KEY,
                symbol TEXT NOT NULL,
                trade_date TEXT NOT NULL,
                open REAL NOT NULL,
                close REAL NOT NULL,
                high REAL,
                low REAL,
                volume INTEGER,
                amount REAL,
                change REAL,
                pct_change REAL,
                updated_at TEXT NOT NULL,
                UNIQUE(symbol, trade_date)
            )
            """
        )

        stats = migrate_daily_prices_to_midas(
            conn,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 5),
            symbols=["600519"],
            ak=FakeAk,
        )
        rows = conn.execute("SELECT symbol, trade_date, close FROM stock_daily_prices ORDER BY trade_date").fetchall()

    assert stats == DailyPriceSyncStats(total_symbols=1, updated_symbols=1, failed_symbols=0, inserted_or_updated_rows=2)
    assert [dict(row) for row in rows] == [
        {"symbol": "600519.SH", "trade_date": "2026-01-02", "close": 11.0},
        {"symbol": "600519.SH", "trade_date": "2026-01-05", "close": 12.0},
    ]


if __name__ == "__main__":
    raise SystemExit(main())
