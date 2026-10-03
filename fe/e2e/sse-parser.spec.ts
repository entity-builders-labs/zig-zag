import { expect, test } from '@playwright/test';
import { SSEFrameParser } from '../api/sse-parser';

test.describe('SSEFrameParser', () => {
  test('keeps split chunks until the complete event arrives', () => {
    const parser = new SSEFrameParser();

    expect(parser.push('event: activity.media.updated\ndata: {"activity')).toEqual(
      [],
    );
    expect(parser.push('Id":"act-1"}\n\n')).toEqual([
      {
        event: 'activity.media.updated',
        data: '{"activityId":"act-1"}',
        id: undefined,
        retry: undefined,
      },
    ]);
  });

  test('supports CRLF, multiline data, comments, id and retry', () => {
    const parser = new SSEFrameParser();
    const frames = parser.push(
      ': keepalive\r\nid: 42\r\nretry: 3000\r\nevent: tour.progress\r\ndata: first\r\ndata: second\r\n\r\n',
    );

    expect(frames).toEqual([
      {
        event: 'tour.progress',
        data: 'first\nsecond',
        id: '42',
        retry: 3000,
      },
    ]);
  });

  test('emits several complete frames from one network chunk', () => {
    const parser = new SSEFrameParser();

    expect(
      parser.push(
        'event: connected\ndata: {}\n\nevent: heartbeat\ndata: {"ok":true}\n\n',
      ),
    ).toHaveLength(2);
  });
});
