"""隔离测试：只提取实际路由，不导入应用、配置、数据库或运行 lifespan。"""
import ast
import asyncio
import json
import logging
import os
from pathlib import Path
import re
import tempfile
import time
from types import SimpleNamespace
import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent


def extract_function(path, name):
    tree = ast.parse(path.read_text())
    return next(node for node in ast.walk(tree)
                if isinstance(node, ast.AsyncFunctionDef) and node.name == name)


class StaticPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='spa-path-test-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.dist = root / 'frontend' / 'dist'
        self.dist.mkdir(parents=True)
        (self.dist / 'assets').mkdir()
        (self.dist / 'index.html').write_text('SPA_INDEX')
        (self.dist / 'ok.txt').write_text('PUBLIC_FILE')
        (self.dist / 'assets' / 'app.js').write_text('STATIC_ASSET')
        self.outside = root / 'private.txt'
        self.outside.write_text('PRIVATE_MARKER')
        (self.dist / 'outside.txt').symlink_to(self.outside)
        (self.dist / 'inside.txt').symlink_to(self.dist / 'ok.txt')
        sibling = self.dist.parent / 'dist-other'
        sibling.mkdir()
        (sibling / 'private.txt').write_text('PRIVATE_MARKER')

        app = FastAPI()
        router = APIRouter(prefix='/emails')
        # 使用真实附件下载函数，文件与元数据全部位于临时目录。
        attachment_dir = root / 'attachments'
        attachment_dir.mkdir()
        self.token = 'a' * 32
        (attachment_dir / 'payload.txt').write_text('ATTACHMENT_DATA')
        (attachment_dir / f'{self.token}.json').write_text(json.dumps({
            'saved_file': 'payload.txt', 'filename': '测试.txt',
            'expires_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        }))
        namespace = dict(globals(), app=app, router=router, frontend_dist=str(self.dist),
                         settings=SimpleNamespace(LARGE_ATTACHMENT_DIR=str(attachment_dir),
                             DOWNLOAD_MAX_CONCURRENT_PER_IP=3, DOWNLOAD_RATE_LIMIT_KB=3072),
                         _active_download_concurrency={}, _concurrency_lock=asyncio.Lock(),
                         logger=logging.getLogger(__name__))
        attachment = extract_function(BACKEND / 'app/api/emails.py', 'download_shared_attachment')
        exec(compile(ast.Module(body=[attachment], type_ignores=[]), 'attachment-route', 'exec'), namespace)
        app.include_router(router, prefix='/api')
        # 执行 main.py 中完整静态挂载块，保留 /assets 与 SPA 的实际顺序。
        tree = ast.parse((BACKEND / 'main.py').read_text())
        block = next(node for node in tree.body if isinstance(node, ast.If)
                     and any(isinstance(child, ast.AsyncFunctionDef) and child.name == 'serve_spa'
                             for child in node.body))
        exec(compile(ast.Module(body=[block], type_ignores=[]), 'static-routes', 'exec'), namespace)
        self.serve_spa = namespace['serve_spa']
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_public_files_and_internal_symlink(self):
        for path in ['/ok.txt', '/inside.txt']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.text, 'PUBLIC_FILE')

    def test_spa_fallback(self):
        self.assertEqual(self.client.get('/auth/callback').text, 'SPA_INDEX')

    def test_assets_mount(self):
        self.assertEqual(self.client.get('/assets/app.js').text, 'STATIC_ASSET')

    def test_encoded_traversal(self):
        for path in ['/%2e%2e/%2e%2e/private.txt', '/..%2f..%2fprivate.txt',
                     '/%2e%2e/dist-other/private.txt', '/%2e%2e/missing.txt']:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_absolute_path_and_invalid_path(self):
        for path in [str(self.outside), '\x00']:
            with self.subTest(path=repr(path)), self.assertRaises(HTTPException) as exc:
                asyncio.run(self.serve_spa(path))
            self.assertEqual(exc.exception.status_code, 404)

    def test_external_symlink(self):
        self.assertEqual(self.client.get('/outside.txt').status_code, 404)

    def test_external_index_symlink(self):
        (self.dist / 'index.html').unlink()
        (self.dist / 'index.html').symlink_to(self.outside)
        for path in ['/index.html', '/some/page']:
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_missing_index_placeholder(self):
        (self.dist / 'index.html').unlink()
        response = self.client.get('/some/page')
        self.assertEqual(response.status_code, 200)
        self.assertIn('前端构建中', response.text)

    def test_attachment_download_get_head_and_range(self):
        url = f'/api/emails/attachments/download/{self.token}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'ATTACHMENT_DATA')
        self.assertIn('attachment;', response.headers['content-disposition'])
        response = self.client.head(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'')
        self.assertEqual(response.headers['content-length'], '15')
        response = self.client.get(url, headers={'Range': 'bytes=0-3'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'ATTA')
        self.assertEqual(response.headers['content-range'], 'bytes 0-3/15')


if __name__ == '__main__':
    unittest.main()
