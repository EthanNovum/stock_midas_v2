import json
import os
import sqlite3
from pathlib import Path
from typing import Iterable

from .signals import calculate_ma120_fields
from .timeutils import now_iso


def get_db_path() -> Path:
    configured = os.getenv("MIDAS_DB_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "data" / "midas.sqlite3"


def connect() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_database() -> None:
    with connect() as conn:
        create_schema(conn)
        seed_database(conn)


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS stock_fundamentals (
            symbol TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            market TEXT NOT NULL,
            exchange TEXT,
            listing_exchange TEXT,
            ownership TEXT,
            sector TEXT,
            market_cap REAL,
            pe_ttm REAL,
            dividend_yield REAL,
            pb REAL,
            roe REAL,
            ma120 REAL,
            ma120_lower REAL,
            ma120_upper REAL,
            signal TEXT,
            revenue_segments_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stock_metadata_overrides (
            symbol TEXT PRIMARY KEY,
            sector TEXT,
            ownership TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stock_daily_prices (
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
        );

        CREATE TABLE IF NOT EXISTS quote_trends (
            id INTEGER PRIMARY KEY,
            symbol TEXT NOT NULL,
            point_index INTEGER NOT NULL,
            value REAL NOT NULL,
            UNIQUE(symbol, point_index)
        );

        CREATE TABLE IF NOT EXISTS news (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            published_at TEXT NOT NULL,
            display_time TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS watchlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            group_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS watchlist_items (
            id INTEGER PRIMARY KEY,
            watchlist_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(watchlist_id, symbol)
        );

        CREATE TABLE IF NOT EXISTS portfolios (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            cash REAL NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY,
            portfolio_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            quantity REAL NOT NULL,
            cost REAL NOT NULL,
            price REAL NOT NULL,
            sector TEXT
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY,
            portfolio_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity REAL NOT NULL,
            price REAL NOT NULL,
            traded_at TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS allocation (
            id INTEGER PRIMARY KEY,
            portfolio_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            value REAL NOT NULL,
            color TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_reports (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ticker TEXT NOT NULL,
            ticker_name TEXT NOT NULL,
            rating TEXT NOT NULL,
            institution TEXT NOT NULL,
            report_date TEXT NOT NULL,
            content TEXT NOT NULL,
            source_url TEXT,
            source_file_name TEXT,
            source_file_mime TEXT,
            source_file_data BLOB,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS report_stocks (
            id INTEGER PRIMARY KEY,
            report_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            verdict TEXT NOT NULL DEFAULT 'flat',
            UNIQUE(report_id, symbol)
        );

        CREATE TABLE IF NOT EXISTS report_institutions (
            name TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS report_klines (
            id INTEGER PRIMARY KEY,
            report_id TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL NOT NULL,
            close REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            volume INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY,
            theme TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS data_sync_jobs (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            scopes_json TEXT NOT NULL,
            markets_json TEXT NOT NULL,
            symbols_json TEXT,
            trade_date TEXT,
            start_date TEXT,
            end_date TEXT,
            full_refresh INTEGER NOT NULL,
            full_universe INTEGER NOT NULL DEFAULT 0,
            limit_value INTEGER NOT NULL DEFAULT 300,
            update_mode TEXT NOT NULL DEFAULT 'full',
            total_tasks INTEGER NOT NULL DEFAULT 0,
            completed_tasks INTEGER NOT NULL DEFAULT 0,
            updated_rows INTEGER NOT NULL DEFAULT 0,
            failed_rows INTEGER NOT NULL DEFAULT 0,
            message TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            read INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_stock_daily_prices_symbol_date
            ON stock_daily_prices(symbol, trade_date);
        CREATE INDEX IF NOT EXISTS idx_stock_daily_prices_date_symbol
            ON stock_daily_prices(trade_date, symbol);
        CREATE INDEX IF NOT EXISTS idx_stock_fundamentals_market_cap_symbol
            ON stock_fundamentals(market_cap DESC, symbol ASC);
        """
    )
    ensure_column(conn, "data_sync_jobs", "limit_value", "INTEGER NOT NULL DEFAULT 300")
    ensure_column(conn, "data_sync_jobs", "update_mode", "TEXT NOT NULL DEFAULT 'full'")
    ensure_column(conn, "data_sync_jobs", "start_date", "TEXT")
    ensure_column(conn, "data_sync_jobs", "end_date", "TEXT")
    ensure_column(conn, "data_sync_jobs", "full_universe", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "data_sync_jobs", "total_tasks", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "data_sync_jobs", "completed_tasks", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "trades", "note", "TEXT NOT NULL DEFAULT ''")
    ensure_column(conn, "stock_fundamentals", "listing_exchange", "TEXT")
    ensure_column(conn, "stock_fundamentals", "revenue_segments_json", "TEXT NOT NULL DEFAULT '[]'")
    ensure_column(conn, "research_reports", "source_url", "TEXT")
    ensure_column(conn, "research_reports", "source_file_name", "TEXT")
    ensure_column(conn, "research_reports", "source_file_mime", "TEXT")
    ensure_column(conn, "research_reports", "source_file_data", "BLOB")
    ensure_column(conn, "report_stocks", "verdict", "TEXT NOT NULL DEFAULT 'flat'")
    conn.execute("DROP TABLE IF EXISTS llm_models")
    backfill_report_stocks(conn)
    backfill_report_watchlist(conn)
    conn.execute("UPDATE stock_fundamentals SET ownership = '民营企业' WHERE ownership = '民企'")


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def backfill_report_stocks(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO report_stocks (report_id, symbol, name)
        SELECT id, ticker, ticker_name
        FROM research_reports
        WHERE ticker IS NOT NULL AND ticker != ''
        """
    )


def backfill_report_watchlist(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO watchlists (id, name, group_type, created_at)
        VALUES ('sector-report-watchlist', '研报', 'sector', datetime('now'))
        """
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol, note, created_at)
        SELECT 'sector-report-watchlist', rs.symbol, NULL, datetime('now')
        FROM report_stocks rs
        WHERE rs.symbol IS NOT NULL AND rs.symbol != ''
        """
    )


def seed_database(conn: sqlite3.Connection) -> None:
    timestamp = now_iso()
    clean_demo_screener_data(conn)
    clean_demo_dashboard_data(conn)

    if not conn.execute("SELECT COUNT(*) FROM portfolios").fetchone()[0]:
        seed_portfolio(conn, timestamp)
    seed_default_watchlist(conn, timestamp)
    if not conn.execute("SELECT COUNT(*) FROM research_reports").fetchone()[0]:
        seed_reports(conn, timestamp)
    if not conn.execute("SELECT COUNT(*) FROM user_settings").fetchone()[0]:
        seed_settings(conn, timestamp)
    if not conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0]:
        seed_notifications(conn, timestamp)
    conn.commit()


def clean_demo_screener_data(conn: sqlite3.Connection) -> None:
    demo_symbols = ("600519.SH", "300750.SZ", "002594.SZ", "600036.SH")
    placeholders = ",".join("?" for _ in demo_symbols)
    conn.execute(
        f"""
        DELETE FROM stock_daily_prices
        WHERE symbol IN ({placeholders})
            AND trade_date = '2026-04-22'
            AND volume = 1000000
        """,
        demo_symbols,
    )
    conn.execute(
        f"""
        DELETE FROM stock_fundamentals
        WHERE symbol IN ({placeholders})
            AND ownership IN ('央企', '民企', '民营企业')
            AND sector IN ('白酒', '锂电池', '新能源车', '股份制银行')
        """,
        demo_symbols,
    )


def clean_demo_dashboard_data(conn: sqlite3.Connection) -> None:
    demo_watchlist_ids = ("sector-new-energy", "sector-food", "sector-finance")

    conn.execute("DELETE FROM quote_trends")
    conn.execute("DELETE FROM news")

    watchlist_placeholders = ",".join("?" for _ in demo_watchlist_ids)
    conn.execute(
        f"DELETE FROM watchlist_items WHERE watchlist_id IN ({watchlist_placeholders})",
        demo_watchlist_ids,
    )
    conn.execute(
        f"""
        DELETE FROM watchlists
        WHERE id IN ({watchlist_placeholders})
            AND NOT EXISTS (
                SELECT 1
                FROM watchlist_items
                WHERE watchlist_items.watchlist_id = watchlists.id
            )
        """,
        demo_watchlist_ids,
    )


def upsert_stocks(conn: sqlite3.Connection, rows: Iterable[tuple], timestamp: str | None = None) -> int:
    timestamp = timestamp or now_iso()

    fundamentals_params: list[tuple] = []
    latest_price_params: list[tuple] = []
    historical_price_params: list[tuple] = []

    updated = 0
    for row in rows:
        normalized = normalize_stock_row(row)
        ma_fields = calculate_ma120_fields(normalized["close"], normalized["ma120"])
        fundamentals_params.append(
            (
                normalized["symbol"],
                normalized["name"],
                normalized["market"],
                normalized["exchange"],
                normalized["listing_exchange"],
                normalized["ownership"],
                normalized["sector"],
                normalized["market_cap"],
                normalized["pe_ttm"],
                normalized["dividend_yield"],
                normalized["pb"],
                normalized["roe"],
                ma_fields["ma120"],
                ma_fields["ma120_lower"],
                ma_fields["ma120_upper"],
                ma_fields["signal"],
                normalized["revenue_segments_json"],
                timestamp,
            )
        )
        latest_price_params.append(
            (
                normalized["symbol"],
                normalized["trade_date"],
                normalized["open"],
                normalized["close"],
                normalized["high"],
                normalized["low"],
                normalized["volume"],
                normalized["amount"],
                normalized["pct_change"],
                normalized["pct_change"],
                timestamp,
            )
        )
        for price_row in normalized.get("daily_prices", []):
            historical_price_params.append(
                (
                    normalized["symbol"],
                    price_row["trade_date"],
                    price_row["open"],
                    price_row["close"],
                    price_row["high"],
                    price_row["low"],
                    price_row["volume"],
                    price_row["amount"],
                    price_row["pct_change"],
                    price_row["pct_change"],
                    timestamp,
                )
            )
        updated += 2

    if fundamentals_params:
        conn.executemany(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, listing_exchange, ownership, sector, market_cap,
                pe_ttm, dividend_yield, pb, roe, ma120, ma120_lower, ma120_upper,
                signal, revenue_segments_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                name=excluded.name,
                market=excluded.market,
                exchange=excluded.exchange,
                listing_exchange=excluded.listing_exchange,
                ownership=excluded.ownership,
                sector=excluded.sector,
                market_cap=excluded.market_cap,
                pe_ttm=excluded.pe_ttm,
                dividend_yield=excluded.dividend_yield,
                pb=excluded.pb,
                roe=excluded.roe,
                ma120=excluded.ma120,
                ma120_lower=excluded.ma120_lower,
                ma120_upper=excluded.ma120_upper,
                signal=excluded.signal,
                revenue_segments_json=excluded.revenue_segments_json,
                updated_at=excluded.updated_at
            """,
            fundamentals_params,
        )

    price_upsert_sql = """
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
    """

    if latest_price_params:
        conn.executemany(price_upsert_sql, latest_price_params)
    if historical_price_params:
        conn.executemany(price_upsert_sql, historical_price_params)

    return updated


def normalize_stock_row(row: tuple) -> dict:
    if len(row) == 15:
        (
            symbol,
            name,
            market,
            exchange,
            ownership,
            sector,
            market_cap,
            pe_ttm,
            dividend_yield,
            pb,
            roe,
            close,
            pct_change,
            ma120,
            _initial,
        ) = row
        return {
            "symbol": symbol,
            "name": name,
            "market": market,
            "exchange": exchange,
            "listing_exchange": listing_exchange_name(symbol),
            "ownership": normalize_ownership_name(ownership),
            "sector": sector,
            "market_cap": market_cap,
            "pe_ttm": pe_ttm,
            "dividend_yield": dividend_yield,
            "pb": pb,
            "roe": roe,
            "close": close,
            "pct_change": pct_change,
            "ma120": ma120,
            "trade_date": "2026-04-22",
            "open": round(close * 0.99, 2),
            "high": round(close * 1.01, 2),
            "low": round(close * 0.98, 2),
            "volume": 1_000_000,
            "amount": close * 1_000_000,
            "revenue_segments_json": "[]",
        }

    if len(row) in {21, 22, 23, 24}:
        (
            symbol,
            name,
            market,
            exchange,
            ownership,
            sector,
            market_cap,
            pe_ttm,
            dividend_yield,
            pb,
            roe,
            close,
            pct_change,
            ma120,
            _initial,
            trade_date,
            open_price,
            high,
            low,
            volume,
            amount,
            *extra_values,
        ) = row
        listing_exchange = listing_exchange_name(symbol)
        revenue_segments = []
        daily_prices = []
        if len(extra_values) == 1:
            if is_revenue_segments_value(extra_values[0]):
                revenue_segments = extra_values[0]
            else:
                listing_exchange = str(extra_values[0] or listing_exchange)
        elif len(extra_values) >= 2:
            listing_exchange = str(extra_values[0] or listing_exchange)
            revenue_segments = extra_values[1]
            if len(extra_values) >= 3:
                daily_prices = extra_values[2] or []
        return {
            "symbol": symbol,
            "name": name,
            "market": market,
            "exchange": exchange,
            "listing_exchange": listing_exchange,
            "ownership": normalize_ownership_name(ownership),
            "sector": sector,
            "market_cap": market_cap,
            "pe_ttm": pe_ttm,
            "dividend_yield": dividend_yield,
            "pb": pb,
            "roe": roe,
            "close": close,
            "pct_change": pct_change,
            "ma120": ma120,
            "trade_date": trade_date,
            "open": open_price,
            "high": high,
            "low": low,
            "volume": volume,
            "amount": amount,
            "revenue_segments_json": normalize_revenue_segments_json(revenue_segments),
            "daily_prices": daily_prices,
        }

    raise ValueError(f"Unsupported stock row width: {len(row)}")


def listing_exchange_name(symbol_or_code: str) -> str:
    plain_code = str(symbol_or_code or "").split(".")[0].strip().zfill(6)
    if plain_code.startswith(("300", "301")):
        return "创业板"
    if plain_code.startswith(("8", "4", "920", "430")):
        return "北交所"
    return "沪深"


def is_revenue_segments_value(value: object) -> bool:
    if isinstance(value, list):
        return True
    if not isinstance(value, str):
        return False
    stripped = value.strip()
    return stripped.startswith("[") or stripped == ""


def normalize_ownership_name(value: object) -> str:
    text = str(value or "").strip()
    if text == "民企":
        return "民营企业"
    return text


def normalize_revenue_segments_json(value: object) -> str:
    if isinstance(value, str):
        return value or "[]"
    return json_dump(value if value is not None else [])


def seed_portfolio(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute("INSERT OR REPLACE INTO portfolios (id, name, cash, created_at) VALUES (?, ?, ?, ?)", (1, "默认组合", 0.0, timestamp))


def seed_default_watchlist(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO watchlists (id, name, group_type, created_at)
        VALUES ('sector-my-watchlist', '自选分组', 'sector', ?)
        """,
        (timestamp,),
    )
    conn.execute(
        """
        UPDATE watchlists
        SET name='自选分组'
        WHERE id='sector-my-watchlist' AND name='我的自选'
        """
    )


def seed_reports(conn: sqlite3.Connection, timestamp: str) -> None:
    reports = [
        ("1", "宁德时代：全球锂电龙头地位稳固，Q3业绩超预期", "300750.SZ", "宁德时代", "buy", "中信证券", "2024-03-15", "宁德时代在2024年第一季度的全球市场份额进一步扩大。随着神行电池的量产，其在中低端市场的竞争力显著提升。"),
        ("2", "贵州茅台：提价效应显现，高端白酒韧性凸显", "600519.SH", "贵州茅台", "hold", "华泰证券", "2024-03-10", "贵州茅台近期上调出厂价对表内利润有直接贡献。高端品牌溢价能力依然强劲。"),
        ("3", "万科A：行业筑底期，维持谨慎观望", "000002.SZ", "万科A", "sell", "中金公司", "2024-02-28", "房地产市场销售端仍未见明显改善，短期估值提振困难。"),
    ]
    conn.executemany(
        """
        INSERT OR REPLACE INTO research_reports
        (id, title, ticker, ticker_name, rating, institution, report_date, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*report, timestamp) for report in reports],
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO report_stocks (report_id, symbol, name)
        VALUES (?, ?, ?)
        """,
        [(report_id, ticker, ticker_name) for report_id, _, ticker, ticker_name, *_ in reports],
    )
    kline_rows = [
        ("1", "03-15", 175.2, 180.5, 182.1, 174.8, 12000),
        ("1", "03-18", 180.5, 178.2, 181.5, 177.0, 10500),
        ("1", "03-19", 178.2, 182.4, 183.0, 177.5, 11200),
        ("2", "03-10", 1680, 1695, 1705, 1675, 5400),
        ("2", "03-11", 1695, 1702, 1715, 1690, 4800),
        ("3", "02-28", 10.2, 9.8, 10.3, 9.7, 85000),
        ("3", "02-29", 9.8, 9.5, 9.9, 9.4, 92000),
    ]
    conn.executemany(
        "INSERT INTO report_klines (report_id, date, open, close, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)",
        kline_rows,
    )


def seed_settings(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO user_settings (id, theme, updated_at)
        VALUES (1, 'light', ?)
        """,
        (timestamp,),
    )


def seed_notifications(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO notifications (id, title, body, read, created_at) VALUES (?, ?, ?, ?, ?)",
        ("n-1", "市场数据已更新", "A 股行情数据已同步至 15:30", 0, timestamp),
    )


def json_dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)
