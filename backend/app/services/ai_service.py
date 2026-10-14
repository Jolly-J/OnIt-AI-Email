import json
import re
import html
import asyncio
from datetime import datetime
import httpx
from typing import Dict, Any, List, Optional
from app.core.config import settings
from app.core.logger import logger

class AIService:
    def __init__(self):
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_BASE_URL.rstrip("/")
        self.model = settings.DEEPSEEK_MODEL

    async def _call_llm(
        self,
        messages: List[Dict[str, str]],
        response_format: Optional[str] = None,
        thinking_type: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
        max_retries: int = 1
    ) -> str:
        if not self.api_key:
            return ""

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3
        }

        if thinking_type:
            payload["thinking"] = {"type": thinking_type}
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort

        if response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}

        last_err = None
        for attempt in range(max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload
                    )
                    if resp.status_code != 200:
                        raise Exception(f"DeepSeek API 请求失败 [{resp.status_code}]: {resp.text}")
                    
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices:
                        msg = choices[0].get("message", {})
                        content = msg.get("content")
                        if content is None:
                            content = msg.get("reasoning_content") or choices[0].get("text") or ""
                        content = (content or "").strip()
                        if not content and attempt < max_retries:
                            logger.warning(f"[AIService] 第 {attempt + 1} 次调用返回空内容，正在重试...")
                            await asyncio.sleep(1.0)
                            continue
                        return content
                    return ""
            except httpx.TimeoutException as te:
                last_err = Exception("AI 响应超时（超过60秒），云端计算负载较高，请重试。")
                logger.warning(f"[AIService] 第 {attempt + 1} 次调用大模型超时: {te}")
            except Exception as e:
                last_err = e
                logger.warning(f"[AIService] 第 {attempt + 1} 次调用大模型异常: {e}")

            if attempt < max_retries:
                await asyncio.sleep(1.0)

        logger.error(f"[AIService] 大模型调用最终失败 (已重试 {max_retries} 次): {last_err}", exc_info=True)
        raise last_err

    @staticmethod
    def _clean_and_parse_json(raw: str) -> Dict[str, Any]:
        """高容错 JSON 提取与解析引擎：自动防御空响应、Markdown 代码块、思维链标签与语法污染"""
        if not raw or not raw.strip():
            return {}

        text = raw.strip()

        # 1. 自动剥离 <think>...</think> 思维链标签
        text = re.sub(r'<think>[\s\S]*?</think>', '', text).strip()

        # 2. 尝试直接解析
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        # 3. 自动剥离 ```json ... ``` 或 ``` ... ``` Markdown 代码块外壳
        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text, re.DOTALL)
        if code_block_match:
            candidate = code_block_match.group(1).strip()
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                text = candidate

        # 4. 正则贪婪匹配最外层的 {...} JSON 结构体
        brace_match = re.search(r'\{[\s\S]*\}', text)
        if brace_match:
            candidate = brace_match.group(0).strip()
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                # 尝试修复末尾悬挂逗号等轻微语法问题
                fixed = re.sub(r',\s*([\}\]])', r'\1', candidate)
                try:
                    parsed = json.loads(fixed)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    pass

        # 5. 极端容错兜底：大模型虽未输出规范 JSON，但返回了文本，将文本作为 response 安全返回
        logger.warning(f"[AIService] 无法从大模型响应中解析有效 JSON，进入优雅文本降级。原文前120字: {text[:120]}")
        return {
            "response": text,
            "draft_reply": "",
            "draft_reply_zh": "",
            "explanation": ""
        }

    async def analyze_email(self, subject: str, sender: str, body_text: str) -> Dict[str, Any]:
        """对单封邮件进行跨语言理解、中文要点提炼、诉求梳理与专业应对建议生成（不自动预制草稿）"""
        # 如果未配置 API Key，提供智能降级默认数据
        if not self.api_key:
            return {
                "language_detected": "en",
                "summary_zh": f"已收到来自 {sender} 的邮件：{subject}。（系统尚未配置 DEEPSEEK_API_KEY，请在后台设置中填写）",
                "key_points": ["发件人: " + sender, "主题: " + subject],
                "action_items": ["配置 DeepSeek API Key 开启全自动智能分析"],
                "guided_question": "建议在后台设置中配置 DeepSeek API Key，以获取深度智能分析与策略建议。",
                "initial_reply_draft": ""
            }

        # 限制传入 LLM 的正文长度（防止超大邮件爆 token）
        trimmed_body = body_text[:4000] if body_text else "（邮件正文为空）"

        system_prompt = """你是一位精通跨国商务、外贸外语与企业沟通的高级智能邮件助理。
你的任务是深入阅读客户/发件人的来信，并为中国团队员工完成结构化分析与中文化梳理，给出切实可行的应对建议。
注意：此时请不要起草完整回信草稿，邮件草稿将在员工给出明确指令后再行撰写。

请严格输出 JSON 格式（不要包含任何 markdown 代码块标记如 ```json），格式如下：
{
  "language_detected": "源邮件语言代码，如 en, ja, de, zh 等",
  "summary_zh": "极简中文核心摘要，严格控制在15~20字以内！直奔主题，严禁使用任何'这是一封来自...'、'系统通知告知...'等无意义废话套话。直接说明最核心的事由动作，例如：'深度求索开具200元发票'、'外商询问样品测试进度与量产报价'、'51Job总经办秘书岗位邀约'、'民生信用卡9月电子对账单'。",
  "key_points": [
    "要点1：用通俗中文说明来信的核心背景与主要事实内容（邮件具体在说什么）",
    "要点2：商务条款、技术参数、时间节点或具体细节"
  ],
  "action_items": [
    "对方明确提出的要求、问题或我方需要处理的待办事项"
  ],
  "guided_question": "AI专业应对建议：从专业商务沟通、谈判博弈或业务协同角度，为员工提出具体可行的应对思路与建议（例如：'建议先确认仓库现货库存并说明样品下周一寄出；针对对方要求的折扣，可提出采购满500件享受95折的阶梯优惠策略。'）"
}"""

        user_content = f"邮件主题: {subject}\n发件人: {sender}\n\n邮件原文内容:\n{trimmed_body}"

        try:
            raw_response = await self._call_llm(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                response_format="json_object",
                thinking_type="disabled"
            )
            data = self._clean_and_parse_json(raw_response)
            return {
                "language_detected": data.get("language_detected", "en"),
                "summary_zh": data.get("summary_zh", ""),
                "key_points": data.get("key_points", []),
                "action_items": data.get("action_items", []),
                "guided_question": data.get("guided_question", "建议先核实发件人诉求，根据业务实际情况决定答复策略。"),
                "initial_reply_draft": ""
            }
        except Exception as e:
            logger.error(f"[AIService] 分析邮件异常: {e}", exc_info=True)
            return {
                "language_detected": "unknown",
                "summary_zh": f"邮件分析失败: {str(e)}",
                "key_points": [],
                "action_items": [],
                "guided_question": "建议先核实发件人诉求，根据业务实际情况决定答复策略。",
                "initial_reply_draft": ""
            }

    async def chat_and_refine_reply(
        self,
        subject: str,
        sender: str,
        original_body: str,
        chat_history: List[Dict[str, str]],
        user_instruction: str,
        language_detected: str = "zh",
        user_name: str = "",
        user_department: str = "",
        company_name: str = "",
        company_name_en: str = "",
        ai_summary: str = "",
        key_points: Optional[List[str]] = None,
        action_items: Optional[List[str]] = None,
        current_draft: Optional[str] = None
    ) -> Dict[str, str]:
        """单邮件多轮对话：根据员工提出的修改指令，结合原邮件语言判定与前置分析，持续微调生成专业的商务回复稿"""
        sender_name = sender.split('<')[0].strip().replace('"', '')
        is_zh = (language_detected or "").lower().startswith("zh")
        company_name = company_name.strip() if company_name else settings.COMPANY_NAME
        company_name_en = company_name_en.strip() if company_name_en else settings.COMPANY_NAME_EN
        user_display = user_name.strip() if user_name else "业务专员"
        dept_display = user_department.strip() if user_department else "商务部"

        if not self.api_key:
            if settings.MOCK_MODE:
                resp_text = f"【演示模式】已收到您的指示：「{user_instruction}」。我已结合原邮件商务语境为您微调了回复草稿，请在下方核对。"
                expl_text = f"【演示策略】针对指示「{user_instruction}」，在回复草稿中保持了严谨礼貌与明确的业务推进步骤。"
            else:
                resp_text = "（请先配置 DEEPSEEK_API_KEY）您的指令已收到。"
                expl_text = "已根据您的指示生成基础草稿模板（请先配置 API Key 以获取深度公文撰写）。"

            if is_zh:
                fallback_draft = f"{sender_name}，您好：\n\n关于您的来信已收到，针对「{user_instruction}」，我方已推进落实。\n\n此致\n敬礼！\n\n{user_display}\n{dept_display}\n{company_name}"
                fallback_draft_zh = ""
            else:
                fallback_draft = f"Dear {sender_name},\n\nThank you for reaching out. Regarding your inquiry: {user_instruction}\n\nBest regards,\n{user_display}\n{dept_display}\n{company_name_en}"
                fallback_draft_zh = f"尊敬的 {sender_name}：\n\n感谢您的来信。关于您的询问：针对「{user_instruction}」，我方已推进落实。\n\n此致\n敬礼！\n\n{user_display}\n{dept_display}\n{company_name}"
            return {
                "response": resp_text,
                "draft_reply": fallback_draft,
                "draft_reply_zh": fallback_draft_zh,
                "explanation": expl_text
            }

        # 组装前置深度分析事实锚点（防偏航）
        analysis_context_parts = []
        if ai_summary and ai_summary.strip():
            analysis_context_parts.append(f"- 【邮件核心中文摘要】：{ai_summary.strip()}")
        if key_points and isinstance(key_points, list):
            kp_items = [str(p).strip() for p in key_points if str(p).strip()]
            if kp_items:
                analysis_context_parts.append(f"- 【核心事实与要点】：{'；'.join(kp_items)}")
        if action_items and isinstance(action_items, list):
            ai_items = [str(a).strip() for a in action_items if str(a).strip()]
            if ai_items:
                analysis_context_parts.append(f"- 【对方核心诉求与待办事项】：{'；'.join(ai_items)}")
        
        analysis_section = ""
        if analysis_context_parts:
            analysis_section = (
                "\n【原邮件核心事实与 AI 前置深度分析锚点（牢记客户诉求，杜绝偏航）】：\n"
                + "\n".join(analysis_context_parts)
                + "\n"
            )

        lang_rule = (
            "【当前邮件已判定为中文来信】\n"
            "- 除非员工在指令中特别指定使用外语，否则请使用地道规范的简体中文撰写回复公文。\n"
            "- 回信草稿必须符合中国商业信函规范（包含得体称呼、诚恳清晰的正文、礼貌祝颂语与规范落款，段落之间必须空一行隔开）。\n"
            "- draft_reply_zh 留空即可，explanation 可简要总结本次回信思路。"
            if is_zh else
            f"【当前邮件判定为外语来信（来信语言代码：{language_detected}）】\n"
            "- 必须严格使用正式得体的外语（如英文或原信语种）撰写纯净的回复邮件草稿（draft_reply），【严禁在 draft_reply 内包含任何中文说明、翻译或删除提示】！\n"
            "- 必须在 draft_reply_zh 字段中提供与 draft_reply 逐段 1:1 镜像对称的完整正式简体中文商务公文（必须包含规范的正式中文尊称、逐段完整中文译文、礼貌祝颂语和中文署名落款，绝不是简短的大意或释义！）。\n"
            "- 必须在 explanation 字段中提供中文要点与商务策略对照说明，分条清晰说明我们这封外文稿重点表达了什么、采取了怎样的沟通策略以达成业务目标。"
        )

        system_prompt = f"""你是一位精通全球商务、科技与企业公文的高级邮件智能顾问兼行业分析专家。
当前正在协助【{company_name}】团队员工处理对外邮件，具备两项同等重要的核心职责：
① 【知识答疑与深度分析顾问】：为员工答疑解惑、深度科普来信背景、分析对方平台/技术概念/企业背景与潜在业务/安全风险；
② 【商务公文拟稿专家】：起草并微调正式、专业、严谨规范的外文回复邮件及中文公文对照。

【沟通双方身份信息（非常重要，严禁混淆！）】：
- 【对方客户（收件人 / 原信发件方）】：{sender}
- 【我方回信人（发件方 / 我方员工）】：{user_display}
- 【我方所在部门】：{dept_display}
- 【我方企业名称】：中文：{company_name}，英文/国际通用：{company_name_en}
- 邮件主题：{subject}
- 邮件判定语言：{language_detected}
- 邮件原文摘录：{original_body[:2500]}
{analysis_section}

【核心行为铁律（极重要，务必严格遵守！）】：
1. 【有问必答原则（背景科普与知识咨询）】：
   - 当员工询问任何有关来信背景、平台/产品是什么、对方技术原理、公司背景（例如“这个平台是做什么的”、“Hindsight Cloud 是什么平台”等）或探讨业务应对策略时：
     * 你必须充分调动你的全球科技与商业知识库（World Knowledge），向员工提供通俗易懂、客观详尽、条理分明的专业解答与科普！
     * 【绝对严禁】因为邮件原文中只有验证码或文字简短而拒绝回答或输出空白！即使原信未做介绍，你也必须根据你所知道的该平台知识（例如其定位、AI记忆云服务、典型用途等）向员工进行深度说明。
     * 你必须将针对员工提问的完整分析与解答【直接写在 response 字段中】（建议不少于 150 字），此时 draft_reply 与 draft_reply_zh 必须设为空字符串 ""！

2. 【绝对红线规则（严防署名倒置）】：
   - 邮件正文末尾的【发信人署名落款】，必须是我方员工【{user_display}】以及我方公司【{company_name_en}】或【{company_name}】！
   - 【绝对严禁】将对方客户姓名（如原信发件人 {sender_name} 等）作为回信署名签在末尾！对方是收件人，绝不是回信人！
   - 正规商务邮件落款格式模板：
     * 外文邮件正文（draft_reply）落款范例：
       Best regards,
       {user_display}
       {dept_display}
       {company_name_en}
     * 中文公文正文（draft_reply_zh）落款范例：
       此致
       敬礼！

       {user_display}
       {dept_display}
       {company_name}

3. 【商务公文排版与段落空行铁律（极重要，杜绝行挨着行紧凑挤压）】：
   - 必须使用【双换行符（\\n\\n）】在收件方尊称、正文各议题段落之间、正文与祝颂语之间、祝颂语与落款之间保留清晰标准空白行。

4. 【多轮人机协同拟稿、修改研判与沟通铁律】：
   - 【自主对比研判用户修改内容（上下文 Diff）】：
     结合历史对话草稿与当前草稿，若用户修改了中文公文，以中文为基准翻译校准外文；若修改了外文，校准中文对照。
   - 【沟通优先与按需出稿原则（严禁机械化每轮强行出稿！）】：
     仅当员工明确发出了起草、修改、更新、翻译、润色指令，或明确同意上一轮拟稿建议时，才在 draft_reply 与 draft_reply_zh 中输出完整草稿；
     若本轮仅为交流探讨、咨询提问或要求澄清，必须在 response 详尽解答，草稿字段设为空字符串 ""。

回复语言规则（最高优先级）：
{lang_rule}

你的输出格式规范：
严格输出 JSON 格式（严禁包含任何 ```json 等 markdown 标记），字段格式规范如下：
{{
  "response": "与员工直接沟通交流的完整中文回复（必填项，绝对严禁留空或输出空字符串！）。若员工是在询问知识、了解平台背景或探讨策略，在此给出详尽透彻、专业的解答（充分运用你的世界知识库详尽科普）；若为起草/修改邮件，在此简明汇报工作。",
  "draft_reply": "仅在员工明确要求起草、修改、更新、润色或翻译邮件时输出完整纯净的外文邮件正文（若本轮仅为交流沟通、背景咨询或探讨提问，此字段必须为空字符串 \"\"！）。署名落款必须是我方员工与 {company_name_en}！",
  "draft_reply_zh": "仅在确实需要生成/更新中文公文时输出完整 1:1 镜像对称的中文公文（若为纯沟通、背景咨询，此字段必须为空字符串 \"\"）。署名落款必须为我方员工与 {company_name}！",
  "explanation": "中文要点与商务策略对照说明（仅在本次生成了草稿时提供；若未生成新草稿，留空字符串 \"\" 即可，切勿将针对员工咨询的回答误放在此处）。"
}}"""

        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_history:
            messages.append({"role": msg["role"], "content": msg["content"]})

        # 组装当前用户轮次的内容：给大模型提供基准草稿（若有），由大模型自行对比上下文进行研判
        if current_draft and current_draft.strip():
            user_turn_content = (
                f"【员工当前编辑器/界面中最新的草稿内容（请与上文历史草稿进行 Diff 比对，自主研判员工修改了中文还是外文，严格遵循定稿保护与按需出稿铁律）】：\n"
                f"\"\"\"\n{current_draft.strip()}\n\"\"\"\n\n"
                f"【员工本次的输入内容/指令】：\n"
                f"{user_instruction.strip()}"
            )
        else:
            user_turn_content = user_instruction.strip()

        messages.append({"role": "user", "content": user_turn_content})

        try:
            logger.info(f"[AIService] 发起对话大模型调用 | 历史轮数: {len(chat_history)} | 当前输入: {user_instruction[:60]}")
            raw_response = await self._call_llm(
                messages=messages,
                response_format="json_object",
                thinking_type="enabled",
                reasoning_effort="low"
            )
            logger.info(f"[AIService] 大模型原始返回 (前200字): {raw_response[:200] if raw_response else '空'}")
            data = self._clean_and_parse_json(raw_response)

            draft_reply = (data.get("draft_reply") or "").strip()
            draft_reply_zh = (data.get("draft_reply_zh") or "").strip()
            explanation = (data.get("explanation") or "").strip()

            # 防呆过滤：若 draft_reply 末尾偶尔遗留了分隔线或中文说明，自动切除剥离
            import re
            split_match = re.search(r'(\n\s*---\s*\n.*)$', draft_reply, re.DOTALL)
            if split_match:
                trailing = split_match.group(1).strip()
                draft_reply = draft_reply[:split_match.start()].strip()
                if not explanation:
                    explanation = trailing.replace('---', '').strip()

            # 多字段兼容提取员工沟通文本（防止大模型返回 reply/content/message/answer 等别名字段）
            response_text = (
                data.get("response")
                or data.get("reply")
                or data.get("content")
                or data.get("message")
                or data.get("answer")
                or ""
            )
            if isinstance(response_text, str):
                response_text = response_text.strip()
            else:
                response_text = str(response_text).strip() if response_text else ""

            # 字段提升守卫：若大模型在纯咨询场景下将回答误填入 explanation，而 response 为空且本轮未生成任何草稿，
            # 自动将 explanation 提升为 response，确保前端对话气泡中能完整展示分析回答
            if not response_text and explanation and not draft_reply and not draft_reply_zh:
                response_text = explanation
                explanation = ""

            # 动态语义兜底与问答保底机制：若极端情况下仍未获取到 response_text
            if not response_text:
                # 检查用户指令是否属于背景咨询/提问
                is_question = any(q in user_instruction for q in ["什么", "怎么", "谁", "介绍", "看", "平台", "公司", "为何", "为什么", "咨询", "解释"])
                if is_question and not draft_reply and not draft_reply_zh:
                    # 针对知识问答类问题，如果 JSON 模式下未能产出内容，自动通过快速纯文本问答重试，确保有问必答
                    try:
                        logger.info("[AIService] 知识咨询未产出有效内容，启动快速纯文本问答重试保底...")
                        qa_messages = [
                            {"role": "system", "content": f"你是一位精通全球科技与商业的智能顾问。员工正在处理一封关于【{subject}】（发件方：{sender}）的邮件，请结合邮件上下文与你的世界知识，专业、通俗、条理清晰地回答员工的问题。"},
                            {"role": "user", "content": user_instruction}
                        ]
                        fallback_raw = await self._call_llm(messages=qa_messages, max_retries=1)
                        if fallback_raw and fallback_raw.strip():
                            fallback_clean = re.sub(r'<think>[\s\S]*?</think>', '', fallback_raw).strip()
                            if fallback_clean:
                                response_text = fallback_clean
                    except Exception as ex:
                        logger.warning(f"[AIService] 纯文本问答重试保底异常: {ex}")

            if not response_text:
                if draft_reply or draft_reply_zh:
                    response_text = "已根据您的最新指示为您生成/更新回复草稿，请在下方查阅确认。"
                else:
                    response_text = "已收到您的指示。如需帮您撰写或调整回复邮件，请随时告知我您的具体意图。"

            return {
                "response": response_text,
                "draft_reply": draft_reply,
                "draft_reply_zh": draft_reply_zh,
                "explanation": explanation
            }
        except Exception as e:
            err_msg = str(e).strip() or "大模型响应超时或网络连接异常，请重试。"
            logger.error(f"[AIService] AI 对话处理失败: {err_msg}", exc_info=True)
            raise Exception(err_msg)

    async def compose_new_mail(
        self,
        user_instruction: str,
        to_email: str = "",
        subject: str = "",
        current_draft: Optional[str] = None,
        chat_history: Optional[List[Dict[str, str]]] = None,
        language_preference: str = "auto",
        user_name: str = "",
        user_department: str = "",
        company_name: str = "",
        company_name_en: str = ""
    ) -> Dict[str, str]:
        """针对新邮件撰写场景的多轮 AI 伴随起草与公文生成"""
        chat_history = chat_history or []
        company_name = company_name.strip() if company_name else settings.COMPANY_NAME
        company_name_en = company_name_en.strip() if company_name_en else settings.COMPANY_NAME_EN
        user_display = user_name.strip() if user_name else "业务专员"
        dept_display = user_department.strip() if user_department else "商务部"

        if not self.api_key:
            fallback = (
                f"Dear Partner,\n\n"
                f"Regarding {subject or 'our business collaboration'}: {user_instruction}\n\n"
                f"Best regards,\n{user_display}\n{dept_display}\n{company_name_en}"
            )
            fallback_zh = (
                f"尊敬的合作伙伴：\n\n"
                f"关于 {subject or '业务合作交流'}：{user_instruction}\n\n"
                f"此致\n敬礼！\n\n{user_display}\n{dept_display}\n{company_name}"
            )
            return {
                "response": "（请先配置 DEEPSEEK_API_KEY）已为您生成基础写信模版。",
                "draft_reply": fallback,
                "draft_reply_zh": fallback_zh,
                "explanation": "已根据您的意图生成初步起草模板，配置 API Key 后可启用全自动高水准商务公文撰写。"
            }

        # 判定是否倾向于外语公文：根据收件人邮箱后缀、用户指令或偏好
        is_foreign = False
        if language_preference == "en" or language_preference == "foreign":
            is_foreign = True
        elif language_preference == "zh":
            is_foreign = False
        else:
            # 自动探测：若收件人包含非 .cn 常见海外域名，或指令/主题中出现英文单词较多或明确提及英文/海外/出口
            foreign_keywords = ["英文", "外文", "海外", "出口", "展会", "english", "export", "foreign", "client"]
            has_foreign_kw = any(kw in (user_instruction + " " + subject).lower() for kw in foreign_keywords)
            has_foreign_domain = any(to_email.lower().endswith(tld) for tld in [".com", ".de", ".org", ".io", ".net", ".jp", ".kr", ".eu", ".uk"])
            is_foreign = has_foreign_kw or (bool(to_email) and has_foreign_domain and not to_email.endswith(".cn"))

        lang_rule = (
            f"【当前公文设定为外语商务邮件（英文/国际通用）】\n"
            "- 必须严格使用正式得体、地道严谨的国际商务外语（如英文）撰写纯净的邮件正文草稿（draft_reply），【严禁在 draft_reply 内包含任何中文说明或多余标记】！\n"
            "- 必须在 draft_reply_zh 字段中提供与 draft_reply 逐段 1:1 镜像对称的完整正式简体中文商务公文（包含规范尊称、逐段译文、祝颂语和完整中文署名）。\n"
            "- 必须在 explanation 字段中提供简短的中文策略要点与行文构思说明。"
            if is_foreign else
            f"【当前公文设定为规范中文商务邮件】\n"
            "- 请使用符合中国现代商业信函规范的简体中文撰写（得体称谓、清晰正文、礼貌祝颂与规范署名落款）。\n"
            "- draft_reply 存放该中文正文，draft_reply_zh 可留空字符串 \"\"，explanation 简要总结本信写作策略。"
        )

        recipient_desc = to_email.strip() if to_email else "外部客户 / 商业合作伙伴"
        subject_desc = subject.strip() if subject else "尚未指定主题（请根据公文内容拟定）"

        system_prompt = f"""你是一位精通全球商业沟通与跨国涉外公文的高级邮件顾问兼商业撰稿专家。
当前正在协助企业员工（发信人）对外撰写或润色商务邮件。

【我方发信身份（绝对红线，落款署名严禁混淆！）】：
- 我方发件员工：{user_display}
- 我方所在部门：{dept_display}
- 我方企业名称：中文：{company_name}，国际英文：{company_name_en}

【拟发往的收件方与主题】：
- 收件方：{recipient_desc}
- 拟定主题：{subject_desc}

【核心行为准则与撰写规范】：
1. 【顾问式探询与意图澄清原则（人机协同铁律）】：
   - 当员工发出的指令过于宽泛、缺乏关键业务要素时（例如仅说“帮我写一封开发信”、“起草报价函”、“我想发邮件”），【严禁】凭空编造具体的虚假产品参数、客户名称或具体业务细节直接出稿！
   - 此时你必须以专业公文顾问的身份，在 response 中以友好得体、结构清晰的方式向员工提出 2~3 个核心澄清问题（如：目标客户身份/行业、主推产品或合作事项、期望推动的下一步行动等），此时 draft_reply 与 draft_reply_zh 必须留空 \"\"！
   - 当员工在后续回复中补充了关键信息，或者指令本身已足够详实（明确了客户类型、主推产品/服务及行动），你必须立即结合所有已知要素，生成高水准的双语商业公文。
2. 【落款署名】：
   - 邮件正文末尾发信人署名必须是我方员工【{user_display}】与【{company_name_en}】或【{company_name}】，严禁倒置为客户！
3. 【标准排版与段落空行】：
   - 必须使用【双换行符（\\n\\n）】分隔收件方称呼、正文议题段落、礼貌祝颂语与落款，段落清晰，杜绝拥挤。

{lang_rule}

你的输出格式规范：
严格输出 JSON 格式（严禁包含任何 ```json 等 markdown 标记）：
{{
  "response": "与员工交流的中文回复（必填，简要说明本次起草构想或解答咨询）。",
  "draft_reply": "起草或润色的纯净邮件正文（若为外语邮件则为纯外语，若为中文邮件则为中文）。",
  "draft_reply_zh": "与外语草稿严格 1:1 对应的完整中文公文（若为纯中文邮件留空 \"\"）。",
  "explanation": "中文策略与要点说明（说明核心诉求与行文策略）。"
}}"""

        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_history:
            messages.append({"role": msg["role"], "content": msg["content"]})

        user_content_parts = []
        if to_email:
            user_content_parts.append(f"【收件人邮箱】：{to_email}")
        if subject:
            user_content_parts.append(f"【拟定主题】：{subject}")
        if current_draft and current_draft.strip():
            user_content_parts.append(f"【当前编辑器中已有的草稿正文（供润色/修改参考）】：\n\"\"\"\n{current_draft.strip()}\n\"\"\"")
        user_content_parts.append(f"【员工的具体起草指令/要求】：\n{user_instruction.strip()}")

        messages.append({"role": "user", "content": "\n\n".join(user_content_parts)})

        try:
            logger.info(f"[AIService] 发起写信大模型调用 | 历史轮数: {len(chat_history)} | 指令: {user_instruction[:60]}")
            raw_response = await self._call_llm(
                messages=messages,
                response_format="json_object",
                thinking_type="enabled",
                reasoning_effort="low"
            )
            data = self._clean_and_parse_json(raw_response)

            draft_reply = (data.get("draft_reply") or "").strip()
            draft_reply_zh = (data.get("draft_reply_zh") or "").strip()
            explanation = (data.get("explanation") or "").strip()
            response_text = (
                data.get("response")
                or data.get("reply")
                or data.get("content")
                or data.get("message")
                or ""
            )
            if isinstance(response_text, str):
                response_text = response_text.strip()
            else:
                response_text = str(response_text).strip() if response_text else ""

            if not response_text:
                if draft_reply or draft_reply_zh:
                    response_text = "已根据您的要求起草完毕，您可以在右侧查阅草稿并一键填入正文。"
                else:
                    response_text = "已收到您的指示。请告诉我更多关于收件人、意图或关键条款的信息，我来帮您起草。"

            return {
                "response": response_text,
                "draft_reply": draft_reply,
                "draft_reply_zh": draft_reply_zh,
                "explanation": explanation
            }
        except Exception as e:
            err_msg = str(e).strip() or "大模型响应超时或网络连接异常，请重试。"
            logger.error(f"[AIService] 写信 AI 处理失败: {err_msg}", exc_info=True)
            raise Exception(err_msg)

    @staticmethod
    def _wrap_text_as_clean_html(text: str) -> str:
        """将纯文本正文安全包装为现代自适应邮件 HTML 模板"""
        if not text:
            return ""
        paragraphs = []
        for block in text.strip().split("\n\n"):
            clean_b = html.escape(block.strip()).replace("\n", "<br/>")
            if clean_b:
                paragraphs.append(f'<p style="margin:0 0 14px 0;line-height:1.75;font-size:14px;color:#1e293b;">{clean_b}</p>')
        body_content = "".join(paragraphs) or f'<p style="line-height:1.75;font-size:14px;color:#1e293b;">{html.escape(text)}</p>'
        return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    padding: 16px;
    margin: 0;
    background: transparent;
    color: #1e293b;
    word-break: break-word;
  }}
  p {{ margin: 0 0 14px 0; line-height: 1.7; }}
  a {{ color: #2563eb; text-decoration: underline; }}
</style>
</head>
<body>
<div class="translated-mail-body">
  {body_content}
</div>
</body>
</html>"""

    @staticmethod
    def _safe_parse_translation_response(raw_text: str, default_subject: str, default_text: str) -> Dict[str, str]:
        """增强型多层容错 JSON 解析器，彻底防范大模型特殊引号与 Token 截断"""
        text = (raw_text or "").strip()
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines).strip()

        # 1. 第一层：标准解析
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        # 2. 第二层：清洗不可见控制字符与孤立控制符
        try:
            cleaned = re.sub(r'[\x00-\x1f\x7f-\x9f]', lambda m: ' ' if m.group(0) in ('\t', '\r', '\n') else '', text)
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        # 3. 第三层：正则流式定向抓取关键字段（支持尾部截断与未闭合容错）
        result = {
            "translated_subject": default_subject,
            "translated_body_html": "",
            "translated_body_text": default_text
        }

        subj_m = re.search(r'"translated_subject"\s*:\s*"((?:\\.|[^"\\])*)"', text)
        if subj_m:
            try:
                result["translated_subject"] = json.loads(f'"{subj_m.group(1)}"')
            except Exception:
                result["translated_subject"] = subj_m.group(1).strip()

        text_m = re.search(r'"translated_body_text"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
        if text_m:
            try:
                result["translated_body_text"] = json.loads(f'"{text_m.group(1)}"')
            except Exception:
                result["translated_body_text"] = text_m.group(1).replace(r'\n', '\n').replace(r'\"', '"').strip()

        html_m = re.search(r'"translated_body_html"\s*:\s*"((?:\\.|[^"\\])*)"', text, re.DOTALL)
        if html_m:
            try:
                result["translated_body_html"] = json.loads(f'"{html_m.group(1)}"')
            except Exception:
                result["translated_body_html"] = html_m.group(1).replace(r'\n', '\n').replace(r'\"', '"').strip()

        return result

    async def translate_email(
        self,
        subject: str,
        body_text: str,
        body_html: Optional[str] = None,
        target_lang: str = "zh"
    ) -> Dict[str, str]:
        """将邮件主题与正文高保真翻译为目标语言（默认简体中文），长邮件自动解耦安全排版"""
        if not self.api_key:
            return {
                "translated_subject": subject + " (未配置AI Key)",
                "translated_body_html": body_html or "",
                "translated_body_text": (body_text or "") + "\n\n(提示: 尚未配置 DEEPSEEK_API_KEY)"
            }

        clean_text = (body_text or "").strip()
        clean_html = (body_html or "").strip()

        # 复杂长邮件与发票邮件判定（HTML 大于 2KB）
        is_heavy = bool(clean_html and len(clean_html) > 2000)

        if is_heavy:
            # 长邮件/发票邮件：仅翻译主题与纯文本正文，从根源杜绝万字 HTML 导致的 JSON 转义崩溃与 Token 截断
            system_prompt = """你是一位精通跨国商业沟通的高级商务翻译专家。
你的任务是将邮件的主题与正文精准、专业、得体地翻译为简体中文。

【严格执行规则】：
1. 忠实于原文，符合地道严谨的中国商业公文规范（包含得体的商务尊称、正文、祝颂语与落款）。若原文已是中文，请润色使其更清晰规范。
2. 保留专有名词、公司品牌、产品型号、发票单据号、时间节点与金额数字的准确性。
3. 严格输出 JSON 格式（严禁包含任何 ```json 等 markdown 标记），字段格式如下：
{
  "translated_subject": "翻译后的中文邮件主题",
  "translated_body_text": "翻译后的中文正文内容（保持良好段落换行与商务公文排版）"
}"""
            input_data = {
                "subject": subject or "",
                "body_text": clean_text[:4000] or clean_html[:2000]
            }
        else:
            # 简单短邮件：允许原位高保真输出基础 HTML 结构
            system_prompt = """你是一位精通跨国商业沟通的高级商务翻译专家。
你的任务是将外语邮件精准、专业、得体地翻译为简体中文。

【严格执行规则】：
1. 仅翻译人类可读文本，译文必须忠实于原文，符合严谨商务沟通规范。
2. 若正文包含 HTML 标记，尽量保留基础排版，切勿遗漏闭合标签。
3. 严格输出 JSON 格式（严禁包含任何 ```json 等 markdown 标记），字段格式如下：
{
  "translated_subject": "翻译后的中文邮件主题",
  "translated_body_html": "翻译后的正文 HTML 内容（若无 HTML 则为空字符串）",
  "translated_body_text": "翻译后的正文纯文本内容"
}"""
            input_data = {
                "subject": subject or "",
                "body_text": clean_text[:4000],
                "body_html": clean_html[:3000] if clean_html else ""
            }

        user_content = f"请翻译以下邮件内容至简体中文：\n{json.dumps(input_data, ensure_ascii=False)}"

        try:
            raw_response = await self._call_llm(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                response_format="json_object",
                thinking_type="disabled"
            )
            data = self._safe_parse_translation_response(raw_response, subject, clean_text)

            trans_subject = data.get("translated_subject") or subject
            trans_text = data.get("translated_body_text") or clean_text
            trans_html = data.get("translated_body_html") or ""

            # 若为长邮件或大模型未输出 HTML，而后端拥有纯文本译文，自动封装优雅现代 HTML
            if (is_heavy or not trans_html) and trans_text:
                trans_html = self._wrap_text_as_clean_html(trans_text)

            return {
                "translated_subject": trans_subject,
                "translated_body_html": trans_html,
                "translated_body_text": trans_text
            }
        except Exception as e:
            logger.error(f"[AIService] 翻译邮件异常: {e}", exc_info=True)
            # 终极健壮兜底：即使大模型网络偶发异常，绝不向外抛 500，返回安全兜底数据
            return {
                "translated_subject": subject,
                "translated_body_html": clean_html or self._wrap_text_as_clean_html(clean_text),
                "translated_body_text": clean_text or "(翻译响应超时，已为您展示原文)"
            }

    async def extract_meeting_proposal(
        self,
        content: str,
        subject: Optional[str] = ""
    ) -> Dict[str, Any]:
        """
        从邮件往来正文或草稿回复中，使用 AI 智能提取会议意图、时间、主题与参会人
        """
        if not self.api_key or not content:
            return {
                "is_meeting": False,
                "summary": subject or "",
                "meeting_date": "",
                "start_time": "",
                "end_time": "",
                "description": "",
                "attendee_mobiles": [],
                "attendee_emails": [],
                "confidence": 0.0
            }

        system_prompt = """你是一个智能日程助理。你的任务是从用户给定的邮件往来或发信正文中，分析是否双方达成了会议约定或提议了具体会议时间。
如果检测到有具体的会议约定（尤其是线上会议、钉钉会议、腾讯会议、电话沟通、线下拜访交流等），请输出 JSON 格式：
{
  "is_meeting": true,
  "summary": "会议主题（【强制要求】：必须是规范得体的简体中文！无论原信是日文、英文还是其他外语，均必须翻译归纳为纯中文，严禁包含任何日文假名或外文原词，如：【线上沟通】量产采用与评估结果确认事项）",
  "meeting_date": "YYYY-MM-DD 格式日期（若仅提到'下周一'或'明天'等，请结合上下文推算，格式必须为 YYYY-MM-DD）",
  "start_time": "HH:MM 格式开始时间，如 15:00",
  "end_time": "HH:MM 格式结束时间，如 16:00（若未明确提结束时间，默认开始后 1 小时或半小时）",
  "description": "简述会议背景与议程，不超过 100 字（同样必须为纯中文）",
  "attendee_mobiles": ["提取到的参会人中国大陆手机号（如有）"],
  "attendee_emails": ["提取到的参会人邮箱（如有）"],
  "confidence": 0.95
}

如果邮件内容完全没有提及会议或时间约定（例如仅是纯业务通知、发票确认、咨询解答等），请输出：
{
  "is_meeting": false,
  "summary": "",
  "meeting_date": "",
  "start_time": "",
  "end_time": "",
  "description": "",
  "attendee_mobiles": [],
  "attendee_emails": [],
  "confidence": 0.0
}
特别提醒：summary 和 description 必须始终使用规范的简体中文输出。请严格只返回 JSON，不要包含任何 markdown 代码块标识或额外文字。"""

        today_str = datetime.now().strftime("%Y-%m-%d")
        user_prompt = f"当前基准参考日期：{today_str}\n邮件主题：{subject or '无'}\n邮件正文内容：\n{content[:2500]}"

        try:
            raw_response = await self._call_llm(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format="json_object",
                thinking_type="disabled"
            )
            data = json.loads(raw_response.strip())
            return data
        except Exception as e:
            logger.warning(f"[AIService] 提取会议日程提议失败: {e}")
            return {
                "is_meeting": False,
                "summary": subject or "",
                "meeting_date": "",
                "start_time": "",
                "end_time": "",
                "description": "",
                "attendee_mobiles": [],
                "attendee_emails": [],
                "confidence": 0.0
            }

ai_service = AIService()

