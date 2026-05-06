import sqlite3
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.dependencies import get_conn
from app.repositories import reports
from app.schemas import (
    InstitutionCreatePayload,
    InstitutionDeletePayload,
    InstitutionRenamePayload,
    ReportCreate,
    ReportStockVerdictUpdate,
    ReportUpdate,
)

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


@router.get("/{report_id}/file")
def get_report_file(report_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    file_payload = reports.get_report_file(conn, report_id)
    if not file_payload:
        raise HTTPException(status_code=404, detail="Report file not found")
    filename = file_payload["fileName"] or "research-report.pdf"
    headers = {"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"}
    return Response(
        content=file_payload["data"],
        media_type=file_payload["mimeType"] or "application/pdf",
        headers=headers,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_report(payload: ReportCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return reports.create_report(conn, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{report_id}")
def update_report(report_id: str, payload: ReportUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        report = reports.update_report(conn, report_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.post("/institutions", status_code=status.HTTP_201_CREATED)
def create_institution(payload: InstitutionCreatePayload, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return reports.create_institution(conn, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/institutions/name")
def rename_institution(payload: InstitutionRenamePayload, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        ranking = reports.rename_institution(conn, payload.institution, payload.new_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ranking:
        raise HTTPException(status_code=404, detail="Institution not found")
    return ranking


@router.delete("/institutions")
def delete_institution(payload: InstitutionDeletePayload, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        ranking = reports.delete_institution(conn, payload.institution)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ranking:
        raise HTTPException(status_code=404, detail="Institution not found")
    return ranking


@router.delete("/{report_id}")
def delete_report(report_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    report = reports.delete_report(conn, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.patch("/{report_id}/stocks/{symbol}/verdict")
def update_report_stock_verdict(
    report_id: str,
    symbol: str,
    payload: ReportStockVerdictUpdate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    stock = reports.update_report_stock_verdict(conn, report_id, symbol, payload.verdict)
    if not stock:
        raise HTTPException(status_code=404, detail="Report stock not found")
    return stock
