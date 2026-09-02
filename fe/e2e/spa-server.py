#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os


class SpaRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def send_head(self):
        requested = self.translate_path(self.path)
        if not Path(requested).exists() and not self.path.startswith('/_expo/'):
            original_path = self.path
            self.path = '/index.html'
            try:
                return super().send_head()
            finally:
                self.path = original_path
        return super().send_head()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, default=19006)
    args = parser.parse_args()

    root = os.path.abspath(args.directory)
    handler = lambda *handler_args, **handler_kwargs: SpaRequestHandler(
        *handler_args,
        directory=root,
        **handler_kwargs,
    )
    server = ThreadingHTTPServer(('0.0.0.0', args.port), handler)
    print(f'Serving SPA {root} on port {args.port}', flush=True)
    server.serve_forever()
