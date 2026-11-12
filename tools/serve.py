"""Tiny dev server for Formatic: static files + POST /capture to save a download.

Only used for testing. The app itself is static and needs no server.
"""
import http.server, socketserver, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'out')
os.makedirs(OUT, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        if self.path != '/capture':
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        path = os.path.join(OUT, 'captured.pdf')
        with open(path, 'wb') as f:
            f.write(data)
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok %d' % len(data))

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', port), Handler) as httpd:
        print('serving', ROOT, 'on', port)
        httpd.serve_forever()
