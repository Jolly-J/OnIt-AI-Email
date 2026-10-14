"""Isolated recipient tests: AST-loaded application functions, in-memory DB, mocked SMTP/IMAP.

Does not import main/settings/database or run lifespan; never opens a business database.
"""
import ast
import asyncio
import base64
from datetime import datetime, timezone
import email
from email.header import Header, decode_header
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.policy import SMTP
from email.utils import formatdate, make_msgid
import logging
import json
from pathlib import Path
import smtplib
import time
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple
import unittest
from unittest.mock import AsyncMock, MagicMock

from fastapi import BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.mail_recipients import normalize_recipients
from app.core.datetime_util import normalize_email_date

ROOT = Path(__file__).resolve().parent


def load_nodes(path, names, namespace):
    tree = ast.parse((ROOT / path).read_text())
    nodes = [node for node in tree.body if getattr(node, 'name', None) in names]
    assert len(nodes) == len(names)
    for node in nodes:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class RecipientTests(unittest.TestCase):
    def test_normalization_and_cross_group_deduplication(self):
        self.assertEqual(normalize_recipients(
            'Alice <a@EXAMPLE.com>；b@example.com',
            'a@example.com，c@example.com', 'c@example.com; d@example.com'),
            ('a@example.com, b@example.com', 'c@example.com', 'd@example.com'))

    def test_quoted_display_name_and_local_part_case(self):
        self.assertEqual(normalize_recipients('"Doe, Jane" <Jane@example.com>;jane@example.com')[0],
                         'Jane@example.com, jane@example.com')

    def test_invalid_input_is_rejected_in_each_group(self):
        for bad in ['bad', 'a@example.com\r\nBcc: injected@example.com',
                    'a@bad..com', 'a@-bad.com', 'a b@example.com', '<broken>']:
            for position in range(3):
                values = ['a@example.com', '', '']
                values[position] = bad
                with self.subTest(position=position, bad=bad), self.assertRaises(ValueError):
                    normalize_recipients(*values)
        with self.assertRaises(ValueError):
            normalize_recipients('', '', 'b@example.com')


