import os
import random
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from queue import Queue
from typing import Any, Callable, Iterable, TypeVar

import pandas as pd

from app.database import upsert_stocks
from app.signals import calculate_ma120_fields
from app.timeutils import now_iso


SW_FIRST_INDUSTRY_BY_CODE_PREFIX = {
    "33": "家用电器",
    "34": "食品饮料",
    "48": "银行",
    "49": "非银金融",
}

T = TypeVar("T")


class RetryableSyncError(RuntimeError):
    pass


class RateLimiter:
    def __init__(self, default_rps: float, overrides: dict[str, float] | None = None):
        self.default_rps = max(0.1, default_rps)
        self.overrides = overrides or {}
        self._next_allowed: dict[str, float] = {}
        self._lock = threading.Lock()

    def acquire(self, bucket: str) -> None:
        now = time.monotonic()
        rps = max(0.1, self.overrides.get(bucket, self.default_rps))
        interval = 1.0 / rps
        with self._lock:
            next_allowed = self._next_allowed.get(bucket, now)
            wait_seconds = max(0.0, next_allowed - now)
            self._next_allowed[bucket] = max(next_allowed, now) + interval
        if wait_seconds > 0:
            time.sleep(wait_seconds)


def env_int(name: str, default: int, min_value: int = 1) -> int:
    try:
        return max(min_value, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def env_float(name: str, default: float, min_value: float = 0.1) -> float:
    try:
        return max(min_value, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def get_fetch_concurrency() -> int:
    return env_int("MIDAS_AKSHARE_FETCH_CONCURRENCY", 4)


def get_pipeline_queue_size() -> int:
    return env_int("MIDAS_AKSHARE_PIPELINE_QUEUE_SIZE", 8)


def get_retry_max_attempts() -> int:
    return env_int("MIDAS_AKSHARE_RETRY_MAX_ATTEMPTS", 3)


def get_retry_base_delay_ms() -> int:
    return env_int("MIDAS_AKSHARE_RETRY_BASE_DELAY_MS", 300, min_value=50)


def get_retry_max_delay_ms() -> int:
    return env_int("MIDAS_AKSHARE_RETRY_MAX_DELAY_MS", 5000, min_value=100)


def get_rate_limit_rps_default() -> float:
    return env_float("MIDAS_AKSHARE_RATE_LIMIT_RPS", 5.0)


def get_rate_limit_rps_overrides() -> dict[str, float]:
    raw = os.getenv("MIDAS_AKSHARE_RATE_LIMIT_RPS_OVERRIDES", "").strip()
    overrides: dict[str, float] = {}
    if not raw:
        return overrides
    for chunk in raw.split(","):
        if "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        key = key.strip()
        if not key:
            continue
        try:
            overrides[key] = max(0.1, float(value.strip()))
        except ValueError:
            continue
    return overrides


def retry_call(
    fn: Callable[[], T],
    *,
    attempts: int,
    base_delay_ms: int,
    max_delay_ms: int,
    should_retry: Callable[[Exception], bool] | None = None,
) -> T:
    effective_attempts = max(1, attempts)
    for attempt in range(1, effective_attempts + 1):
        try:
            return fn()
        except Exception as exc:
            can_retry = attempt < effective_attempts and (should_retry(exc) if should_retry else True)
            if not can_retry:
                raise
            backoff_ms = min(max_delay_ms, base_delay_ms * (2 ** (attempt - 1)))
            jitter = random.uniform(0.7, 1.3)
            time.sleep((backoff_ms * jitter) / 1000)
    raise RuntimeError("unreachable")


def should_retry_exception(exc: Exception) -> bool:
    if isinstance(exc, RetryableSyncError):
        return True
    text = str(exc).lower()
    retry_keywords = ("timeout", "timed out", "tempor", "连接", "reset", "429", "频率", "rate")
    return any(keyword in text for keyword in retry_keywords)


def concurrent_collect(
    items: list[Any],
    worker: Callable[[Any], T],
    progress_callback,
    message_prefix: str,
) -> tuple[list[T], int]:
    total = len(items)
    if total == 0:
        return [], 0

    completed = 0
    results: list[T] = []
    errors = 0
    max_workers = min(get_fetch_concurrency(), total)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(worker, item) for item in items]
        for future in as_completed(futures):
            completed += 1
            try:
                result = future.result()
            except Exception:
                errors += 1
                notify_progress(progress_callback, completed, total, f"{message_prefix} {completed}/{total}")
                continue
            if result is not None:
                results.append(result)
            notify_progress(progress_callback, completed, total, f"{message_prefix} {completed}/{total}")
    return results, errors


def sync_config() -> dict[str, Any]:
    return {
        "retry_attempts": get_retry_max_attempts(),
        "retry_base_delay_ms": get_retry_base_delay_ms(),
        "retry_max_delay_ms": get_retry_max_delay_ms(),
        "rate_limiter": RateLimiter(get_rate_limit_rps_default(), get_rate_limit_rps_overrides()),
    }


def guarded_ak_call(config: dict[str, Any], bucket: str, fn: Callable[[], T]) -> T:
    limiter: RateLimiter = config["rate_limiter"]
    limiter.acquire(bucket)
    return retry_call(
        fn,
        attempts=int(config["retry_attempts"]),
        base_delay_ms=int(config["retry_base_delay_ms"]),
        max_delay_ms=int(config["retry_max_delay_ms"]),
        should_retry=should_retry_exception,
    )


def run_sync(conn: sqlite3.Connection, request, progress_callback=None) -> tuple[int, int, str]:
    config = sync_config()
    timestamp = now_iso()
    if request.update_mode.value == "price_only":
        updated = update_latest_prices_pipeline(conn, request, timestamp, progress_callback, config)
        conn.commit()
        return updated, 0, f"现价更新完成，共写入 {updated} 条记录"

    updated = update_full_sync_pipeline(conn, request, timestamp, progress_callback, config)
    conn.commit()
    return updated, 0, f"全量真实行情数据更新完成，共写入 {updated} 条记录"


def update_full_sync_pipeline(
    conn: sqlite3.Connection,
    request,
    timestamp: str,
    progress_callback=None,
    config: dict[str, Any] | None = None,
) -> int:
    runtime = config or sync_config()
    rows = list(fetch_akshare_rows(request, None))
    if not rows:
        raise RuntimeError("AkShare 未返回可写入的股票数据")

    total = len(rows)
    batch_size = max(1, min(200, get_sync_limit(request)))
    queue_size = max(1, get_pipeline_queue_size())
    queue: Queue[list[tuple] | None] = Queue(maxsize=queue_size)

    def producer() -> None:
        for start in range(0, total, batch_size):
            queue.put(rows[start : start + batch_size])
        queue.put(None)

    producer_thread = threading.Thread(target=producer, daemon=True)
    producer_thread.start()

    updated = 0
    persisted = 0
    while True:
        batch = queue.get()
        if batch is None:
            break
        updated += upsert_stocks(conn, batch, timestamp)
        persisted += len(batch)
        notify_progress(progress_callback, persisted, total, f"正在全量更新 {persisted}/{total}")

    producer_thread.join()
    return updated


def update_latest_prices_pipeline(
    conn: sqlite3.Connection,
    request,
    timestamp: str,
    progress_callback=None,
    config: dict[str, Any] | None = None,
) -> int:
    import akshare as ak

    runtime = config or sync_config()
    targets = get_price_update_targets(conn, request)
    if not targets:
        raise RuntimeError("仅更新现价需要先完成一次全量更新")

    total = len(targets)
    queue: Queue[dict[str, Any] | None] = Queue(maxsize=max(1, get_pipeline_queue_size() * 4))

    def worker(stock: sqlite3.Row) -> dict[str, Any]:
        code = strip_symbol(stock["symbol"])
        hist = fetch_history(ak, code, request, runtime)
        if hist is None or hist.empty or "收盘" not in hist.columns:
            raise RuntimeError("history empty")

        latest = hist.tail(1).iloc[0]
        close = to_float(latest.get("收盘"))
        if close <= 0:
            raise RuntimeError("close invalid")

        previous_close = close
        if len(hist.index) >= 2:
            previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=close)

        pct_change = compute_pct_change(close, previous_close, latest.get("涨跌幅"))
        ma_fields = calculate_ma120_fields(close, to_float(stock["ma120"]))
        return {
            "symbol": stock["symbol"],
            "latest_trade_date": latest_date_str(latest.get("日期"), request),
            "open": to_float(latest.get("开盘"), default=close),
            "close": close,
            "high": to_float(latest.get("最高"), default=close),
            "low": to_float(latest.get("最低"), default=close),
            "volume": int(to_float(latest.get("成交量"), default=0)),
            "amount": to_float(latest.get("成交额")),
            "pct_change": pct_change,
            "ma_fields": ma_fields,
            "price_rows": history_price_rows(stock["symbol"], hist, request),
        }

    def producer() -> None:
        with ThreadPoolExecutor(max_workers=min(get_fetch_concurrency(), total)) as executor:
            futures = [executor.submit(worker, stock) for stock in targets]
            for future in as_completed(futures):
                try:
                    payload = future.result()
                except Exception:
                    continue
                queue.put(payload)
        queue.put(None)

    producer_thread = threading.Thread(target=producer, daemon=True)
    producer_thread.start()

    updated = 0
    persisted = 0
    while True:
        payload = queue.get()
        if payload is None:
            break
        conn.execute(
            """
            UPDATE stock_fundamentals
            SET signal=?, ma120_lower=?, ma120_upper=?, updated_at=?
            WHERE symbol=?
            """,
            (
                payload["ma_fields"]["signal"],
                payload["ma_fields"]["ma120_lower"],
                payload["ma_fields"]["ma120_upper"],
                timestamp,
                payload["symbol"],
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
                payload["symbol"],
                payload["latest_trade_date"],
                payload["open"],
                payload["close"],
                payload["high"],
                payload["low"],
                payload["volume"],
                payload["amount"],
                payload["pct_change"],
                payload["pct_change"],
                timestamp,
            ),
        )
        for price_row in payload["price_rows"]:
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
                    payload["symbol"],
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
                ),
            )
        persisted += 1
        updated += 1 + max(1, len(payload["price_rows"]))
        notify_progress(progress_callback, persisted, total, f"正在更新现价 {persisted}/{total}")

    producer_thread.join()

    if updated == 0:
        raise RuntimeError("AkShare 未返回可写入的现价数据")

    return updated


