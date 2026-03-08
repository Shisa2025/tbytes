import re


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _contains_tamil(text: str) -> bool:
    return any("\u0b80" <= ch <= "\u0bff" for ch in text)


def detect_language_tag(text: str) -> str:
    """
    Lightweight detector focused on Singapore's main languages.
    Returns one of: en, zh, ms, ta, unknown.
    """
    if not text:
        return "unknown"

    if _contains_cjk(text):
        return "zh"
    if _contains_tamil(text):
        return "ta"

    lowered = text.lower()
    words = set(re.findall(r"[a-zA-Z']+", lowered))
    if not words:
        return "unknown"

    malay_markers = {
        "dan", "yang", "dengan", "untuk", "adalah", "ini", "itu",
        "tidak", "boleh", "dalam", "kepada", "di", "apa", "kenapa",
        "bagaimana", "berita", "palsu", "benar", "salah", "polis",
    }
    if len(words.intersection(malay_markers)) >= 2:
        return "ms"

    return "en"
