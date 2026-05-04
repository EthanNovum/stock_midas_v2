from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    paused = "paused"
    stopped = "stopped"
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
    signals: list[TradeSignal] = Field(default_factory=list)
    page: int = 1
    page_size: int = Field(default=20, alias="pageSize", ge=1, le=100)
    sort: dict[str, Any] | None = None


class StockMetadataUpdate(BaseModel):
    industry: str | None = None
    ownership: str | None = None


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
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    full_refresh: bool = Field(default=False, alias="fullRefresh")
    full_universe: bool = Field(default=False, alias="fullUniverse")
    limit: int = Field(default=300, ge=1, le=10000)
    update_mode: DataSyncUpdateMode = Field(default=DataSyncUpdateMode.full, alias="updateMode")

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("startDate must be on or before endDate")
        return self


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
    note: str = ""


class TradeUpdate(AliasModel):
    portfolio_id: int | None = Field(default=None, alias="portfolioId")
    symbol: str | None = None
    side: str | None = None
    quantity: float | None = None
    price: float | None = None
    traded_at: date | datetime | None = Field(default=None, alias="tradedAt")
    note: str | None = None


class CashAdjustmentCreate(AliasModel):
    portfolio_id: int = Field(default=1, alias="portfolioId")
    side: Literal["deposit", "withdraw"]
    amount: float = Field(gt=0)
    traded_at: date | datetime | None = Field(default=None, alias="tradedAt")
    note: str = ""


class AppearanceUpdate(BaseModel):
    theme: Literal["light", "dark"]


class ReportStockCreate(AliasModel):
    symbol: str
    name: str | None = None


class ReportStockVerdictUpdate(BaseModel):
    verdict: Literal["win", "loss", "flat"]


class ReportCreate(AliasModel):
    title: str | None = None
    ticker: str | None = None
    ticker_name: str | None = Field(default=None, alias="tickerName")
    stocks: list[ReportStockCreate] = Field(default_factory=list)
    rating: Rating
    institution: str
    date: date
    content: str
    source_url: str | None = Field(default=None, alias="sourceUrl")
    source_file_name: str | None = Field(default=None, alias="sourceFileName")
    source_file_mime: str | None = Field(default=None, alias="sourceFileMime")
    source_file_content: str | None = Field(default=None, alias="sourceFileContent")


class ReportUpdate(AliasModel):
    title: str
    rating: Rating
    date: date
    content: str