def fetch_akshare_rows(request, progress_callback=None, config: dict[str, Any] | None = None) -> Iterable[tuple]:
    import akshare as ak

    runtime = config or sync_config()

    try:
        spot = guarded_ak_call(runtime, "spot", lambda: ak.stock_zh_a_spot_em())
    except Exception as exc:
        return fetch_rows_from_code_names(ak, request, exc, progress_callback, runtime)

    if spot is None or spot.empty:
        return fetch_rows_from_code_names(
            ak,
            request,
            RuntimeError("AkShare 实时行情接口返回空数据"),
            progress_callback,
            runtime,
        )

    selected = select_spot_rows(spot, request)
    sw_industry_lookup = build_sw_industry_lookup(
        ak,
        [normalize_symbol(str(item.get("代码", "")).strip()) for _, item in selected.iterrows() if str(item.get("代码", "")).strip()],
        runtime,
    )
    spot_items = [item for _, item in selected.iterrows() if str(item.get("代码", "")).strip()]

    def worker(item) -> tuple:
        return convert_spot_row(item, request, ak, sw_industry_lookup, runtime)

    rows, history_errors = concurrent_collect(spot_items, worker, progress_callback, "正在全量更新")

    if not rows:
        return fetch_rows_from_code_names(
            ak,
            request,
            RuntimeError(f"AkShare 快照行情可用，但日线行情不可用；失败 {history_errors} 条"),
            progress_callback,
            runtime,
        )

    return rows


