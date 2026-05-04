from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.services import akshare_sync


DEFAULT_SYMBOLS = ("600519", "000001", "600036", "601318", "000333")
SW_FIRST_INDUSTRY_BY_CODE_PREFIX = {
    "33": "家用电器",
    "34": "食品饮料",
    "48": "银行",
    "49": "非银金融",
}


def listing_exchange_name(code: str) -> str:
    plain_code = akshare_sync.strip_symbol(str(code).strip()).zfill(6)
    if plain_code.startswith(("300", "301")):
        return "创业板"
    if plain_code.startswith(("8", "4", "920", "430")):
        return "北交所"
    return "沪深"


def ownership_display_name(value: object) -> str:
    text = str(value or "").strip()
    if text == "民企":
        return "民营企业"
    return text or "未知"


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
    normalized = akshare_sync.normalize_company_ownership(text, text)
    return ownership_display_name(normalized)


def infer_ownership_from_shareholders(ak: Any, code: str) -> str:
    try:
        frame = ak.stock_main_stock_holder(stock=code)
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


def eastmoney_symbol(code: str) -> str:
    return akshare_sync.market_prefixed_code(akshare_sync.strip_symbol(code).zfill(6)).upper()


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


def fetch_revenue_segments(ak: Any, code: str) -> list[dict[str, float | str]]:
    try:
        frame = ak.stock_zygc_em(symbol=eastmoney_symbol(code))
    except Exception:
        return []
    return extract_top_revenue_segments(frame)


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


def fetch_dividend_yield(ak: Any, code: str, close: float, trade_date: str) -> float:
    try:
        frame = ak.stock_dividend_cninfo(symbol=code)
    except Exception:
        return 0.0
    return compute_dividend_yield_from_cninfo(frame, close, trade_date)


def extract_sw_industry_from_constituents(frame: pd.DataFrame, symbol: str) -> str:
    if frame is None or frame.empty or "股票代码" not in frame.columns or "申万1级" not in frame.columns:
        return "未知"
    matches = frame[frame["股票代码"].astype(str).str.upper() == symbol.upper()]
    if matches.empty:
        return "未知"
    industry = str(matches.iloc[0].get("申万1级") or "").strip()
    return industry if industry and industry != "—" else "未知"


def fetch_sw_industry(ak: Any, symbol: str) -> str:
    return build_sw_industry_lookup(ak, [symbol]).get(symbol, "未知")


def build_sw_industry_lookup(ak: Any, symbols: list[str]) -> dict[str, str]:
    targets = {symbol.upper(): akshare_sync.strip_symbol(symbol).zfill(6) for symbol in symbols}
    lookup = {symbol: "未知" for symbol in targets}
    try:
        history = ak.stock_industry_clf_hist_sw()
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


def build_request(symbols: tuple[str, ...] | list[str]) -> SimpleNamespace:
    return SimpleNamespace(symbols=list(symbols), limit=len(symbols), trade_date=None)


def fetch_five_hs_stock_rows(symbols: tuple[str, ...] | list[str] = DEFAULT_SYMBOLS) -> list[dict[str, Any]]:
    import akshare as ak

    request = build_request(symbols)
    rows = []
    code_names = {row["code"]: row["name"] for row in akshare_sync.fetch_code_name_rows(ak, request)}
    normalized_symbols = [akshare_sync.normalize_symbol(akshare_sync.strip_symbol(str(code)).zfill(6)) for code in symbols]
    sw_industry_lookup = build_sw_industry_lookup(ak, normalized_symbols)

    for raw_code in symbols:
        code = akshare_sync.strip_symbol(str(raw_code)).zfill(6)
        source_row = {"code": code, "name": code_names.get(code, code)}
        converted = akshare_sync.convert_code_name_row(source_row, request, ak)
        (
            symbol,
            name,
            _market,
            _exchange,
            ownership,
            _sector,
            market_cap,
            pe,
            dividend,
            _pb,
            _roe,
            close,
            _pct_change,
            ma120,
            _letter,
            trade_date,
            *_daily_values,
        ) = converted

        if float(dividend) <= 0:
            dividend = fetch_dividend_yield(ak, code, float(close), str(trade_date))
        display_ownership = ownership_display_name(ownership)
        if display_ownership == "未知":
            display_ownership = infer_ownership_from_shareholders(ak, code)

        rows.append(
            {
                "股票名称": name,
                "股票代码": symbol,
                "板块": listing_exchange_name(code),
                "行业": sw_industry_lookup.get(symbol, "未知"),
                "最近交易日": trade_date,
                "最近交易日收盘价": round(float(close), 2),
                "MA120": round(float(ma120), 2),
                "市值(亿元)": round(float(market_cap), 2),
                "股息率(%)": round(float(dividend), 2),
                "PE": round(float(pe), 2),
                "公司性质": display_ownership,
                "前三营收业务及其百分比": fetch_revenue_segments(ak, code),
            }
        )
    return rows


