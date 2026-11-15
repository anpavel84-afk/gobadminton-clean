import { describe, expect, it, vi } from 'vitest';
import { ConsumerAuthService } from '../../src/auth/consumer-auth.service';
import { SESSION_COOKIE } from '../../src/auth/constants';
import { GeographicRadarController } from '../../src/radar/geographic.controller';
import { MeRadarController } from '../../src/radar/me-radar.controller';
import { UnifiedPlayersController } from '../../src/radar/unified.controller';
import { RadarPreviewController } from '../../src/radar/radar-preview.controller';
import { UNIFIED_WIRE } from '../../src/radar/unified-contract';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Exercise the selected handlers against real principal/Origin/CSRF resolution.
// Domain services stay owners of their own transaction/proof/privacy tests.
const origin = 'https://localhost:3001', validToken = 'a'.repeat(43);
function fixture() {
  const lookup = vi.fn(async (token: string) => { if (token !== validToken) throw Error('revoked or wrong audience'); return { userId: 'native-user', sessionId: 'native-session', audience: 'consumer_native', transport: 'bearer' }; });
  const auth = new ConsumerAuthService({ ALLOWED_WEB_ORIGINS: [origin] } as never,
    { lookupActiveSession: async (token: string) => token === 'cookie' ? { userId: 'web-user', id: 'web-session' } : null,
      verifyCsrf: async (_id: string, token: string) => token === 'csrf' } as never,
    { getUser: async () => ({ status: 'active' }) } as never, { lookup } as never);
  const service = { config: vi.fn(async () => ({})), query: vi.fn(async () => ({})), getStatus: vi.fn(async () => ({})), status: vi.fn(async () => null),
    command: vi.fn(async () => ({ statusCode: 200, body: {} })), stop: vi.fn(async () => ({ statusCode: 204 })), nearby: vi.fn(async () => ({})), preview: vi.fn(async () => ({})) };
  const keys = { requireKey: (v: unknown) => { if (v !== 'key') throw Error('key required'); return v; } };
  const geo = new GeographicRadarController(auth, service as never, keys as never), me = new MeRadarController(auth, service as never, service as never, keys as never);
  const unified = new UnifiedPlayersController(auth, service as never), preview = new RadarPreviewController(auth, service as never, keys as never);
  const reply = { status: vi.fn() } as unknown as FastifyReply;
  const handlers = [
    (r: FastifyRequest) => geo.config(r), (r: FastifyRequest) => me.current(r),
    (r: FastifyRequest) => me.start(r, reply), (r: FastifyRequest) => me.renew(r, reply),
    (r: FastifyRequest) => me.update(r, reply), (r: FastifyRequest) => me.heartbeat(r, reply),
    (r: FastifyRequest) => me.stop(r, reply), (r: FastifyRequest) => me.takeover(r, reply),
    (r: FastifyRequest) => unified.query(r), (r: FastifyRequest) => unified.map(r), (r: FastifyRequest) => preview.preview(r, reply),
  ];
  return { handlers, service, lookup, legacy: [(r: FastifyRequest) => geo.query(r), (r: FastifyRequest) => me.nearby(r)] };
}
const request = (headers: Record<string, unknown>, cookies: Record<string, string> = {}) => ({ headers: { 'idempotency-key': 'key', ...headers }, cookies, raw: { rawHeaders: [] }, body: { contractVersion: UNIFIED_WIRE }, query: {} }) as unknown as FastifyRequest;
describe('exact native Radar controller admission', () => {
  it('selected handlers pass the real native app-session identity through; no cookie or Origin fabricated', async () => {
    const f = fixture(); for (const handler of f.handlers) await handler(request({ authorization: `Bearer ${validToken}` }));
    expect(f.lookup).toHaveBeenCalledTimes(11);
    for (const method of ['config','query','getStatus','command','stop','preview'] as const) for (const call of f.service[method].mock.calls) expect(call.slice(0,2)).toEqual(['native-user','native-session']);
  });
  it('selected cookie reads and mutations preserve Origin and CSRF, and every malformed/mixed/refused principal fails before domain calls', async () => {
    for (let index=0;index<11;index++) {
      const f = fixture(), handler = f.handlers[index]!;
      await handler(request({ origin, 'x-csrf-token': 'csrf' }, { [SESSION_COOKIE]: 'cookie' }));
      if (index >= 2) {
        await expect(handler(request({ origin }, { [SESSION_COOKIE]: 'cookie' }))).rejects.toBeDefined();
        await expect(handler(request({ origin: 'https://evil.test', 'x-csrf-token': 'csrf' }, { [SESSION_COOKIE]: 'cookie' }))).rejects.toBeDefined();
      }
      for (const r of [request({}), request({ authorization:'Basic x' }), request({ authorization:`Bearer ${'b'.repeat(43)}` }), request({ authorization:`Bearer ${validToken}` }, { [SESSION_COOKIE]:'cookie' })]) await expect(handler(r)).rejects.toBeDefined();
    }
  });
  it('legacy geographic results and nearby still reject bearer rather than opting in globally', async () => {
    const f = fixture(); for (const handler of f.legacy) await expect(handler(request({ authorization:`Bearer ${validToken}` }))).rejects.toBeDefined();
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.service.query).not.toHaveBeenCalled(); expect(f.service.nearby).not.toHaveBeenCalled();
  });
});
