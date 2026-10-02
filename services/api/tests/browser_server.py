"""Isolated browser-test server; slow only the explicit cancellation fixture."""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if os.environ.get('UVMS_AI_PROVIDER') != 'demo':
    raise RuntimeError('Browser fixtures require the demo provider')

from app import ai_gateway
from app.main import app
import uvicorn

original = ai_gateway._provider_stream_events

def paced_events(history, *args, **kwargs):
    pace = ai_gateway._last_user_text(history) == 'Cancel during visible streaming'
    for event in original(history, *args, **kwargs):
        if pace:
            time.sleep(0.1)
        yield event

ai_gateway._provider_stream_events = paced_events
if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]))
