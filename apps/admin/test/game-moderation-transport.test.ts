import { afterEach,describe,expect,it,vi } from "vitest";
import { adminRequest,AdminError,errorMessage } from "../src/lib/admin-client";
describe('Admin game moderation client boundary',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('retries exact saved payload/key and keeps Admin-only CSRF/credentials on no-store request',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({moderation:{version:3}}),{status:200}));vi.stubGlobal('fetch',fetch);
    const body={action:'restore_moderation',expectedModerationVersion:2,reasonCode:'synthetic_review'},key='fixture-idempotency-key';
    for(let i=0;i<2;i++)await adminRequest('games/00000000-0000-4000-8000-000000000001/moderation/commands',body,'fixture-csrf',key);
    expect(fetch.mock.calls[0]![0]).toEqual(fetch.mock.calls[1]![0]);expect(fetch.mock.calls[0]![1].headers).toEqual(fetch.mock.calls[1]![1].headers);expect(fetch.mock.calls[0]![1].body).toEqual(fetch.mock.calls[1]![1].body);expect(fetch.mock.calls[0]![1]).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',headers:{'X-CSRF-Token':'fixture-csrf','Idempotency-Key':key},body:JSON.stringify(body)});
  });
  it('409 remains a terminal rejection with actionable reload/confirmation copy',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:'MODERATION_VERSION_CONFLICT'}),{status:409})));
    await expect(adminRequest('games/id/moderation/commands',{})).rejects.toMatchObject({code:'MODERATION_VERSION_CONFLICT',status:409});
    expect(errorMessage(new AdminError('MODERATION_VERSION_CONFLICT',409))).toContain('подтвердите действие заново');
  });
});