class SMTPTests(unittest.TestCase):
    def setUp(self):
        self.server = MagicMock()
        self.server.sendmail.return_value = {}
        self.transport = SimpleNamespace(SMTP=MagicMock(return_value=self.server),
                                         SMTP_SSL=MagicMock(return_value=self.server))
        namespace = dict(globals(), smtplib=self.transport, logger=logging.getLogger('isolated-mail'))
        load_nodes('app/services/mail_service.py', ['build_and_send_smtp_email', 'send_smtp_email',
                                                   'decode_mime_header', 'parse_email_message'], namespace)
        self.send = namespace['build_and_send_smtp_email']
        self.legacy_send = namespace['send_smtp_email']
        self.parse = namespace['parse_email_message']
        self.args = dict(smtp_host='mock.invalid', smtp_port=465, smtp_ssl=True,
                         email_address='sender@example.com', password='TEST_ONLY',
                         to_email='a@example.com; b@example.com', cc_email='c@example.com',
                         bcc_email='private@example.com', subject='测试', body_text='正文',
                         in_reply_to='<original@example.com>', references='<original@example.com>')

    def test_envelope_and_private_sent_copy_with_and_without_attachment(self):
        for ssl, attachments in [(True, None), (False, [{'filename': '测试.txt', 'content_bytes': b'file'}])]:
            with self.subTest(ssl=ssl):
                success, _, mid, sent_bytes, refused = self.send(**dict(self.args, smtp_ssl=ssl, attachments=attachments))
                self.assertTrue(success)
                self.assertEqual(refused, [])
                sender, envelope, wire = self.server.sendmail.call_args.args
                self.assertEqual(sender, 'sender@example.com')
                self.assertEqual(envelope, ['a@example.com', 'b@example.com', 'c@example.com', 'private@example.com'])
                public = email.message_from_bytes(wire)
                private = email.message_from_bytes(sent_bytes)
                self.assertIsNone(public['Bcc'])
                self.assertNotIn(b'private@example.com', wire)
                self.assertEqual(public['Cc'], 'c@example.com')
                self.assertEqual(private['Bcc'], 'private@example.com')
                self.assertEqual(self.parse(sent_bytes, '1')['bcc_recipients'], 'private@example.com')
                self.assertEqual(self.parse(wire, '2')['bcc_recipients'], '')
                self.assertEqual(public['Message-ID'], private['Message-ID'])
                self.assertEqual(public['Message-ID'], mid)
                self.assertEqual(public['In-Reply-To'], '<original@example.com>')
                if attachments:
                    self.assertEqual(next(p for p in public.walk() if p.get_filename()).get_payload(decode=True), b'file')
        self.server.starttls.assert_called_once()

    def test_partial_rejection_returns_warning_and_does_not_retry(self):
        self.server.sendmail.return_value = {'private@example.com': (550, b'refused')}
        success, notice, _, raw, refused = self.send(**self.args)
        self.assertTrue(success)
        self.assertIn('部分', notice)
        self.assertEqual(refused, ['private@example.com'])
        self.assertIsNotNone(raw)
        self.server.sendmail.assert_called_once()

    def test_all_rejected_does_not_create_sent_copy(self):
        self.server.sendmail.side_effect = smtplib.SMTPRecipientsRefused({'a@example.com': (550, b'refused')})
        success, _, mid, raw, _ = self.send(**self.args)
        self.assertFalse(success)
        self.assertIsNone(mid)
        self.assertIsNone(raw)

    def test_bad_addresses_never_connect(self):
        result = self.send(**dict(self.args, bcc_email='invalid'))
        self.assertFalse(result[0])
        self.transport.SMTP_SSL.assert_not_called()

    def test_quit_failure_after_acceptance_is_not_reported_as_send_failure(self):
        self.server.quit.side_effect = OSError('quit failed')
        self.assertTrue(self.send(**self.args)[0])
        self.server.sendmail.assert_called_once()

    def test_legacy_wrapper_still_returns_two_values(self):
        args = {k: v for k, v in self.args.items() if k not in ('cc_email', 'bcc_email')}
        self.assertEqual(len(self.legacy_send(**args)), 2)


