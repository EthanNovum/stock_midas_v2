import io
import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.dependencies import get_conn
from app.repositories import screener
from app.schemas import ScreenerQuery

router = APIRouter(prefix="/screener")


@router.get("/options")
def options(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return screener.get_options(conn)


@router.post("/query")
def query(payload: ScreenerQuery, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return screener.query(conn, payload)


@router.get("/export")
def export(
    filters: str | None = None,
    ownership: list[str] = Query(default_factory=list),
    exchanges: list[str] = Query(default_factory=list),
    conn: sqlite3.Connection = Depends(get_conn),
):
    try:
        parsed_filters = json.loads(filters) if filters else {}
        if not isinstance(parsed_filters, dict):
            raise ValueError("filters must be an object")
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid filters query: {exc}") from exc

    payload = ScreenerQuery(filters=parsed_filters, ownership=ownership, exchanges=exchanges, page=1, pageSize=100)
    result = screener.query(conn, payload)
    buffer = io.StringIO()
    buffer.write("symbol,name,price,change,ma120,ma120Lower,ma120Upper,signal,marketCap,pe,dividend\n")
    for item in result["items"]:
        buffer.write(
            f"{item['symbol']},{item['name']},{item['price']},{item['change']},"
            f"{item['ma120']},{item['ma120Lower']},{item['ma120Upper']},{item['signal']},"
            f"{item['marketCap']},{item['pe']},{item['dividend']}\n"
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="screener-results.csv"'},
    )
