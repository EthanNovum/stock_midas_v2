from collections.abc import Generator
import sqlite3

from app.database import connect


def get_conn() -> Generator[sqlite3.Connection, None, None]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
