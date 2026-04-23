import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_conn
from app.repositories import reports
from app.schemas import ReportCreate

router = APIRouter(prefix="/reports")


@router.get("")
def list_reports(
    q: str | None = None,
    rating: str | None = None,
    institution: str | None = None,
    ticker: str | None = None,
    page: int = 1,
    page_size: int = 20,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    return reports.list_reports(conn, q, rating, institution, ticker, page, page_size)


@router.get("/{report_id}")
def get_report(report_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    report = reports.get_report(conn, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("", status_code=status.HTTP_201_CREATED)
def create_report(payload: ReportCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return reports.create_report(conn, payload)
