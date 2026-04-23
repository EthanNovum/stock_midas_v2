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
            traded_at TEXT NOT NULL
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
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            base_url TEXT,
            api_key_ciphertext TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS llm_models (
            id INTEGER PRIMARY KEY,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            base_url TEXT,
            api_key_ciphertext TEXT,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(provider, model)
        );

        CREATE TABLE IF NOT EXISTS data_sync_jobs (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            scopes_json TEXT NOT NULL,
            markets_json TEXT NOT NULL,
            symbols_json TEXT,
            trade_date TEXT,
            full_refresh INTEGER NOT NULL,
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
        """
    )
    ensure_column(conn, "data_sync_jobs", "limit_value", "INTEGER NOT NULL DEFAULT 300")
    ensure_column(conn, "data_sync_jobs", "update_mode", "TEXT NOT NULL DEFAULT 'full'")
    ensure_column(conn, "data_sync_jobs", "total_tasks", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "data_sync_jobs", "completed_tasks", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "user_settings", "base_url", "TEXT")
    ensure_column(conn, "llm_models", "base_url", "TEXT")


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


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
    seed_llm_models(conn, timestamp)
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
            AND ownership IN ('央企', '民企')
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
    updated = 0
    for row in rows:
        normalized = normalize_stock_row(row)
        ma_fields = calculate_ma120_fields(normalized["close"], normalized["ma120"])
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector, market_cap,
                pe_ttm, dividend_yield, pb, roe, ma120, ma120_lower, ma120_upper,
                signal, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                name=excluded.name,
                market=excluded.market,
                exchange=excluded.exchange,
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
                updated_at=excluded.updated_at
            """,
            (
                normalized["symbol"],
                normalized["name"],
                normalized["market"],
                normalized["exchange"],
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
                timestamp,
            ),
        )
        conn.execute(
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
            ),
        )
        updated += 2
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
            "ownership": ownership,
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
        }

    if len(row) == 21:
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
        ) = row
        return {
            "symbol": symbol,
            "name": name,
            "market": market,
            "exchange": exchange,
            "ownership": ownership,
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
        }

    raise ValueError(f"Unsupported stock row width: {len(row)}")


def seed_portfolio(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute("INSERT OR REPLACE INTO portfolios (id, name, cash, created_at) VALUES (?, ?, ?, ?)", (1, "默认组合", 156000.0, timestamp))
    holdings = [
        (1, 1, "AAPL", "苹果公司", 500, 145.2, 173.5, "信息技术"),
        (2, 1, "MSFT", "微软", 300, 310.0, 335.2, "信息技术"),
        (3, 1, "TSLA", "特斯拉", 150, 240.5, 212.8, "可选消费"),
        (4, 1, "NVDA", "英伟达", 100, 280.0, 450.0, "信息技术"),
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO holdings (id, portfolio_id, symbol, name, quantity, cost, price, sector) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        holdings,
    )
    allocation = [
        (1, 1, "信息技术", 45, "#00343e"),
        (2, 1, "可选消费", 25, "#004c59"),
        (3, 1, "医疗保健", 15, "#86d2e5"),
        (4, 1, "现金", 15, "#d0e6f3"),
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO allocation (id, portfolio_id, name, value, color) VALUES (?, ?, ?, ?, ?)",
        allocation,
    )


def seed_default_watchlist(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO watchlists (id, name, group_type, created_at)
        VALUES ('sector-my-watchlist', '我的自选', 'sector', ?)
        """,
        (timestamp,),
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
        INSERT OR REPLACE INTO user_settings (id, theme, provider, model, base_url, api_key_ciphertext, updated_at)
        VALUES (1, 'light', 'openai', 'gpt-4o', NULL, NULL, ?)
        """,
        (timestamp,),
    )


def seed_llm_models(conn: sqlite3.Connection, timestamp: str) -> None:
    if conn.execute("SELECT COUNT(*) FROM llm_models").fetchone()[0]:
        return

    row = conn.execute("SELECT provider, model, base_url FROM user_settings WHERE id=1").fetchone()
    provider = row["provider"] if row else "openai"
    model = row["model"] if row else "gpt-4o"
    base_url = row["base_url"] if row else None
    conn.execute(
        """
        INSERT INTO llm_models (provider, model, base_url, api_key_ciphertext, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 1, ?, ?)
        """,
        (provider, model, base_url, timestamp, timestamp),
    )


def seed_notifications(conn: sqlite3.Connection, timestamp: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO notifications (id, title, body, read, created_at) VALUES (?, ?, ?, ?, ?)",
        ("n-1", "市场数据已更新", "A 股行情数据已同步至 15:30", 0, timestamp),
    )


def json_dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)
