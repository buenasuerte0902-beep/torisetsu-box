#!/usr/bin/env python3
"""
取説BOX — 家電・家具の説明書(写真/PDF)をスマホでまとめて保管するバックエンド。
このFlaskサーバーがPWA本体(静的ファイル)とAPI・アップロード保存を兼ねる。

起動:
  pip install -r requirements.txt
  python server/app.py                # http://127.0.0.1:8790 (PC確認用)
  python server/app.py --tls --lan    # https://<LAN-IP>:8790 (同じWi-Fiのスマホから)

家族の複数端末で同じデータを見るには、この1台(PC等)でサーバーを起動しっぱなしにして
各端末から https://<LAN-IP>:8790 を開く(同じWi-Fi内)。外出先(モバイル回線)からも
使いたい場合はこのFlaskアプリをそのままRender/Fly.io等の無料枠にデプロイすればよい。

アプリのパスワードは環境変数 APP_PASSWORD で設定する(未設定時は開発用の既定値を使い、
起動時に警告を表示する)。家族内共有とはいえ、外部公開する場合は必ず設定すること。
"""
import argparse
import mimetypes
import os
import secrets
import socket
import ssl
import subprocess
import sys
import uuid

from flask import Flask, Response, jsonify, request, send_from_directory, session
from werkzeug.utils import secure_filename

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CERT_DIR = os.path.join(ROOT, ".certs")
CERT = os.path.join(CERT_DIR, "cert.pem")
KEY = os.path.join(CERT_DIR, "key.pem")
UPLOAD_DIR = os.path.join(ROOT, "data", "uploads")

DEFAULT_APP_PASSWORD = "torisetsu-box-1234"
APP_PASSWORD = os.environ.get("APP_PASSWORD", DEFAULT_APP_PASSWORD)
if APP_PASSWORD == DEFAULT_APP_PASSWORD:
    print(
        "警告: APP_PASSWORD が未設定のため既定パスワードを使用しています。"
        "自宅LAN以外に公開する場合は必ず環境変数 APP_PASSWORD を設定してください。",
        file=sys.stderr,
    )