def fetch_rows_from_code_names(
    ak: Any,
    request,
    cause: Exception,
    progress_callback=None,
    config: dict[str, Any] | None = None,
) -> list[tuple]:
    runtime = config or sync_config()
    selected = select_code_name_rows(fetch_code_name_rows(ak, request, runtime), request)
    sw_industry_lookup = build_sw_industry_lookup(
        ak,
        [normalize_symbol(str(item["code"]).strip().zfill(6)) for item in selected if str(item["code"]).strip()],
        runtime,
    )

    def worker(item: dict[str, str]) -> tuple:
        return convert_code_name_row(item, request, ak, sw_industry_lookup, runtime)

    rows, row_errors = concurrent_collect(selected, worker, progress_callback, "正在全量更新")

    if not rows:
        raise RuntimeError(f"AkShare 备用真实数据接口不可用: {cause}; 失败 {row_errors} 条")

    return rows


def fetch_code_name_rows(ak: Any, request, config: dict[str, Any] | None = None) -> list[dict[str, str]]:
    if request.symbols:
        requested_codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
    else:
        requested_codes = set()

    runtime = config or sync_config()

    try:
        code_names = guarded_ak_call(runtime, "code_name", lambda: ak.stock_info_a_code_name())
    except Exception:
        if not requested_codes:
            raise
        return [{"code": code, "name": code} for code in sorted(requested_codes)]

    if code_names is None or code_names.empty:
        if not requested_codes:
            raise RuntimeError("AkShare A 股代码列表接口返回空数据")
        return [{"code": code, "name": code} for code in sorted(requested_codes)]

    rows = []
    for _, row in code_names.iterrows():
        code = str(row.get("code", row.get("证券代码", row.get("代码", "")))).strip().zfill(6)
        name = str(row.get("name", row.get("证券简称", row.get("名称", code)))).strip() or code
        if code:
            rows.append({"code": code, "name": name})
    return rows


def select_code_name_rows(rows: list[dict[str, str]], request) -> list[dict[str, str]]:
    if request.symbols:
        codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
        rows = [row for row in rows if row["code"] in codes]

    return rows[: get_sync_limit(request)]


def select_spot_rows(spot, request):
    if request.symbols:
        codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
        spot = spot[spot["代码"].astype(str).isin(codes)]

    return spot.head(get_sync_limit(request))


def get_sync_limit(request=None) -> int:
    if request is not None and getattr(request, "full_universe", False):
        return 10000
    if request is not None and getattr(request, "limit", None):
        return request.limit
    try:
        return max(1, int(os.getenv("MIDAS_AKSHARE_LIMIT", "300")))
    except ValueError:
        return 300


