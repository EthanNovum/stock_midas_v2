from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AliasModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class Rating(str, Enum):
    buy = "buy"
    hold = "hold"
    sell = "sell"


class TradeSignal(str, Enum):
    buy = "buy"
    sell = "sell"
    hold = "hold"


class DataSyncStatus(str, Enum):
    queued = "queued"
    running = "running"
    success = "success"
    failed = "failed"


class DataSyncScope(str, Enum):
    stock_basic = "stock_basic"
    daily_prices = "daily_prices"
    fundamentals = "fundamentals"


class DataSyncUpdateMode(str, Enum):
    full = "full"
    price_only = "price_only"


class ScreenerQuery(AliasModel):
    filters: dict[str, Any] = Field(default_factory=dict)
    ownership: list[str] = Field(default_factory=list)
    exchanges: list[str] = Field(default_factory=list)
    page: int = 1
    page_size: int = Field(default=20, alias="pageSize", ge=1, le=100)
    sort: dict[str, Any] | None = None


class DataSyncJobCreate(AliasModel):
    source: str = "akshare"
    scopes: list[DataSyncScope] = Field(
        default_factory=lambda: [
            DataSyncScope.stock_basic,
            DataSyncScope.daily_prices,
            DataSyncScope.fundamentals,
        ]
    )
    markets: list[str] = Field(default_factory=lambda: ["A"])
    symbols: list[str] | None = None
    trade_date: date | None = Field(default=None, alias="tradeDate")
    full_refresh: bool = Field(default=False, alias="fullRefresh")
    limit: int = Field(default=300, ge=1, le=10000)
    update_mode: DataSyncUpdateMode = Field(default=DataSyncUpdateMode.full, alias="updateMode")


class WatchlistCreate(AliasModel):
    name: str
    group_type: str = Field(default="sector", alias="groupType")


class WatchlistUpdate(BaseModel):
    name: str


class WatchlistStockCreate(BaseModel):
    symbol: str
    note: str | None = None


class TradeCreate(AliasModel):
    portfolio_id: int = Field(default=1, alias="portfolioId")
    symbol: str
    side: str
    quantity: float
    price: float
    traded_at: date | datetime | None = Field(default=None, alias="tradedAt")


class TradeUpdate(AliasModel):
    portfolio_id: int | None = Field(default=None, alias="portfolioId")
    symbol: str | None = None
    side: str | None = None
    quantity: float | None = None
    price: float | None = None
    traded_at: date | datetime | None = Field(default=None, alias="tradedAt")


class AppearanceUpdate(BaseModel):
    theme: Literal["light", "dark", "system"]


class LlmUpdate(AliasModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    base_url: str | None = Field(default=None, alias="baseUrl")
    apiKey: str | None = None


class LlmModelCreate(AliasModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    base_url: str | None = Field(default=None, alias="baseUrl")
    apiKey: str | None = None


class ReportCreate(AliasModel):
    title: str
    ticker: str
    ticker_name: str = Field(alias="tickerName")
    rating: Rating
    institution: str
    date: date
    content: str
