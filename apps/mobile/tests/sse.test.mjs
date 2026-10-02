import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeSse, parseSseBuffer } from '../src/sse.ts';

test('SSE parser keeps an incomplete frame and decodes multiline JSON', () => {
  const first = parseSseBuffer('event: meta\r\ndata: {"chat_id":"one"}\r\n\r\nevent: delta\ndata: {"delta":"');
  assert.deepEqual(first.frames, [{ event: 'meta', data: { chat_id: 'one' } }]);
  const second = parseSseBuffer(`${first.rest}hello"}\ndata: trailing\n\n`);
  assert.deepEqual(second.frames, [{ event: 'delta', data: '{"delta":"hello"}\ntrailing' }]);
  assert.equal(second.rest, '');
});

test('SSE consumer delivers a Unicode delta before the stream closes', async () => {
  const encoder = new TextEncoder();
  const first = encoder.encode('event: delta\ndata: {"delta":"Привет"}\n\n');
  const splitAt = first.indexOf(0xd0) + 1;
  const received = [];
  let firstDelivered = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(first.slice(0, splitAt));
      setTimeout(() => {
        controller.enqueue(first.slice(splitAt));
        setTimeout(() => {
          assert.equal(firstDelivered, true);
          controller.enqueue(encoder.encode('event: done\ndata: {"stopped":false}\n\n'));
          controller.close();
        }, 10);
      }, 10);
    },
  });

  await consumeSse(new Response(body), frame => {
    received.push(frame);
    if (frame.event === 'delta') firstDelivered = true;
  });
  assert.deepEqual(received, [
    { event: 'delta', data: { delta: 'Привет' } },
    { event: 'done', data: { stopped: false } },
  ]);
});