CATEGORIES = ("家電", "家具", "その他")
VALID_KINDS = {"photo": {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"},
               "pdf": {"application/pdf"}}
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 1ファイルあたり25MBまで

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def require_login():
    return session.get("loggedIn") is True


def guard():
    if not require_login():
        return jsonify(error="ログインが必要です"), 401
    return None


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    if data.get("password") == APP_PASSWORD:
        session["loggedIn"] = True
        session.permanent = True
        return jsonify(ok=True)
    return jsonify(error="パスワードが正しくありません"), 401


@app.post("/api/logout")
def logout():
    session.pop("loggedIn", None)
    return jsonify(ok=True)


@app.get("/api/session")
def get_session():
    return jsonify(loggedIn=require_login())


@app.get("/api/items")
def api_list_items():
    if (r := guard()):
        return r
    q = request.args.get("q") or None
    category = request.args.get("category") or None
    conn = db.get_conn()
    try:
        items = db.list_items(conn, q=q, category=category)
        categories = sorted(set(CATEGORIES) | set(db.list_categories(conn)))
    finally:
        conn.close()
    return jsonify(items=[to_public_item(i) for i in items], categories=categories)


@app.post("/api/items")
def api_create_item():
    if (r := guard()):
        return r
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify(error="名前は必須です"), 400
    fields = extract_item_fields(data)
    fields["name"] = name
    fields.setdefault("category", None)
    if not fields["category"]:
        fields["category"] = "その他"
    conn = db.get_conn()
    try:
        item_id = db.insert_item(conn, **fields)
        item = db.get_item(conn, item_id)
    finally:
        conn.close()
    return jsonify(to_public_item({**item, "thumbnail": None, "file_count": 0})), 201


@app.get("/api/items/<item_id>")
def api_get_item(item_id):
    if (r := guard()):
        return r
    conn = db.get_conn()
    try:
        item = db.get_item(conn, item_id)
        if not item:
            return jsonify(error="見つかりません"), 404
        files = db.list_files(conn, item_id)
    finally:
        conn.close()
    return jsonify({**to_public_item(item), "files": [to_public_file(f) for f in files]})


@app.put("/api/items/<item_id>")
def api_update_item(item_id):
    if (r := guard()):
        return r
    data = request.get_json(silent=True) or {}
    if "name" in data and not str(data["name"]).strip():
        return jsonify(error="名前は必須です"), 400
    fields = extract_item_fields(data)
    conn = db.get_conn()
    try:
        ok = db.update_item(conn, item_id, **fields)
        item = db.get_item(conn, item_id) if ok else None
    finally:
        conn.close()
    if not item:
        return jsonify(error="見つかりません"), 404
    return jsonify(to_public_item(item))


@app.delete("/api/items/<item_id>")
def api_delete_item(item_id):
    if (r := guard()):
        return r
    conn = db.get_conn()
    try:
        files = db.list_files(conn, item_id)
        ok = db.delete_item(conn, item_id)
    finally:
        conn.close()
    if not ok:
        return jsonify(error="見つかりません"), 404
    for f in files:
        remove_upload(f["filename"])
    return jsonify(ok=True)


@app.post("/api/items/<item_id>/files")
def api_upload_file(item_id):
    if (r := guard()):
        return r
    conn = db.get_conn()
    try:
        item = db.get_item(conn, item_id)
    finally:
        conn.close()
    if not item:
        return jsonify(error="見つかりません"), 404

    kind = request.form.get("kind")
    if kind not in VALID_KINDS:
        return jsonify(error="kindはphoto/pdfのいずれかです"), 400
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify(error="fileが必要です"), 400

    mime = upload.mimetype or mimetypes.guess_type(upload.filename)[0] or ""
    if mime not in VALID_KINDS[kind]:
        return jsonify(error=f"このkindでは扱えないファイル形式です: {mime}"), 400

    ext = os.path.splitext(secure_filename(upload.filename))[1].lower()
    stored_name = f"{uuid.uuid4().hex}{ext}"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    upload.save(os.path.join(UPLOAD_DIR, stored_name))

    conn = db.get_conn()
    try:
        file_id = db.insert_file(
            conn, item_id=item_id, kind=kind, filename=stored_name,
            original_name=upload.filename, mime=mime,
        )
        f = db.get_file(conn, file_id)
    finally:
        conn.close()
    return jsonify(to_public_file(f)), 201


@app.delete("/api/files/<file_id>")
def api_delete_file(file_id):
    if (r := guard()):
        return r
    conn = db.get_conn()
    try:
        f = db.get_file(conn, file_id)
        ok = db.delete_file(conn, file_id) if f else False
    finally:
        conn.close()
    if not ok:
        return jsonify(error="見つかりません"), 404
    remove_upload(f["filename"])
    return jsonify(ok=True)


@app.get("/uploads/<path:filename>")
def serve_upload(filename):
    if (r := guard()):
        return r
    return send_from_directory(UPLOAD_DIR, filename, conditional=True)


def remove_upload(filename):
    path = os.path.join(UPLOAD_DIR, filename)
    try:
        os.remove(path)
    except OSError:
        pass


FIELD_KEY_MAP = {
    "name": "name", "category": "category", "maker": "maker",
    "modelNumber": "model_number", "purchaseDate": "purchase_date",
    "warrantyExpiry": "warranty_expiry", "memo": "memo",
}


def extract_item_fields(data):
    fields = {}
    for json_key, column in FIELD_KEY_MAP.items():
        if json_key in data:
            value = data.get(json_key)
            fields[column] = (str(value).strip() or None) if value is not None else None
    return fields


def to_public_item(row):
    return {
        "id": row["id"], "name": row["name"], "category": row["category"],
        "maker": row["maker"], "modelNumber": row["model_number"],
        "purchaseDate": row["purchase_date"], "warrantyExpiry": row["warranty_expiry"],
        "memo": row["memo"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "thumbnail": row.get("thumbnail"), "fileCount": row.get("file_count", 0),
    }


def to_public_file(row):
    return {
        "id": row["id"], "itemId": row["item_id"], "kind": row["kind"],
        "url": f"/uploads/{row['filename']}", "originalName": row["original_name"],
        "mime": row["mime"], "uploadedAt": row["uploaded_at"],
    }


@app.get("/sw.js")
def service_worker():
    with open(os.path.join(ROOT, "sw.js"), "rb") as f:
        content = f.read()
    return Response(content, mimetype="text/javascript")


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html", conditional=False)


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(ROOT, path, conditional=False)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    if os.path.exists(CERT) and os.path.exists(KEY):
        return
    os.makedirs(CERT_DIR, exist_ok=True)
    san = f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"
    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", KEY, "-out", CERT, "-days", "3650",
        "-subj", "/CN=torisetsu-box", "-addext", san,
    ]
    print("自己署名証明書を作成中 …", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        sys.exit(
            "openssl が見つからない/失敗しました。openssl を入れるか、"
            f"手動で {CERT_DIR} に cert.pem / key.pem を用意してください。\n{e}"
        )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="取説BOX バックエンド")
    ap.add_argument("--lan", action="store_true", help="0.0.0.0で待ち受け(同じWi-Fiのスマホから見える)")
    ap.add_argument("--tls", action="store_true", help="HTTPS(自己署名)。カメラ撮影に必要")
    args = ap.parse_args()

    port = int(os.environ.get("PORT", 8790))
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    ip = lan_ip()
    scheme = "http"
    ssl_context = None
    if args.tls:
        ensure_cert(ip)
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(CERT, KEY)
        scheme = "https"

    print(f"\n配信中: {ROOT}")
    print(f"  この PC:      {scheme}://127.0.0.1:{port}/")
    if host == "0.0.0.0":
        print(f"  スマホ等から: {scheme}://{ip}:{port}/   ← 同じ Wi-Fi でこれを開く")
        if args.tls:
            print("  （証明書の警告は「詳細設定」→「アクセスする」で進む）")
    print("Ctrl+C で停止\n")
    app.run(host=host, port=port, debug=False, threaded=True, ssl_context=ssl_context)
