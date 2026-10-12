import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeMyAvatar, reconcileMyAvatar } from '../src/lib/api-client';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('avatar-specific request deadline',()=>{
  it('20s deadline settles even an unresolved fetch and aborts transport; retry uses caller version',async()=>{
    vi.useFakeTimers();const fetch=vi.fn().mockReturnValue(new Promise(()=>{}));vi.stubGlobal('fetch',fetch);vi.stubGlobal('window',{});
    const request=changeMyAvatar(new Blob(['derivative'],{type:'image/webp'}),7,'csrf');await vi.advanceTimersByTimeAsync(20000);expect(await request).toMatchObject({ok:false,status:0});expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    fetch.mockResolvedValue(new Response(JSON.stringify({version:8,avatar:{uploadedUrl:null,providerUrl:null}}),{status:200}));expect(await changeMyAvatar(null,7,'csrf')).toMatchObject({ok:true});expect(fetch.mock.calls[1]![1].headers.get('X-Profile-Version')).toBe('7');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('deadline covers response body stalls, parent abort and thrown fetch',async()=>{
    vi.useFakeTimers();const fetch=vi.fn().mockResolvedValue({ok:true,text:()=>new Promise(()=>{})});vi.stubGlobal('fetch',fetch);vi.stubGlobal('window',{});
    const request=changeMyAvatar(null,7,'csrf');await vi.advanceTimersByTimeAsync(20000);expect(await request).toMatchObject({ok:false,status:0});
    fetch.mockReturnValue(new Promise(()=>{}));const c=new AbortController();const aborted=changeMyAvatar(null,7,'csrf',c.signal);c.abort();expect(await aborted).toMatchObject({ok:false,status:0});
    fetch.mockRejectedValue(new Error('offline'));expect(await changeMyAvatar(null,7,'csrf')).toMatchObject({ok:false,status:0});
  });
  it('5s authoritative reconciliation is a read with no mutation/version/header reuse',async()=>{
    vi.useFakeTimers();const fetch=vi.fn().mockReturnValue(new Promise(()=>{}));vi.stubGlobal('fetch',fetch);vi.stubGlobal('window',{});
    const request=reconcileMyAvatar();await vi.advanceTimersByTimeAsync(5000);expect(await request).toMatchObject({ok:false,status:0});expect(fetch.mock.calls[0]![0]).toBe('/v1/me/social-profile');expect(fetch.mock.calls[0]![1].headers.has('X-Profile-Version')).toBe(false);
  });
});
