"""家電・家具の説明書(写真/PDF)とメモを保存するSQLite DB。"""
import os
import sqlite3
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'その他',
    maker TEXT,
    model_number TEXT,
    purchase_date TEXT,
    warranty_expiry TEXT,
    memo TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,               -- 'photo' | 'pdf'
    filename TEXT NOT NULL,           -- ディスク上の保存名(uuidベース)
    original_name TEXT,
    mime TEXT,
    uploaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_item ON files(item_id);
"""


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


ITEM_FIELDS = (
    "name", "category", "maker", "model_number",
    "purchase_date", "warranty_expiry", "memo",
)


def insert_item(conn, **fields):
    item_id = str(uuid.uuid4())
    now = int(time.time())
    values = {k: fields.get(k) for k in ITEM_FIELDS}
    conn.execute(
        "INSERT INTO items (id, name, category, maker, model_number, purchase_date,"
        " warranty_expiry, memo, created_at, updated_at)"
        " VALUES (:id, :name, :category, :maker, :model_number, :purchase_date,"
        " :warranty_expiry, :memo, :created_at, :updated_at)",
        {**values, "id": item_id, "created_at": now, "updated_at": now},
    )
    conn.commit()
    return item_id


def update_item(conn, item_id, **fields):
    values = {k: fields[k] for k in ITEM_FIELDS if k in fields}
    if not values:
        return get_item(conn, item_id) is not None
    set_clause = ", ".join(f"{k} = :{k}" for k in values)
    values["id"] = item_id
    values["updated_at"] = int(time.time())
    conn.execute(
        f"UPDATE items SET {set_clause}, updated_at = :updated_at WHERE id = :id",
        values,
    )
    conn.commit()
    return conn.total_changes > 0


def get_item(conn, item_id):
    row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row) if row else None


def delete_item(conn, item_id):
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    return conn.total_changes > 0


def list_items(conn, *, q=None, category=None):
    query = """
        SELECT items.*,
            (SELECT filename FROM files WHERE files.item_id = items.id
                AND files.kind = 'photo' ORDER BY files.uploaded_at ASC LIMIT 1) AS thumbnail,
            (SELECT COUNT(*) FROM files WHERE files.item_id = items.id) AS file_count
        FROM items WHERE 1=1
    """
    params = []
    if category:
        query += " AND category = ?"
        params.append(category)
    if q:
        query += " AND (name LIKE ? OR maker LIKE ? OR model_number LIKE ? OR memo LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like, like]
    query += " ORDER BY updated_at DESC"
    return [dict(r) for r in conn.execute(query, params).fetchall()]


def list_categories(conn):
    rows = conn.execute(
        "SELECT DISTINCT category FROM items ORDER BY category"
    ).fetchall()
    return [r["category"] for r in rows]


def insert_file(conn, *, item_id, kind, filename, original_name, mime):
    file_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO files (id, item_id, kind, filename, original_name, mime, uploaded_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (file_id, item_id, kind, filename, original_name, mime, int(time.time())),
    )
    conn.execute("UPDATE items SET updated_at = ? WHERE id = ?", (int(time.time()), item_id))
    conn.commit()
    return file_id


def list_files(conn, item_id):
    rows = conn.execute(
        "SELECT * FROM files WHERE item_id = ? ORDER BY uploaded_at ASC", (item_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_file(conn, file_id):
    row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    return dict(row) if row else None


def delete_file(conn, file_id):
    conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
    conn.commit()
    return conn.total_changes > 0