def convert_spot_row(
    item,
    request,
    ak,
    sw_industry_lookup: dict[str, str] | None = None,
    config: dict[str, Any] | None = None,
) -> tuple:
    code = str(item.get("代码", "")).strip()
    symbol = normalize_symbol(code)
    name = str(item.get("名称", code))
    company_metadata = enrich_company_metadata(ak, code, fetch_company_metadata(ak, code, config), sw_industry_lookup, config)
    price = to_float(item.get("最新价"))
    pct_change = to_float(item.get("涨跌幅"))
    market_cap = to_float(item.get("总市值")) / 100000000
    pe = to_float(item.get("市盈率-动态"))
    pb = to_float(item.get("市净率"))
    dividend = to_float(item.get("股息率"))
    if market_cap <= 0 or pe <= 0 or pb <= 0 or dividend <= 0:
        metrics = fetch_fundamental_metrics(ak, code, config)
        market_cap = market_cap if market_cap > 0 else metrics.get("market_cap", 0.0)
        pe = pe if pe > 0 else metrics.get("pe", 0.0)
        pb = pb if pb > 0 else metrics.get("pb", 0.0)
        dividend = dividend if dividend > 0 else metrics.get("dividend", 0.0)
    open_price = to_float(item.get("今开"), default=price)
    high = to_float(item.get("最高"), default=max(price, open_price))
    low = to_float(item.get("最低"), default=min(price, open_price))
    volume = int(to_float(item.get("成交量"), default=0))
    amount = to_float(item.get("成交额"))

    hist = fetch_history(ak, code, request, config)
    if hist is None or hist.empty or "收盘" not in hist.columns:
        raise RuntimeError(f"{symbol} 日线为空")

    closes = hist["收盘"].dropna().astype(float).tail(120)
    if closes.empty:
        raise RuntimeError(f"{symbol} 收盘价为空")

    latest = hist.tail(1).iloc[0]
    trade_date = latest_date_str(latest.get("日期"), request)
    if is_history_range_requested(request):
        price = to_float(latest.get("收盘"), default=price)
        open_price = to_float(latest.get("开盘"), default=price)
        high = to_float(latest.get("最高"), default=max(price, open_price))
        low = to_float(latest.get("最低"), default=min(price, open_price))
        volume = int(to_float(latest.get("成交量"), default=volume))
        amount = to_float(latest.get("成交额"), default=amount)
        if len(hist.index) >= 2:
            previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=price)
            pct_change = compute_pct_change(price, previous_close, latest.get("涨跌幅"))
    ma120 = round(float(closes.mean()), 2)
    if dividend <= 0:
        dividend = fetch_dividend_yield(ak, code, price, trade_date, config)
    revenue_segments = fetch_revenue_segments(ak, code, config)

    return (
        symbol,
        name,
        "A",
        company_metadata["exchange"],
        company_metadata["ownership"],
        company_metadata["sector"],
        market_cap,
        pe,
        dividend,
        pb,
        0.0,
        price,
        pct_change,
        ma120,
        name[:1].upper(),
        trade_date,
        open_price,
        high,
        low,
        volume,
        amount,
        listing_exchange_name(code),
        revenue_segments,
        history_price_rows(symbol, hist, request),
    )


def convert_code_name_row(
    item: dict[str, str],
    request,
    ak,
    sw_industry_lookup: dict[str, str] | None = None,
    config: dict[str, Any] | None = None,
) -> tuple:
    code = item["code"]
    symbol = normalize_symbol(code)
    name = item["name"]
    company_metadata = enrich_company_metadata(ak, code, fetch_company_metadata(ak, code, config), sw_industry_lookup, config)
    hist = fetch_history(ak, code, request, config)
    if hist is None or hist.empty or "收盘" not in hist.columns:
        raise RuntimeError(f"{symbol} 日线为空")

    latest = hist.tail(1).iloc[0]
    close = to_float(latest.get("收盘"))
    if close <= 0:
        raise RuntimeError(f"{symbol} 收盘价为空")

    previous_close = close
    if len(hist.index) >= 2:
        previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=close)

    pct_change = compute_pct_change(close, previous_close, latest.get("涨跌幅"))
    closes = hist["收盘"].dropna().astype(float).tail(120)
    if closes.empty:
        raise RuntimeError(f"{symbol} 收盘价为空")

    metrics = fetch_fundamental_metrics(ak, code, config)
    open_price = to_float(latest.get("开盘"), default=close)
    high = to_float(latest.get("最高"), default=max(close, open_price))
    low = to_float(latest.get("最低"), default=min(close, open_price))
    volume = int(to_float(latest.get("成交量"), default=0))
    amount = to_float(latest.get("成交额"))
    ma120 = round(float(closes.mean()), 2)
    dividend = metrics.get("dividend", 0.0)
    trade_date = latest_date_str(latest.get("日期"), request)
    if to_float(dividend) <= 0:
        dividend = fetch_dividend_yield(ak, code, close, trade_date, config)
    revenue_segments = fetch_revenue_segments(ak, code, config)

    return (
        symbol,
        metrics.get("name") or name,
        "A",
        company_metadata["exchange"],
        company_metadata["ownership"],
        company_metadata["sector"] or metrics.get("sector"),
        metrics.get("market_cap", 0.0),
        metrics.get("pe", 0.0),
        dividend,
        metrics.get("pb", 0.0),
        0.0,
        close,
        pct_change,
        ma120,
        (metrics.get("name") or name)[:1].upper(),
        trade_date,
        open_price,
        high,
        low,
        volume,
        amount,
        listing_exchange_name(code),
        revenue_segments,
        history_price_rows(symbol, hist, request),
    )


def enrich_company_metadata(
    ak: Any,
    code: str,
    company_metadata: dict[str, str],
    sw_industry_lookup: dict[str, str] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, str]:
    symbol = normalize_symbol(code)
    sw_industry = (sw_industry_lookup or {}).get(symbol, "未知")
    if sw_industry and sw_industry != "未知":
        company_metadata["sector"] = sw_industry

    if company_metadata.get("ownership") == "未知":
        company_metadata["ownership"] = infer_ownership_from_shareholders(ak, code, config)

    return company_metadata


