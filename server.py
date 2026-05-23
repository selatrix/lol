import http.server
import socketserver

PORT = 5000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        pass

with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'Serving on port {PORT}')
    httpd.serve_forever()
