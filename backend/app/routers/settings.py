import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.repositories import settings
from app.schemas import AppearanceUpdate

router = APIRouter(prefix="/settings")


@router.get("")
def get_settings(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.get_settings(conn)


@router.patch("/appearance")
def update_appearance(payload: AppearanceUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.update_appearance(conn, payload.theme)
