import os
import sys
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.ai_service import ai_service
from app.services.mail_service import PROVIDER_PRESETS

async def main():
    print("--- 测试 AI 邮件分析降级与提示词模块 ---")
    mock_email = {
        "subject": "Inquiry regarding bulk order sample and lead time",
        "sender": "John Doe <john.doe@global-trade.com>",
        "body_text": """Dear Team,
We are interested in placing a bulk order for your industrial parts.
Could you please confirm the sample testing status and provide the latest tier-pricing?
We need to finalize our supplier by this Friday.
Best regards,
John"""
    }

    result = await ai_service.analyze_email(
        subject=mock_email["subject"],
        sender=mock_email["sender"],
        body_text=mock_email["body_text"]
    )
    print("✓ AI 分析输出结构正常:")
    print("  摘要:", result.get("summary_zh"))
    print("  引导问题:", result.get("guided_question"))
    print("  建议草稿:", result.get("initial_reply_draft"))

    print("\n--- 测试多轮对话起草 ---")
    chat_result = await ai_service.chat_and_refine_reply(
        subject=mock_email["subject"],
        sender=mock_email["sender"],
        original_body=mock_email["body_text"],
        chat_history=[],
        user_instruction="样品已完成质检，周一快递寄出，量产价格给95折"
    )
    print("✓ 多轮修改草稿输出:")
    print("  AI回复:", chat_result.get("response"))
    print("  草稿正文:", chat_result.get("draft_reply"))

if __name__ == "__main__":
    asyncio.run(main())
