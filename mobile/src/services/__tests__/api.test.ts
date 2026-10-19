import { Api, ApiError, NetworkError } from '../api';

/** Answers every request with this status and raw body. */
function serve(status: number, body: string) {
  global.fetch = jest.fn(async () => new Response(body, { status })) as typeof fetch;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

// The private transport, on a route that needs no token.
const api = new Api('https://api.test') as unknown as { request(path: string, init: object): Promise<unknown> };
const call = () => api.request('/health', { auth: false }).catch((e: unknown) => e);

describe('Api responses', () => {
  it('parses JSON answers and API errors', async () => {
    serve(200, '{"ok":true}');
    await expect(call()).resolves.toEqual({ ok: true });
    serve(409, '{"error":"username_taken"}');
    await expect(call()).resolves.toMatchObject({ status: 409, code: 'username_taken' });
  });

  it('treats a non-JSON answer from in between as a network problem, not a crash', async () => {
    // What the platform proxy sends during a cold start or an outage.
    serve(503, 'upstream connect error or disconnect/reset before headers');
    expect(await call()).toBeInstanceOf(NetworkError);
    serve(200, 'upstream request timeout');
    expect(await call()).toBeInstanceOf(NetworkError);
    // A non-JSON 4xx is still an error answer.
    serve(404, '<html>Not Found</html>');
    const e = await call();
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, code: 'http_404' });
  });
});