def infer_ownership_from_shareholders(ak: Any, code: str, config: dict[str, Any] | None = None) -> str:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(runtime, "holder", lambda: ak.stock_main_stock_holder(stock=code))
    except Exception:
        return "未知"
    if frame is None or frame.empty or "股东名称" not in frame.columns:
        return "未知"

    holder_names = " ".join(
        str(name)
        for name in frame["股东名称"].head(10)
        if "香港中央结算" not in str(name) and "HKSCC" not in str(name)
    )
    return classify_ownership_from_text(holder_names)


def classify_ownership_from_text(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return "未知"
    if any(keyword in text for keyword in ("美的控股", "何享健", "方洪波", "中国平安保险", "民营", "私营")):
        return "民营企业"
    if any(keyword in text for keyword in ("省国有", "省属", "市属", "地方国资", "人民政府国有资产监督管理委员会", "市投资控股")):
        return "地方国企"
    if any(keyword in text for keyword in ("国务院", "中央国资", "招商局", "中国远洋", "中远")):
        return "央企"
    return normalize_company_ownership(text, text)


def build_sw_industry_lookup(ak: Any, symbols: list[str], config: dict[str, Any] | None = None) -> dict[str, str]:
    targets = {symbol.upper(): strip_symbol(symbol).zfill(6) for symbol in symbols}
    lookup = {symbol: "未知" for symbol in targets}
    if not targets:
        return lookup

    runtime = config or sync_config()
    try:
        history = guarded_ak_call(runtime, "industry", lambda: ak.stock_industry_clf_hist_sw())
    except Exception:
        return lookup
    if history is None or history.empty or not {"symbol", "industry_code", "start_date"}.issubset(set(history.columns)):
        return lookup

    history = history.copy()
    history["symbol"] = history["symbol"].astype(str).str.zfill(6)
    history["start_date"] = pd.to_datetime(history["start_date"], errors="coerce")
    for symbol, code in targets.items():
        stock_history = history[history["symbol"] == code].sort_values("start_date")
        if stock_history.empty:
            continue
        industry_code = str(stock_history.iloc[-1].get("industry_code") or "").strip()
        lookup[symbol] = SW_FIRST_INDUSTRY_BY_CODE_PREFIX.get(industry_code[:2], "未知")
    return lookup


def fetch_revenue_segments(ak: Any, code: str, config: dict[str, Any] | None = None) -> list[dict[str, float | str]]:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(
            runtime,
            "revenue",
            lambda: ak.stock_zygc_em(symbol=market_prefixed_code(strip_symbol(code).zfill(6)).upper()),
        )
    except Exception:
        return []
    return extract_top_revenue_segments(frame)


def extract_top_revenue_segments(frame: pd.DataFrame, top: int = 3) -> list[dict[str, float | str]]:
    if frame is None or frame.empty:
        return []

    required = {"报告日期", "分类类型", "主营构成", "主营收入", "收入比例"}
    if not required.issubset(set(frame.columns)):
        return []

    rows = frame.copy()
    rows["报告日期"] = rows["报告日期"].astype(str)
    latest_report_date = rows["报告日期"].max()
    rows = rows[rows["报告日期"] == latest_report_date]

    product_rows = rows[rows["分类类型"].astype(str).str.contains("产品", na=False)]
    if not product_rows.empty:
        rows = product_rows

    rows = rows[~rows["主营构成"].astype(str).str.contains("其他|补充|合计", na=False)]
    rows = rows.assign(
        主营收入=pd.to_numeric(rows["主营收入"], errors="coerce"),
        收入比例=pd.to_numeric(rows["收入比例"], errors="coerce"),
    )
    rows = rows.dropna(subset=["主营构成", "主营收入", "收入比例"])
    rows = rows[rows["主营收入"] > 0].sort_values("主营收入", ascending=False).head(top)

    segments: list[dict[str, float | str]] = []
    for _, row in rows.iterrows():
        ratio = float(row["收入比例"])
        percent = ratio * 100 if abs(ratio) <= 1 else ratio
        segments.append({"name": str(row["主营构成"]).strip(), "revenue_percent": round(percent, 2)})
    return segments


def fetch_dividend_yield(
    ak: Any,
    code: str,
    close: float,
    trade_date: str,
    config: dict[str, Any] | None = None,
) -> float:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(runtime, "dividend", lambda: ak.stock_dividend_cninfo(symbol=code))
    except Exception:
        return 0.0
    return compute_dividend_yield_from_cninfo(frame, close, trade_date)


def compute_dividend_yield_from_cninfo(frame: pd.DataFrame, close: float, trade_date: str) -> float:
    if frame is None or frame.empty or close <= 0 or "派息比例" not in frame.columns:
        return 0.0

    rows = frame.copy()
    rows["派息比例"] = pd.to_numeric(rows["派息比例"], errors="coerce")
    date_column = "除权日" if "除权日" in rows.columns else "派息日" if "派息日" in rows.columns else None
    if date_column is None:
        return 0.0

    rows[date_column] = pd.to_datetime(rows[date_column], errors="coerce")
    end = pd.to_datetime(trade_date, errors="coerce")
    if pd.isna(end):
        end = pd.Timestamp(date.today())
    start = end - pd.Timedelta(days=365)
    rows = rows[(rows[date_column] <= end) & (rows[date_column] >= start)]
    dividend_per_ten_shares = rows["派息比例"].dropna().sum()
    if dividend_per_ten_shares <= 0:
        return 0.0

    dividend_per_share = float(dividend_per_ten_shares) / 10
    return round(dividend_per_share / close * 100, 2)


def update_latest_prices(
    conn: sqlite3.Connection,
    request,
    timestamp: str,
    progress_callback=None,
    config: dict[str, Any] | None = None,
) -> int:
    import akshare as ak

    runtime = config or sync_config()
    targets = get_price_update_targets(conn, request)
    if not targets:
        raise RuntimeError("仅更新现价需要先完成一次全量更新")

    def worker(stock: sqlite3.Row) -> dict[str, Any]:
        code = strip_symbol(stock["symbol"])
        hist = fetch_history(ak, code, request, runtime)
        if hist is None or hist.empty or "收盘" not in hist.columns:
            raise RuntimeError("history empty")

        latest = hist.tail(1).iloc[0]
        close = to_float(latest.get("收盘"))
        if close <= 0:
            raise RuntimeError("close invalid")

        previous_close = close
        if len(hist.index) >= 2:
            previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=close)

        pct_change = compute_pct_change(close, previous_close, latest.get("涨跌幅"))
        ma_fields = calculate_ma120_fields(close, to_float(stock["ma120"]))
        return {
            "symbol": stock["symbol"],
            "latest_trade_date": latest_date_str(latest.get("日期"), request),
            "open": to_float(latest.get("开盘"), default=close),
            "close": close,
            "high": to_float(latest.get("最高"), default=close),
            "low": to_float(latest.get("最低"), default=close),
            "volume": int(to_float(latest.get("成交量"), default=0)),
            "amount": to_float(latest.get("成交额")),
            "pct_change": pct_change,
            "ma_fields": ma_fields,
            "price_rows": history_price_rows(stock["symbol"], hist, request),
        }

    payloads, _ = concurrent_collect(list(targets), worker, progress_callback, "正在更新现价")

    updated = 0
    for payload in payloads:
        conn.execute(
            """
            UPDATE stock_fundamentals
            SET signal=?, ma120_lower=?, ma120_upper=?, updated_at=?
            WHERE symbol=?
            """,
            (
                payload["ma_fields"]["signal"],
                payload["ma_fields"]["ma120_lower"],
                payload["ma_fields"]["ma120_upper"],
                timestamp,
                payload["symbol"],
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
                payload["symbol"],
                payload["latest_trade_date"],
                payload["open"],
                payload["close"],
                payload["high"],
                payload["low"],
                payload["volume"],
                payload["amount"],
                payload["pct_change"],
                payload["pct_change"],
                timestamp,
            ),
        )
        for price_row in payload["price_rows"]:
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
                    payload["symbol"],
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
                ),
            )
        updated += 1 + max(1, len(payload["price_rows"]))

    if updated == 0:
        raise RuntimeError("AkShare 未返回可写入的现价数据")

    return updated


