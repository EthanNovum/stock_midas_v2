import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.repositories import notifications

router = APIRouter(prefix="/notifications")


@router.get("")
def list_notifications(unread_only: bool = False, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return notifications.list_notifications(conn, unread_only)


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return notifications.mark_read(conn, notification_id)
