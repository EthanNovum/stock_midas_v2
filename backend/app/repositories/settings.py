import sqlite3

from app.repositories import data_sync
from app.timeutils import now_iso


def get_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT * FROM user_settings WHERE id=1").fetchone()
    latest = data_sync.get_latest_job(conn)
    stored_theme = row["theme"]
    theme = "dark" if stored_theme == "system" else stored_theme
    return {
        "appearance": {"theme": theme},
        "dataSync": {
            "source": latest["source"] if latest else "akshare",
            "lastJobId": latest["jobId"] if latest else None,
            "lastStatus": latest["status"] if latest else "idle",
            "lastSyncAt": latest["finishedAt"] if latest else None,
            "updatedRows": latest["updatedRows"] if latest else 0,
            "failedRows": latest["failedRows"] if latest else 0,
        },
    }


def update_appearance(conn: sqlite3.Connection, theme: str) -> dict:
    conn.execute("UPDATE user_settings SET theme=?, updated_at=? WHERE id=1", (theme, now_iso()))
    conn.commit()
    return {"theme": theme}