def format_rows(rows: list[dict[str, Any]]) -> str:
    printable_rows = []
    for row in rows:
        printable = row.copy()
        printable["前三营收业务及其百分比"] = "; ".join(
            f"{item['name']} {item['revenue_percent']}%" for item in row["前三营收业务及其百分比"]
        )
        printable_rows.append(printable)
    return pd.DataFrame(printable_rows).to_markdown(index=False)


def test_listing_exchange_name_uses_stock_code_prefix():
    assert listing_exchange_name("600519") == "沪深"
    assert listing_exchange_name("000001") == "沪深"
    assert listing_exchange_name("300750") == "创业板"
    assert listing_exchange_name("430047") == "北交所"


def test_extract_top_revenue_segments_prefers_latest_product_rows():
    frame = pd.DataFrame(
        [
            {"报告日期": "2025-12-31", "分类类型": "按行业分类", "主营构成": "酒类", "主营收入": 100.0, "收入比例": 1.0},
            {"报告日期": "2024-12-31", "分类类型": "按产品分类", "主营构成": "旧产品", "主营收入": 99.0, "收入比例": 0.99},
            {"报告日期": "2025-12-31", "分类类型": "按产品分类", "主营构成": "产品 A", "主营收入": 70.0, "收入比例": 0.70},
            {"报告日期": "2025-12-31", "分类类型": "按产品分类", "主营构成": "产品 B", "主营收入": 20.0, "收入比例": 0.20},
            {"报告日期": "2025-12-31", "分类类型": "按产品分类", "主营构成": "产品 C", "主营收入": 10.0, "收入比例": 0.10},
            {"报告日期": "2025-12-31", "分类类型": "按产品分类", "主营构成": "其他(补充)", "主营收入": 1.0, "收入比例": 0.01},
        ]
    )

    assert extract_top_revenue_segments(frame) == [
        {"name": "产品 A", "revenue_percent": 70.0},
        {"name": "产品 B", "revenue_percent": 20.0},
        {"name": "产品 C", "revenue_percent": 10.0},
    ]


def test_classify_ownership_from_shareholder_names():
    assert classify_ownership_from_text("招商局轮船有限公司") == "央企"
    assert classify_ownership_from_text("贵州省国有资本运营有限责任公司") == "地方国企"
    assert classify_ownership_from_text("美的控股有限公司 方洪波") == "民营企业"


def test_compute_dividend_yield_uses_last_twelve_months_cash_dividend():
    ex_date = date.today() - timedelta(days=30)
    frame = pd.DataFrame(
        [
            {"除权日": ex_date.isoformat(), "派息比例": 5.0},
            {"除权日": (ex_date - timedelta(days=400)).isoformat(), "派息比例": 10.0},
        ]
    )

    assert compute_dividend_yield_from_cninfo(frame, close=10.0, trade_date=date.today().isoformat()) == 5.0


def test_extract_sw_industry_from_constituents_uses_matching_symbol():
    frame = pd.DataFrame(
        [
            {"股票代码": "600519.SH", "申万1级": "食品饮料"},
            {"股票代码": "000001.SZ", "申万1级": "银行"},
        ]
    )

    assert extract_sw_industry_from_constituents(frame, "000001.SZ") == "银行"


def test_build_sw_industry_lookup_uses_latest_shenwan_history_code():
    class FakeAk:
        @staticmethod
        def stock_industry_clf_hist_sw():
            return pd.DataFrame(
                [
                    {"symbol": "600519", "start_date": "2001-07-31", "industry_code": "340301"},
                    {"symbol": "600519", "start_date": "2021-07-30", "industry_code": "340501"},
                    {"symbol": "000001", "start_date": "2021-07-30", "industry_code": "480301"},
                ]
            )

    assert build_sw_industry_lookup(FakeAk, ["600519.SH", "000001.SZ"]) == {
        "600519.SH": "食品饮料",
        "000001.SZ": "银行",
    }


if __name__ == "__main__":
    print(format_rows(fetch_five_hs_stock_rows()))
