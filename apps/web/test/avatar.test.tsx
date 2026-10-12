import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, PlayerCard } from "../src/components/consumer/players/ProfileComposition";
import { InboxRow } from "../src/components/consumer/messages/MessageComposition";
import { RadarCanvas } from "../src/components/consumer/radar/RadarComposition";
import { AvatarEditor } from "../src/components/consumer/players/AvatarEditor";
import { changeMyAvatar } from "../src/lib/api-client";
import { inboxRow } from "../src/lib/inbox-presentation";
import type { InboxItem } from "../src/lib/messaging-types";
const avatar = {uploadedUrl:'/v1/media/avatars/'+ 'a'.repeat(64)+'.png', providerUrl:'https://avatars.yandex.net/test'};
afterEach(()=>vi.unstubAllGlobals());
describe('owned avatars',()=>{
  it('upload wins, absent upload uses provider, absent fields use initials',()=>{
    expect(renderToStaticMarkup(<Avatar name="Иван Иванов" avatar={avatar}/>)).toContain(avatar.uploadedUrl);
    expect(renderToStaticMarkup(<Avatar name="Иван Иванов" avatar={{...avatar,uploadedUrl:null}}/>)).toContain(avatar.providerUrl);
    const initials=renderToStaticMarkup(<Avatar name="Иван Иванов"/>);expect(initials).toContain('ИИ');expect(initials).not.toContain('<img');
  });
  it('directory and inbox propagate the authorized player projection',()=>{
    const html=renderToStaticMarkup(<PlayerCard player={{publicPlayerId:'p',displayName:'Иван',avatar,cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:false}}/>);expect(html).toContain(avatar.uploadedUrl);
    expect(inboxRow({id:'i',kind:'dm',conversationId:'c',peer:{publicPlayerId:'p',displayName:'Иван',avatar}} as InboxItem)?.avatar).toEqual(avatar);
    expect(renderToStaticMarkup(<InboxRow name="Иван" avatar={avatar} preview="Сообщение" time="2026-10-06T00:00:00Z" kind="dm" selected={false} href="/messages?conversation=c"/>)).toContain(avatar.uploadedUrl);
    expect(renderToStaticMarkup(<RadarCanvas items={[{resultId:'r',resultRef:'ref',displaySlot:1,proximityBand:'near',player:{publicPlayerId:'p',displayName:'Иван',avatar,level:null,trainer:false}}]} selected={null} onSelect={()=>{}} active/>)).toContain(avatar.uploadedUrl);
  });
  it('accessible chooser allows library/camera and controls cannot submit profile form',()=>{
    const html=renderToStaticMarkup(<AvatarEditor name="Иван" avatar={avatar} version={2} csrfToken="csrf" disabled={false} onBusy={()=>{}} onChange={()=>{}} onFailure={()=>{}}/>);
    expect(html).toContain('type="file"');expect(html).toContain('accept="image/jpeg,image/png,image/webp"');expect(html).toContain('aria-label="Выбрать или сделать фото профиля"');expect(html).not.toContain('type="submit"');expect(html).not.toContain('capture=');expect(html).toContain('Удалить фото');
  });
  it('sends raw bytes and expected profile version with CSRF; no automatic write retry',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({version:3,avatar}),{status:200}));vi.stubGlobal('fetch',fetch);vi.stubGlobal('window',{});
    const file=new File(['pixels'],'../../evil.png',{type:'image/png'});await changeMyAvatar(file,2,'csrf');
    const [url,init]=fetch.mock.calls[0]!;expect(url).toBe('/v1/me/avatar');expect(init.body).toBe(file);expect(init.headers.get('X-Profile-Version')).toBe('2');expect(init.headers.get('X-CSRF-Token')).toBe('csrf');expect(init.headers.get('Content-Type')).toBe('image/png');expect(init.credentials).toBe('include');
    fetch.mockRejectedValueOnce(new Error('offline'));const result=await changeMyAvatar(null,3,'csrf');expect(result.ok).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1]![1].method).toBe('DELETE');
  });
});