def get_price_update_targets(conn: sqlite3.Connection, request) -> list[sqlite3.Row]:
    params: list[object] = []
    where = ["ma120 IS NOT NULL"]

    if request.symbols:
        symbols = [normalize_symbol(strip_symbol(symbol).zfill(6)) for symbol in request.symbols]
        placeholders = ",".join("?" for _ in symbols)
        where.append(f"symbol IN ({placeholders})")
        params.extend(symbols)

    rows = conn.execute(
        f"""
        SELECT symbol, ma120
        FROM stock_fundamentals
        WHERE {' AND '.join(where)}
        ORDER BY market_cap DESC, symbol ASC
        LIMIT ?
        """,
        [*params, get_sync_limit(request)],
    ).fetchall()
    return list(rows)


def fetch_company_metadata(ak: Any, code: str, config: dict[str, Any] | None = None) -> dict[str, str]:
    profile_values = fetch_cninfo_profile_values(ak, code, config)
    xueqiu_values = fetch_xueqiu_basic_values(ak, code, config)

    symbol = normalize_symbol(code)
    return {
        "exchange": normalize_listing_place(profile_values.get("所属市场") or profile_values.get("上市地点"), symbol),
        "ownership": normalize_company_ownership(
            xueqiu_values.get("classi_name") or xueqiu_values.get("公司性质") or xueqiu_values.get("企业性质"),
            xueqiu_values.get("actual_controller") or xueqiu_values.get("实际控制人"),
        ),
        "sector": str(profile_values.get("所属行业") or xueqiu_values.get("industry") or "未分类").strip() or "未分类",
    }


