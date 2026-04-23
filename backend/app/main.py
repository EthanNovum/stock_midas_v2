from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import runtime_config
from app.database import init_database
from app.routers import (
    data_sync,
    health,
    market,
    news,
    notifications,
    portfolio,
    reports,
    screener,
    search,
    settings,
    watchlists,
)


def create_app() -> FastAPI:
    runtime_config.reset_runtime_state()
    init_database()
    app = FastAPI(title="Midas Stock Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    routers = [
        health.router,
        search.router,
        market.router,
        news.router,
        watchlists.router,
        screener.router,
        portfolio.router,
        reports.router,
        settings.router,
        data_sync.router,
        notifications.router,
    ]
    for router in routers:
        app.include_router(router, prefix="/api/v1")

    return app


app = create_app()
