import re

# 常用语言字符集正则特征
_RE_CHINESE = re.compile(r'[\u4e00-\u9fa5]')
_RE_JAPANESE_KANA = re.compile(r'[\u3040-\u309f\u30a0-\u30ff]')
_RE_KOREAN = re.compile(r'[\uac00-\ud7af\u1100-\u11ff]')
_RE_GERMAN = re.compile(r'[äöüßÄÖÜ]', re.IGNORECASE)
_RE_FRENCH = re.compile(r'[éàèùâêîôûëïüçÉÀÈÙÂÊÎÔÛËÏÜÇ]')
_RE_RUSSIAN = re.compile(r'[\u0400-\u04ff]')

def detect_language_fast(subject: str = "", text: str = "") -> str:
    """
    轻量、毫秒级、0 外部依赖的本地语种探测器。
    通过字符集特征矩阵快速识别中、日、韩、德、法、俄、英等常用商务语种。
    """
    subj = (subject or "").strip()
    txt = (text or "").strip()
    sample = f"{subj} {txt}"[:3000].strip()
    if not sample:
        return "zh"

    # 1. 优先统计东亚语言特征 (CJK)
    korean_count = len(_RE_KOREAN.findall(sample))
    if korean_count >= 2:
        return "ko"

    japanese_count = len(_RE_JAPANESE_KANA.findall(sample))
    if japanese_count >= 2:
        return "ja"

    chinese_count = len(_RE_CHINESE.findall(sample))
    subj_chinese = len(_RE_CHINESE.findall(subj))
    # 标题含 2 个以上汉字，或者整体样本含 4 个以上汉字，即可明确锁定为中文
    if subj_chinese >= 2 or chinese_count >= 4:
        return "zh"
    if chinese_count > 0 and (chinese_count / max(len(sample), 1)) > 0.05:
        return "zh"

    # 2. 统计斯拉夫语系 (俄语)
    if len(_RE_RUSSIAN.findall(sample)) >= 3:
        return "ru"

    # 3. 统计常见带重音特征的西欧语种
    if len(_RE_GERMAN.findall(sample)) >= 2:
        return "de"
    if len(_RE_FRENCH.findall(sample)) >= 2:
        return "fr"

    # 4. 默认通用西文（英语）
    return "en"