class RouteTests(unittest.TestCase):
    def setUp(self):
        base = declarative_base()

        class User(base):
            __tablename__ = 'users'
            id = Column(Integer, primary_key=True)

        class MailAccount(base):
            __tablename__ = 'mail_accounts'
            id = Column(Integer, primary_key=True)
            user_id = Column(Integer, ForeignKey('users.id'))
            email_address = Column(String)
            encrypted_password = Column(String)
            name = Column(String, default='Test')
            smtp_host = 'mock.invalid'
            smtp_port = 465
            smtp_ssl = True
            imap_host = 'mock.invalid'
            imap_port = 993
            imap_ssl = True

        namespace = dict(globals(), Base=base, relationship=lambda *a, **kw: None,
                         User=User, MailAccount=MailAccount, get_db=lambda: None,
                         get_current_user=lambda: None, decrypt_secret=lambda _: 'TEST_ONLY',
                         event_bus=SimpleNamespace(broadcast_to_user=AsyncMock()),
                         logger=logging.getLogger('isolated-route'),
                         ai_service=SimpleNamespace(api_key=''),
                         format_iso_utc=lambda value: value.isoformat() if value else '')
        load_nodes('app/models/email.py', ['EmailRecord'], namespace)
        self.record = namespace['EmailRecord']
        self.engine = create_engine('sqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.addCleanup(self.db.close)
        self.db.add_all([User(id=1), User(id=2),
                         MailAccount(id=1, user_id=1, email_address='sender@example.com', encrypted_password='fake'),
                         MailAccount(id=2, user_id=2, email_address='other@example.com', encrypted_password='fake')])
        self.db.add(self.record(id=1, user_id=1, account_id=1, sender='original@example.com',
                                subject='Original', message_id='<original@example.com>', folder='inbox'))
        self.db.commit()
        self.user = self.db.get(User, 1)
        self.smtp = MagicMock(return_value=(True, '邮件发送成功！', '<sent@example.com>', b'PRIVATE_SENT_COPY', []))
        self.imap = MagicMock()
        namespace.update(build_and_send_smtp_email=self.smtp, append_to_sent_folder=self.imap)
        load_nodes('app/api/emails.py', ['AttachmentReq', 'ComposeEmailReq', 'compose_and_send', 'get_email_detail'], namespace)
        load_nodes('app/api/ai_chat.py', ['SendReplyReq', 'send_confirmed_reply'], namespace)
        self.ns = namespace

    def compose(self, **overrides):
        req = self.ns['ComposeEmailReq'](**dict(dict(account_id=1, to_email='a@example.com',
            cc_email='c@example.com', bcc_email='private@example.com', subject='Test', body_text='body'), **overrides))
        background = BackgroundTasks()
        result = asyncio.run(self.ns['compose_and_send'](req, background, self.db, self.user))
        return result, background

    def test_compose_persists_recipients_and_schedules_private_copy(self):
        result, background = self.compose(in_reply_to_email_id=1)
        sent = self.db.get(self.record, result['email_id'])
        self.assertEqual((sent.cc_recipients, sent.bcc_recipients), ('c@example.com', 'private@example.com'))
        self.assertEqual(self.db.get(self.record, 1).status, 'replied')
        self.assertEqual(self.smtp.call_args.kwargs['in_reply_to'], '<original@example.com>')
        self.assertEqual(background.tasks[0].kwargs['raw_email_bytes'], b'PRIVATE_SENT_COPY')
        self.imap.assert_not_called()

    def test_invalid_address_and_foreign_account_do_not_send(self):
        for overrides, status in [({'bcc_email': 'bad'}, 422), ({'account_id': 2}, 404)]:
            with self.subTest(overrides=overrides), self.assertRaises(HTTPException) as caught:
                self.compose(**overrides)
            self.assertEqual(caught.exception.status_code, status)
        self.smtp.assert_not_called()
        self.assertEqual(self.db.query(self.record).count(), 1)

    def test_failure_preserves_original_state_and_does_not_add_sent_record(self):
        self.smtp.return_value = (False, 'refused', None, None, [])
        with self.assertRaises(HTTPException):
            self.compose(in_reply_to_email_id=1)
        self.assertEqual(self.db.query(self.record).count(), 1)
        self.assertEqual(self.db.get(self.record, 1).status, 'inbox')

    def test_partial_result_is_saved_with_warning_without_retry(self):
        self.smtp.return_value = (True, '部分拒收', '<sent@example.com>', b'COPY', ['private@example.com'])
        result, _ = self.compose()
        self.assertEqual(result['delivery_warning'], '部分拒收')
        self.assertEqual(self.db.query(self.record).count(), 2)
        self.smtp.assert_called_once()

    def test_legacy_reply_persists_cc_and_bcc(self):
        req = self.ns['SendReplyReq'](reply_body='reply', cc_email='c@example.com', bcc_email='private@example.com')
        result = asyncio.run(self.ns['send_confirmed_reply'](1, req, BackgroundTasks(), self.db, self.user))
        sent = self.db.get(self.record, result['sent_id'])
        self.assertEqual(sent.bcc_recipients, 'private@example.com')
        self.assertEqual(sent.cc_recipients, 'c@example.com')

    def test_legacy_reply_denies_another_user(self):
        req = self.ns['SendReplyReq'](reply_body='reply')
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(self.ns['send_confirmed_reply'](1, req, BackgroundTasks(), self.db, SimpleNamespace(id=2)))
        self.assertEqual(caught.exception.status_code, 404)
        self.smtp.assert_not_called()

    def test_detail_exposes_bcc_only_for_owners_sent_mail(self):
        result, _ = self.compose()
        detail = self.ns['get_email_detail']
        sent = asyncio.run(detail(result['email_id'], self.db, self.user))
        self.assertEqual(sent['bcc_recipients'], 'private@example.com')
        original = self.db.get(self.record, 1)
        original.bcc_recipients = 'private@example.com'
        self.db.commit()
        inbox = asyncio.run(detail(1, self.db, self.user))
        self.assertEqual(inbox['bcc_recipients'], '')
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(detail(result['email_id'], self.db, SimpleNamespace(id=2)))
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main(verbosity=2)
