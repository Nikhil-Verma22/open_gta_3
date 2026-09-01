import asyncio
import os
import mimetypes
import json
import time
from datetime import datetime

BASE_DIR = os.path.abspath('d:/gta3')
LOG_FILE_PATH = os.path.join(BASE_DIR, 'game_debug.log')

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.txd': 'application/octet-stream',
    '.dff': 'application/octet-stream',
    '.col': 'application/octet-stream',
    '.img': 'application/octet-stream',
    '.dir': 'application/octet-stream',
    '.dat': 'application/octet-stream',
    '.ide': 'text/plain',
    '.ipl': 'text/plain',
    '.gxt': 'application/octet-stream',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.list': 'text/plain; charset=utf-8',
    '.ini': 'text/plain; charset=utf-8',
    '.set': 'application/octet-stream',
}

def get_mime(path):
    ext = os.path.splitext(path)[1].lower()
    return MIME_TYPES.get(ext, 'application/octet-stream')

# In-memory cache for fast static serving
FILE_CACHE = {}

def get_file_bytes(filepath):
    if filepath in FILE_CACHE:
        return FILE_CACHE[filepath]
    if os.path.isfile(filepath):
        # Cache files under 10MB
        size = os.path.getsize(filepath)
        with open(filepath, 'rb') as f:
            data = f.read()
        if size <= 10 * 1024 * 1024:
            FILE_CACHE[filepath] = data
        return data
    return None

async def handle_client(reader, writer):
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            req_line = line.decode('latin1').strip()
            if not req_line:
                continue
            parts = req_line.split()
            if len(parts) < 2:
                break
            method, path = parts[0], parts[1]

            headers = {}
            content_length = 0
            while True:
                h_line = await reader.readline()
                if not h_line or h_line == b'\r\n':
                    break
                h_str = h_line.decode('latin1').strip()
                if ':' in h_str:
                    k, v = h_str.split(':', 1)
                    headers[k.strip().lower()] = v.strip()
                    if k.strip().lower() == 'content-length':
                        try:
                            content_length = int(v.strip())
                        except ValueError:
                            pass

            # Handle POST /log
            if method == 'POST' and path.startswith('/log'):
                body = b''
                if content_length > 0:
                    body = await reader.readexactly(content_length)
                now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
                lines_to_write = []
                try:
                    text = body.decode('utf-8', errors='replace')
                    payload = json.loads(text)
                    if isinstance(payload, list):
                        for entry in payload:
                            if isinstance(entry, dict):
                                lvl = entry.get('level', 'INFO').upper()
                                tag = entry.get('tag', 'GAME')
                                msg = entry.get('msg', '')
                                lines_to_write.append(f"[{now_str}] [{lvl}] [{tag}] {msg}\n")
                            else:
                                lines_to_write.append(f"[{now_str}] {entry}\n")
                    elif isinstance(payload, dict):
                        lvl = payload.get('level', 'INFO').upper()
                        tag = payload.get('tag', 'GAME')
                        msg = payload.get('msg', '')
                        lines_to_write.append(f"[{now_str}] [{lvl}] [{tag}] {msg}\n")
                    else:
                        lines_to_write.append(f"[{now_str}] {payload}\n")
                except Exception:
                    for l in body.decode('utf-8', errors='replace').splitlines():
                        if l.strip():
                            lines_to_write.append(f"[{now_str}] {l.strip()}\n")
                if lines_to_write:
                    with open(LOG_FILE_PATH, 'a', encoding='utf-8', errors='replace') as log_f:
                        log_f.writelines(lines_to_write)
                        log_f.flush()

                resp = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nOK"
                writer.write(resp)
                await writer.drain()
                continue

            if method == 'OPTIONS':
                resp = b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n"
                writer.write(resp)
                await writer.drain()
                continue

            # Static file GET/HEAD
            clean_path = path.split('?')[0].lstrip('/')
            if not clean_path:
                clean_path = 'index.html'
            filepath = os.path.normpath(os.path.join(BASE_DIR, clean_path))
            if not filepath.startswith(BASE_DIR):
                resp = b"HTTP/1.1 403 Forbidden\r\nContent-Length: 9\r\n\r\nForbidden"
                writer.write(resp)
                await writer.drain()
                continue

            data = get_file_bytes(filepath)
            if data is None:
                resp = b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 9\r\n\r\nNot Found"
                writer.write(resp)
                await writer.drain()
                continue

            mime = get_mime(filepath)
            header = (
                f"HTTP/1.1 200 OK\r\n"
                f"Content-Type: {mime}\r\n"
                f"Content-Length: {len(data)}\r\n"
                f"Access-Control-Allow-Origin: *\r\n"
                f"Cross-Origin-Opener-Policy: same-origin\r\n"
                f"Cross-Origin-Embedder-Policy: require-corp\r\n"
                f"Cache-Control: public, max-age=3600\r\n"
                f"Connection: keep-alive\r\n\r\n"
            ).encode('latin1')

            writer.write(header)
            if method != 'HEAD':
                writer.write(data)
            await writer.drain()

    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def main(port=8000):
    server = await asyncio.start_server(handle_client, '0.0.0.0', port, reuse_address=True)
    print(f"Blazing fast AsyncIO server listening on http://0.0.0.0:{port}/ ...")
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main(8000))
