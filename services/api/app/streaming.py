"""Explicit SSE iterator lifetime, including an ASGI disconnect during next()."""
import threading

import anyio
from starlette.responses import StreamingResponse


class ManagedIterator:
    def __init__(self, iterator, cancel):
        self.iterator = iterator
        self.cancel = cancel
        self.lock = threading.Lock()
        self.started = False
        self.finished = False
        self.closed = False

    def __aiter__(self):
        return self

    def _next(self):
        with self.lock:
            if self.closed: return None
            self.started = True
            part = next(self.iterator, None)
            if part is None: self.finished = True
            return part

    async def __anext__(self):
        part = await anyio.to_thread.run_sync(self._next, abandon_on_cancel=True)
        if part is None: raise StopAsyncIteration
        return part

    def _close(self):
        with self.lock:
            if self.closed: return
            self.closed = True
            # The first frame is metadata. Enter the generator's try/finally
            # even if the browser left before consuming that frame.
            if not self.started:
                next(self.iterator, None)
            self.iterator.close()

    async def aclose(self):
        if not self.finished: self.cancel()
        with anyio.CancelScope(shield=True):
            await anyio.to_thread.run_sync(self._close)


class ManagedStreamingResponse(StreamingResponse):
    def __init__(self, iterator, cancel, **kwargs):
        super().__init__(ManagedIterator(iterator, cancel), **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Do not defer database/provider cleanup to async-generator GC.
            await self.body_iterator.aclose()