def fetch_cninfo_profile_values(ak: Any, code: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(runtime, "profile", lambda: ak.stock_profile_cninfo(symbol=code))
    except Exception:
        return {}

    if frame is None or frame.empty:
        return {}

    row = frame.iloc[0]
    return {str(key): row.get(key) for key in frame.columns}


def fetch_xueqiu_basic_values(ak: Any, code: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(
            runtime,
            "xueqiu",
            lambda: ak.stock_individual_basic_info_xq(symbol=xueqiu_symbol(code), timeout=8),
        )
    except Exception:
        return {}

    if frame is None or frame.empty or "item" not in frame.columns or "value" not in frame.columns:
        return {}

    return {str(row["item"]): row["value"] for _, row in frame.iterrows()}


def normalize_listing_place(value: object, symbol: str) -> str:
    text = str(value or "").strip()
    if "创业板" in text:
        return "创业板"
    if "北交所" in text or "北京证券交易所" in text:
        return "北交所"
    if text:
        return "沪深"
    return infer_exchange(symbol)


def normalize_company_ownership(classification: object, controller: object) -> str:
    text = f"{classification or ''} {controller or ''}".strip()
    if not text:
        return "未知"

    if any(keyword in text for keyword in ("央企", "国务院国有资产监督管理委员会", "中央汇金", "中央国资")):
        return "央企"
    if any(keyword in text for keyword in ("省属", "市属", "地方国资", "人民政府国有资产监督管理委员会", "国资控股")):
        return "地方国企"
    if any(keyword in text for keyword in ("民营", "私营")):
        return "民营企业"
    if "国有资产监督管理委员会" in text or "财政厅" in text or "财政局" in text:
        return "地方国企"
    if looks_like_private_controller(text):
        return "民营企业"
    return "未知"


def looks_like_private_controller(text: str) -> bool:
    government_markers = ("国资", "财政", "人民政府", "国务院", "委员会", "集团", "公司", "合伙", "基金")
    if any(marker in text for marker in government_markers):
        return False
    chinese_chars = [char for char in text if "\u4e00" <= char <= "\u9fff"]
    return 2 <= len(chinese_chars) <= 8


def fetch_fundamental_metrics(ak: Any, code: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = config or sync_config()
    metrics: dict[str, Any] = {}
    try:
        info = guarded_ak_call(runtime, "fundamental", lambda: ak.stock_individual_info_em(symbol=code, timeout=8))
    except Exception:
        info = None

    if info is not None and not info.empty:
        values = {str(row["item"]): row["value"] for _, row in info.iterrows() if "item" in row and "value" in row}
        metrics = {
            "name": str(values.get("股票简称", "")).strip(),
            "sector": str(values.get("行业", "")).strip(),
            "market_cap": normalize_market_cap_yi(values.get("总市值")),
            "pe": first_float(values, ("市盈率", "市盈率(动态)", "市盈率TTM", "PE(TTM)")),
            "dividend": first_float(values, ("股息率", "股息率(%)", "股息率TTM", "股利支付率")),
            "pb": first_float(values, ("市净率", "PB")),
        }

    if any(to_float(metrics.get(key)) <= 0 for key in ("market_cap", "pe", "pb", "dividend")):
        value_metrics = fetch_value_metrics(ak, code, runtime)
        for key, value in value_metrics.items():
            if to_float(metrics.get(key)) <= 0 and to_float(value) > 0:
                metrics[key] = value

    return metrics


def fetch_value_metrics(ak: Any, code: str, config: dict[str, Any] | None = None) -> dict[str, float]:
    runtime = config or sync_config()
    try:
        frame = guarded_ak_call(runtime, "value", lambda: ak.stock_value_em(symbol=code))
    except Exception:
        return {}

    if frame is None or frame.empty:
        return {}

    latest = frame.tail(1).iloc[0]
    return {
        "market_cap": normalize_market_cap_yi(latest.get("总市值")),
        "pe": first_float(latest, ("PE(TTM)", "PE(静)", "市盈率", "市盈率-动态")),
        "dividend": first_float(latest, ("股息率", "股息率(%)", "股利支付率")),
        "pb": first_float(latest, ("市净率", "PB")),
    }


def first_float(values: Any, keys: tuple[str, ...]) -> float:
    for key in keys:
        value = to_float(values.get(key), default=0.0)
        if value:
            return value
    return 0.0


def normalize_market_cap_yi(value: object) -> float:
    amount = to_float(value)
    if amount <= 0:
        return 0.0
    if amount > 1_000_000:
        return round(amount / 100000000, 2)
    return round(amount, 2)


def fetch_history(ak, code: str, request, config: dict[str, Any] | None = None):
    runtime = config or sync_config()
    errors = []
    for fetcher, bucket in (
        (fetch_history_tx, "history_tx"),
        (fetch_history_sina, "history_sina"),
        (fetch_history_eastmoney, "history_em"),
    ):
        try:
            hist = guarded_ak_call(runtime, bucket, lambda fetcher=fetcher: fetcher(ak, code, request))
        except Exception as exc:
            errors.append(f"{fetcher.__name__}: {exc}")
            continue

        normalized = normalize_history_frame(hist)
        if normalized is not None and not normalized.empty:
            return normalized

    raise RuntimeError(f"{normalize_symbol(code)} 日线行情不可用: {'; '.join(errors)}")


def fetch_history_eastmoney(ak, code: str, request):
    start, end = history_fetch_bounds(request)
    return ak.stock_zh_a_hist(
        symbol=code,
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
        timeout=8,
    )


def fetch_history_tx(ak, code: str, request):
    start, end = history_fetch_bounds(request)
    return ak.stock_zh_a_hist_tx(
        symbol=market_prefixed_code(code),
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
        timeout=8,
    )


def fetch_history_sina(ak, code: str, request):
    start, end = history_fetch_bounds(request)
    return ak.stock_zh_a_daily(
        symbol=market_prefixed_code(code),
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
    )


def normalize_history_frame(hist):
    if hist is None or hist.empty:
        return hist

    if "收盘" in hist.columns:
        return hist

    rename_map = {
        "date": "日期",
        "open": "开盘",
        "close": "收盘",
        "high": "最高",
        "low": "最低",
        "volume": "成交量",
    }
    if "amount" in hist.columns:
        rename_map["amount"] = "成交额" if "volume" in hist.columns else "成交量"

    normalized = hist.rename(columns=rename_map).copy()

    if "成交额" not in normalized.columns:
        normalized["成交额"] = 0.0
    if "涨跌幅" not in normalized.columns:
        normalized["涨跌幅"] = None
    if "成交量" in normalized.columns and "amount" in hist.columns and "volume" not in hist.columns:
        normalized["成交量"] = normalized["成交量"].apply(lambda value: int(to_float(value) * 100))

    return normalized


def history_fetch_bounds(request) -> tuple[date, date]:
    end = getattr(request, "end_date", None) or getattr(request, "trade_date", None) or date.today()
    requested_start = getattr(request, "start_date", None)
    ma_start = end - timedelta(days=260)
    start = min(requested_start, ma_start) if requested_start else ma_start
    return start, end


def is_history_range_requested(request) -> bool:
    return bool(getattr(request, "start_date", None) or getattr(request, "end_date", None))


def history_price_rows(symbol: str, hist, request) -> list[dict[str, object]]:
    if not is_history_range_requested(request) or hist is None or hist.empty or "收盘" not in hist.columns:
        return []

    rows = hist.copy()
    if "日期" not in rows.columns:
        return []

    rows["_trade_date"] = rows["日期"].apply(normalize_trade_date)
    rows = rows[rows["_trade_date"].astype(bool)].sort_values("_trade_date")

    start = getattr(request, "start_date", None)
    end = getattr(request, "end_date", None) or getattr(request, "trade_date", None)
    start_text = start.isoformat() if start else None
    end_text = end.isoformat() if end else None

    price_rows: list[dict[str, object]] = []
    previous_close = 0.0
    for _, row in rows.iterrows():
        trade_date = str(row["_trade_date"])
        close = to_float(row.get("收盘"))
        if close <= 0:
            continue

        provided_pct_change = row.get("涨跌幅")
        pct_change = compute_pct_change(close, previous_close or close, provided_pct_change)
        previous_close = close
        if start_text and trade_date < start_text:
            continue
        if end_text and trade_date > end_text:
            continue

        open_price = to_float(row.get("开盘"), default=close)
        price_rows.append(
            {
                "symbol": symbol,
                "trade_date": trade_date,
                "open": open_price,
                "close": close,
                "high": to_float(row.get("最高"), default=max(close, open_price)),
                "low": to_float(row.get("最低"), default=min(close, open_price)),
                "volume": int(to_float(row.get("成交量"), default=0)),
                "amount": to_float(row.get("成交额")),
                "pct_change": pct_change,
            }
        )

    return price_rows


def compute_pct_change(close: float, previous_close: float, provided: object = None) -> float:
    value = to_float(provided, default=0.0)
    if value:
        return round(value, 2)
    if previous_close <= 0:
        return 0.0
    return round((close - previous_close) / previous_close * 100, 2)


def notify_progress(progress_callback, completed: int, total: int, message: str) -> None:
    if progress_callback:
        progress_callback(completed, total, message)


def latest_date_str(value: object, request) -> str:
    if request.trade_date and not is_history_range_requested(request):
        return request.trade_date.isoformat()
    return normalize_trade_date(value)


def normalize_trade_date(value: object) -> str:
    if value is None:
        return date.today().isoformat()
    parsed = pd.to_datetime(value, errors="coerce")
    if not pd.isna(parsed):
        return parsed.date().isoformat()
    text = str(value).strip()
    return text[:10] if text else date.today().isoformat()


def to_float(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        text = str(value).replace(",", "").replace("%", "").strip()
        if text in {"", "-", "nan", "None"}:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def strip_symbol(symbol: str) -> str:
    return symbol.split(".")[0]


def listing_exchange_name(symbol_or_code: str) -> str:
    plain_code = strip_symbol(str(symbol_or_code or "")).strip().zfill(6)
    return infer_exchange(plain_code)


def market_prefixed_code(code: str) -> str:
    if code.startswith(("8", "4", "920")):
        return f"bj{code}"
    if code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def normalize_symbol(code: str) -> str:
    if code.startswith(("8", "4", "920")):
        return f"{code}.BJ"
    if code.startswith("6"):
        return f"{code}.SH"
    return f"{code}.SZ"


def xueqiu_symbol(code: str) -> str:
    symbol = normalize_symbol(code)
    code_part, suffix = symbol.split(".")
    return f"{suffix}{code_part}"


def infer_exchange(symbol: str) -> str:
    if symbol.startswith(("300", "301")):
        return "创业板"
    if symbol.startswith(("8", "4", "920")) or symbol.endswith(".BJ"):
        return "北交所"
    return "沪深"
