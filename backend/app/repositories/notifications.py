import sqlite3


def list_notifications(conn: sqlite3.Connection, unread_only: bool) -> dict:
    where = "WHERE read=0" if unread_only else ""
    rows = conn.execute(
        f"SELECT id, title, body, read, created_at AS createdAt FROM notifications {where} ORDER BY created_at DESC"
    ).fetchall()
    all_unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE read=0").fetchone()[0]
    return {
        "unreadCount": all_unread,
        "items": [{**dict(row), "read": bool(row["read"])} for row in rows],
    }


def mark_read(conn: sqlite3.Connection, notification_id: str) -> dict:
    conn.execute("UPDATE notifications SET read=1 WHERE id=?", (notification_id,))
    conn.commit()
    return {"id": notification_id, "read": True}
