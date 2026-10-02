"""Run QA against disposable local data and demo providers only."""
import os
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp(prefix='uvms-regression-'))
os.environ['UVMS_DATABASE_URL'] = f"sqlite:///{(root / 'test.db').as_posix()}"
os.environ['UVMS_STORAGE_DIR'] = str(root / 'storage')
os.environ['OPENAI_API_KEY'] = ''
os.environ['OPENROUTER_API_KEY'] = ''
os.environ['GEMINI_API_KEY'] = ''
os.environ['GROQ_API_KEY'] = ''
for alias in ('FAST','BALANCED','DEEP'):
    os.environ['UVMS_MODEL_'+alias] = ''
os.environ['UVMS_AI_PROVIDER'] = 'demo'
os.environ['UVMS_PUBLIC_BETA'] = 'false'
os.environ['UVMS_SEARCH_ENABLED'] = 'true'
os.environ['UVMS_IMAGES_ENABLED'] = 'true'
os.environ['UVMS_VOICE_ENABLED'] = 'true'
os.environ['UVMS_BILLING_PROVIDER'] = 'demo'
os.environ['UVMS_PASSWORD_RESET_ENABLED'] = 'true'
os.environ['UVMS_REQUIRE_LIVE_AI'] = 'false'
os.environ['UVMS_SMTP_HOST'] = ''
os.environ['UVMS_ENV'] = 'development'
os.environ['UVMS_RATE_LIMIT_AUTH_PER_MINUTE'] = '1000'
