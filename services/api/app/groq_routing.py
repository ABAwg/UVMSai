"""Small, deterministic Groq route policy; no extra services or credentials."""
import re

UZBEK_INSTRUCTIONS = (
    "Answer in natural modern Uzbek (o‘zbek tili), using the user's script. "
    "Use natural Uzbek syntax; do not mix Russian, Kazakh or Turkish unnecessarily. "
    "Use established technical terminology, optionally adding the English term in parentheses. "
    "Never invent definitions or conflate related quantities (for example, energy and power). "
    "Prefer clear everyday wording over literal translations or artificial terminology."
    "\nO‘zbek tilida ravon va adabiy yozing. Qisqa, tabiiy gaplar tuzing. "
    "Javobni yuborishdan oldin imlo, qo‘shimchalar va so‘zlarning ma’nosini tekshiring. "
    "Noma’lum yoki sun’iy so‘z o‘rniga tushunarli iborani tanlang. "
    "Texnik atamalarni aniq qo‘llang, dalil bilan taxminni ajrating."
)
CODING_INSTRUCTIONS = (
    "For programming, provide complete, compilable code with required imports and balanced syntax. "
    "Check imports, types, library versions and edge cases; mention version assumptions when relevant. "
    "Check types, edge cases, cleanup and races; for React also check StrictMode effect replay. "
    "Include a focused way to verify runnable code when useful. Never say a compiler or test ran "
    "unless execution evidence was supplied. If given compiler diagnostics, fix the reported problem "
    "and recheck the whole snippet. Do not truncate code or use placeholders in requested complete files."
)
VISION_INSTRUCTIONS = (
    "Describe only directly visible image evidence. Do not guess a location, identity, brand, event, "
    "cause or hidden context. Do not invent objects, text or properties. Explicitly mark indistinct "
    "details as unclear. Separate observation from assumption. If the requested fact cannot be "
    "determined from the image, say so. Deny absent objects instead of accepting a leading premise. "
    "For factual image answers use only the internal visual evidence; never show its JSON to the user."
)

# Several independent lexical signals, not a trigger word or a language-name mention.
_UZ_WORDS = set("men menga mening biz bizning siz sizning uchun bilan qanday nima nega nimani "
    "qandaydir qaysi qancha qachon bo'lsa bo'ladi bo'lgan emas kerak mumkin lekin ammo chunki "
    "agar yoki ham bir ikki uch bor yo'q va juda shuning shunday ushbu haqida qilib qilish "
    "qilaman bering tushuntiring tushuntirib ayting yozing ko'rsating tushuntir farq farqi "
    "orasidagi yordam maslahat keyin avval har vaqt soat kun hisoblang hisoblab shu bu "
    "natija natijani oddiy misol misollar tilida o'zbek o'zbekcha".split())


def is_uzbek(text: str) -> bool:
    normalized = re.sub('[‘’ʻʼ`ʹ]', "'", text.lower())
    tokens = re.findall(r"[a-z]+(?:'[a-z]+)*|[а-яёқғҳў]+", normalized)
    if not tokens:
        return False
    if re.search(r"(?:o'zbek|uzbek)\s+tilida|o'zbekcha\s+(?:javob|yozing|tushuntir)", normalized):
        return True  # Explicit requested answer language, not an incidental mention.
    hits = {token for token in tokens if token in _UZ_WORDS}
    latin = sum(bool(re.fullmatch(r"[a-z']+", token)) for token in tokens)
    if len(hits) >= 3 and sum(t in _UZ_WORDS for t in tokens) / len(tokens) >= .18 and latin / len(tokens) >= .7:
        return True
    # Cyrillic Uzbek: characteristic letters plus multiple grammatical markers.
    return (len(re.findall('[қғҳў]', normalized)) >= 2 and
            len(set(tokens) & {'учун', 'билан', 'қандай', 'нима', 'керак', 'мумкин', 'тушунтиринг', 'менга', 'эмас'}) >= 2)


def is_coding(text: str) -> bool:
    text = text.lower()
    if re.search(r'```(?:python|py|tsx?|jsx?|sql|dockerfile)|\b(?:traceback|typeerror|ts\d{4})\b', text):
        return True
    tech = re.search(r'\b(?:python|fastapi|react|typescript|javascript|sql|docker|nginx|pytest|useeffect|asyncio|tsx|api)\b', text)
    intent = re.search(r'\b(?:code|coding|debug|debugging|implement|function|component|compile|compiler|build|query|architecture|bug|fix|endpoint|hook|test|tests|snippet|strictmode)\b|код|функци|компонент|ошибк|исправ|реализ|архитектур|настрой|созда|напиши|kodi|kodni|dastur|xato|yozing|funksiya', text)
    return bool(tech and intent) or bool(re.search(r'\b(?:debugging|programming|software architecture|source code|write code)\b|программирован|отлад[кь]|(?:напиши|исправь|создай)\s+код|архитектур[аыу]\s+(?:приложения|сервиса|системы)', text))


def route(prompt: str, *, images: int, default_model: str, qwen_model: str, effort: str) -> dict:
    uzbek, coding = is_uzbek(prompt), is_coding(prompt)
    instructions = []
    if uzbek: instructions.append(UZBEK_INSTRUCTIONS)
    if coding: instructions.append(CODING_INSTRUCTIONS)
    if images: instructions.append(VISION_INSTRUCTIONS)
    # Public Beta keeps all text on the configured GPT-OSS model. The legacy
    # qwen_model argument remains for callers; it never selects a public route.
    result = {'model': default_model,
              'reasoning_effort': effort,
              'instructions': '\n'.join(instructions),
              'reason': 'vision' if images else 'coding' if coding else 'uzbek' if uzbek else 'default'}
    if images or coding: result['temperature'] = .3 if images else .6
    elif uzbek: result['temperature'] = .6
    return result
