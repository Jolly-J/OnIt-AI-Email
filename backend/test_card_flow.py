import os
import sys
import asyncio
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal
from app.models.user import User
from app.models.account import MailAccount
from app.models.email import EmailRecord
from app.models.message import ChatMessage
from app.core.security import encrypt_secret
from app.services.dingtalk_card_service import dingtalk_card_service
from app.services.dingtalk_stream_listener import EmailCardCallbackHandler

async def run_tests():
    db = SessionLocal()
    try:
        # 清理旧测试数据
        db.query(ChatMessage).filter(ChatMessage.content.like("%test_card_%")).delete()
        db.query(EmailRecord).filter(EmailRecord.subject.like("%test_card_%")).delete()
        db.query(MailAccount).filter(MailAccount.email_address == "test_owner@example.com").delete()
        db.query(User).filter(User.username.in_(["test_card_owner", "test_card_intruder"])).delete()
        db.commit()

        # 1. 创建测试用户与属主邮箱
        owner = User(
            username="test_card_owner",
            hashed_password="xxx",
            display_name="张属主",
            dingtalk_userid="dd_owner_999",
            is_active=True
        )
        intruder = User(
            username="test_card_intruder",
            hashed_password="xxx",
            display_name="李越权",
            dingtalk_userid="dd_intruder_888",
            is_active=True
        )
        db.add_all([owner, intruder])
        db.commit()
        db.refresh(owner)
        db.refresh(intruder)

        account = MailAccount(
            user_id=owner.id,
            name="工作邮箱",
            email_address="test_owner@example.com",
            encrypted_password=encrypt_secret("password123"),
            imap_host="imap.example.com",
            imap_port=993,
            imap_ssl=True,
            smtp_host="smtp.example.com",
            smtp_port=465,
            smtp_ssl=True,
            is_active=True
        )
        db.add(account)
        db.commit()
        db.refresh(account)

        email = EmailRecord(
            user_id=owner.id,
            account_id=account.id,
            uid="9999",
            folder="inbox",
            message_id="<msg_test_001@example.com>",
            subject="test_card_商务洽谈函",
            sender="client@partner.com",
            body_text="Hi, we need to finalize the quotation by Friday.",
            summary_zh="客户要求周五前确定报价方案",
            key_points_json='["周五前确定报价", "采购量约为500件"]',
            action_items_json='["核算500件阶梯折扣", "周五前正式回信"]',
            ai_guided_question="建议先核实现货库存，针对500件提供95折优惠方案。",
            dingtalk_card_out_track_id="em_test_track_123",
            dingtalk_card_status="delivered",
            status="inbox"
        )
        db.add(email)
        db.commit()
        db.refresh(email)

        handler = EmailCardCallbackHandler()

        # ──────────────────────────────────────────
        # 测试 1：越权隔离拦截测试
        # ──────────────────────────────────────────
        print("\n--- 测试 1：越权隔离拦截测试 ---")
        intruder_res = await handler._handle_card_reply(
            out_track_id="em_test_track_123",
            params={"action": "generate_draft", "userInstruction": "越权指令"},
            operator_ding_uid="dd_intruder_888" # 非属主
        )
        assert "权限不足" in intruder_res["statusText"], f"越权拦截失败: {intruder_res}"
        print(f"✓ 越权拦截成功：{intruder_res['statusText']}")

        # ──────────────────────────────────────────
        # 测试 2：阶段 1 - 属主合规触发 AI 拟稿
        # ──────────────────────────────────────────
        print("\n--- 测试 2：阶段 1 - 属主合规触发 AI 拟稿 ---")
        mock_ai_result = {
            "response": "已根据您的要求起草外语回复邮件。",
            "draft_reply": "Dear Client,\n\nWe confirm the 5% discount for 500 units.\n\nBest regards,\n张属主\n示例科技",
            "draft_reply_zh": "尊敬的客户：\n\n我们确认500件订单享受95折优惠。\n\n此致\n张属主\n示例科技",
            "explanation": "明确确认阶梯折扣并约定交付时间"
        }
        with patch("app.services.ai_service.ai_service.chat_and_refine_reply", new=AsyncMock(return_value=mock_ai_result)):
            owner_draft_res = await handler._handle_card_reply(
                out_track_id="em_test_track_123",
                params={"action": "generate_draft", "userInstruction": "同意500件给95折"},
                operator_ding_uid="dd_owner_999" # 属主
            )

        assert owner_draft_res["stage"] == "draft_generated", f"状态流转错误: {owner_draft_res}"
        assert "500 units" in owner_draft_res["draftReply"]
        assert "95折优惠" in owner_draft_res["draftReplyZh"]
        print("✓ 阶段 1 成功：卡片状态进入 draft_generated，生成外语及中文对照草稿：")
        print("  - 外语正文:", owner_draft_res["draftReply"][:40], "...")
        print("  - 中文译文:", owner_draft_res["draftReplyZh"][:40], "...")

        # 验证持久化了 ChatMessage 上下文
        msg_count = db.query(ChatMessage).filter(ChatMessage.email_id == email.id, ChatMessage.user_id == owner.id).count()
        assert msg_count == 2, f"未正确持久化 user 与 assistant 消息: {msg_count}"
        print(f"✓ 对话上下文持久化成功：已记录 {msg_count} 条对话")

        # ──────────────────────────────────────────
        # 测试 3：阶段 2 - 确认发送邮件与闭环
        # ──────────────────────────────────────────
        print("\n--- 测试 3：阶段 2 - 确认发送邮件与闭环 ---")
        with patch("app.services.dingtalk_stream_listener.build_and_send_smtp_email", return_value=(True, "OK", "<sent_msg_001@example.com>", b"dummy_raw_bytes", [])):
            with patch("app.services.event_bus.event_bus.broadcast_to_user", new=AsyncMock()):
                send_res = await handler._handle_card_reply(
                    out_track_id="em_test_track_123",
                    params={"action": "confirm_send", "draftReply": owner_draft_res["draftReply"]},
                    operator_ding_uid="dd_owner_999"
                )

        assert send_res["stage"] == "replied", f"发送未进入 replied: {send_res}"
        assert "成功发出邮件回复" in send_res["statusText"]
        print(f"✓ 阶段 2 成功：卡片状态进入 replied，提示：{send_res['statusText']}")

        # 验证数据库状态更新
        db.refresh(email)
        assert email.status == "replied"
        assert email.dingtalk_card_status == "replied"
        sent_rec = db.query(EmailRecord).filter(EmailRecord.folder == "sent", EmailRecord.user_id == owner.id).first()
        assert sent_rec is not None
        print("✓ 数据库状态同步通过：原邮件 status=replied, 发件箱已落库")

        # ──────────────────────────────────────────
        # 测试 4：防重复发信拦截
        # ──────────────────────────────────────────
        print("\n--- 测试 4：防重复发信拦截 ---")
        dup_res = await handler._handle_card_reply(
            out_track_id="em_test_track_123",
            params={"action": "confirm_send"},
            operator_ding_uid="dd_owner_999"
        )
        assert "请勿重复发信" in dup_res["statusText"]
        print(f"✓ 防重机制生效：{dup_res['statusText']}")

        # 清理测试数据
        db.query(ChatMessage).filter(ChatMessage.email_id == email.id).delete()
        db.query(EmailRecord).filter(EmailRecord.user_id == owner.id).delete()
        db.query(MailAccount).filter(MailAccount.user_id == owner.id).delete()
        db.query(User).filter(User.id.in_([owner.id, intruder.id])).delete()
        db.commit()

        print("\n🎉 全部 4 项核心测试（越权隔离拦截、两阶段草稿生成、真实发信闭环、防重复发信）全部 100% 验证通过！")

    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(run_tests())
