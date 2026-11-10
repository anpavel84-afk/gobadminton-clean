// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenuePhotoCandidates } from "../src/components/VenuePhotoCandidates";
import type { Session } from "../src/lib/admin-client";

const venue = "a0000000-0000-4000-8000-000000000001";
const other = "a0000000-0000-4000-8000-000000000002";
const candidateId = "b0000000-0000-4000-8000-000000000001";
const root = `/v1/admin/venues/${venue}/photo-candidates`;
const candidate = {
  id:candidateId, venueId:venue, status:"awaiting_review", version:1, width:1200, height:400,
  evidence:{creditKind:"photo",creditText:"Фото: Клуб",creditUrl:"https://club.example/credit",sourceUrl:"https://club.example/source",sourceAuthor:"Клуб",permissionBasis:"Письменное разрешение клуба"},
  previewPath:`${root}/${candidateId}/content`,
};
const session: Session = {principalId:"synthetic-admin",userId:"synthetic-user",sessionId:"synthetic-session",status:"active",version:7,roles:["content_manager"],csrfToken:"synthetic-csrf",stepUpAt:"",expiresAt:"2099-01-01T00:00:00Z"};
const json = (value:unknown,status=200) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
const png = () => new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{"Content-Type":"image/png"}});
const receipt = (action:string) => ({...candidate,status:action === "accept" ? "accepted" : "rejected",version:2,previewPath:null});
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
const changed = vi.fn(async()=>{}), authorityLoss = vi.fn(), stepup = vi.fn(async()=>{}), onBusy = vi.fn();
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function setup(overrides:Partial<Parameters<typeof VenuePhotoCandidates>[0]> = {}) {
  let props = {id:venue,version:31,selection:1,session:{...session,stepUpAt:new Date().toISOString()},disabled:false,authorityBlocked:false,changed,authorityLoss,stepup,onBusy,canStart:()=>true,...overrides};
  const view=render(<VenuePhotoCandidates {...props}/>);
  return {...view, update(next:Partial<typeof props>){props={...props,...next};view.rerender(<VenuePhotoCandidates {...props}/>);}};
}
function pending() {
  fetchMock.mockResolvedValueOnce(json({items:[candidate]})).mockResolvedValueOnce(png());
}
async function ready() { await screen.findByRole("button",{name:"Принять фото"}); }
const posts = () => fetchMock.mock.calls.filter(([,init])=>init?.method === "POST");
beforeEach(()=>{
  vi.clearAllMocks();
  fetchMock=vi.fn<typeof fetch>();vi.stubGlobal("fetch",fetchMock);
  vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH","");
  vi.stubGlobal("URL",class extends URL {
    static override createObjectURL=vi.fn(()=>"blob:private-candidate");
    static override revokeObjectURL=vi.fn();
  });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("selected venue candidate review (synthetic source tests; no real Admin acceptance)",()=>{
  it("reads only the selected private queue/preview and renders real evidence as text/links",async()=>{
    pending();setup();await ready();
    expect(fetchMock.mock.calls.map(([path])=>path)).toEqual([root,candidate.previewPath]);
    for(const [,init] of fetchMock.mock.calls) expect(init).toMatchObject({credentials:"same-origin",cache:"no-store",redirect:"error"});
    expect(screen.getByRole("link",{name:"Кредит"}).getAttribute("href")).toBe(candidate.evidence.creditUrl);
    expect(screen.getByText(/Письменное разрешение клуба/)).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:private-candidate");
  });
  it("never fetches a supplied arbitrary preview or exposes unvalidated evidence",async()=>{
    fetchMock.mockResolvedValue(json({items:[{...candidate,previewPath:"https://evil.example/private"}]}));
    setup();await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button",{name:"Принять фото"})).toBeNull();
  });
  for(const action of ["accept","reject"] as const) it(`freezes exact ${action} packet and suppresses duplicate dispatch`,async()=>{
    pending();const response=deferred<Response>();fetchMock.mockReturnValueOnce(response.promise);
    fetchMock.mockResolvedValueOnce(json({items:[]}));setup();await ready();
    const button=screen.getByRole("button",{name:action === "accept" ? "Принять фото" : "Отклонить фото"});
    fireEvent.click(button);fireEvent.click(button);
    expect(posts()).toHaveLength(1);
    const [path,init]=posts()[0]!;
    expect(path).toBe(`${root}/${candidateId}/decision`);
    expect(JSON.parse(init!.body as string)).toEqual({action,expectedVersion:31,expectedCandidateVersion:1});
    expect(init!.headers).toMatchObject({"X-CSRF-Token":"synthetic-csrf","Idempotency-Key":expect.any(String)});
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-candidate");
    response.resolve(json(receipt(action)));
    await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
    await screen.findByText(action === "accept" ? /Фото принято в галерею/ : /Кандидат отклонён/);
    expect(posts()).toHaveLength(1);
  });
  it("keeps UNKNOWN and exact key/body across explicit reconciliation, including a later 404",async()=>{
    pending();fetchMock.mockRejectedValueOnce(new TypeError("response lost"));setup();await ready();
    fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));await screen.findByText(/UNKNOWN: результат/);
    expect(changed).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("button",{name:"Принять фото"})).toBeNull();
    fetchMock.mockResolvedValueOnce(json({code:"PHOTO_CANDIDATE_UNAVAILABLE"},404));
    fireEvent.click(screen.getByRole("button",{name:"Сверить исходное решение"}));await screen.findByText(/UNKNOWN: сверка недоступна/);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1]!.body).toBe(posts()[0]![1]!.body);
    expect(posts()[1]![1]!.headers).toEqual(posts()[0]![1]!.headers);
    expect(changed).not.toHaveBeenCalled();
  });
  it("requires actual step-up callback, then a separate explicit decision",async()=>{
    pending();const view=setup({session:{...session,stepUpAt:"2020-01-01"}});await ready();
    fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));await screen.findByText(/Перед решением подтвердите вход/);
    expect(posts()).toHaveLength(0);
    stepup.mockImplementationOnce(async()=>{view.update({session:{...session,stepUpAt:new Date().toISOString()}});});
    pending();fireEvent.click(screen.getByRole("button",{name:"Подтвердить вход для проверки фото"}));await ready();
    expect(stepup).toHaveBeenCalledTimes(1);expect(posts()).toHaveLength(0);
  });
  it("fences a deferred old selection queue even when fetch ignores abort",async()=>{
    const old=deferred<Response>();fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json({items:[]}));
    const view=setup();view.update({id:other,selection:2});await screen.findByText("Нет кандидатов на проверке.");
    old.resolve(json({items:[candidate]}));await Promise.resolve();await Promise.resolve();
    expect(screen.queryByRole("img")).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("fences an old session mutation and never treats its late receipt as confirmation",async()=>{
    pending();const old=deferred<Response>();fetchMock.mockReturnValueOnce(old.promise);
    const view=setup();await ready();fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));
    view.update({session:{...session,sessionId:"replacement",stepUpAt:new Date().toISOString()}});
    old.resolve(json(receipt("accept")));await screen.findByText(/прежний пакет сохранён/);
    expect(changed).not.toHaveBeenCalled();expect(screen.queryByText(/Фото принято в галерею/)).toBeNull();
    expect((screen.getByRole("button",{name:"Сверить исходное решение"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("revokes private URL on authority loss and rejects late preview after unmount",async()=>{
    pending();const view=setup();await ready();view.update({authorityBlocked:true});
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-candidate");expect(screen.queryByRole("img")).toBeNull();
    view.unmount();
    const late=deferred<Response>();fetchMock.mockResolvedValueOnce(json({items:[candidate]})).mockReturnValueOnce(late.promise);
    const next=setup();await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(4));next.unmount();
    late.resolve(png());await Promise.resolve();await Promise.resolve();expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it("reports a definite denied read through the real authority-loss callback",async()=>{
    fetchMock.mockResolvedValueOnce(json({code:"ADMIN_PERMISSION_DENIED"},403));setup();
    await screen.findByText(/Кандидат недоступен для текущего доступа/);expect(authorityLoss).toHaveBeenCalledTimes(1);
  });
  it("requires fresh venue/queue reads after capacity conflict before a new explicit decision",async()=>{
    pending();fetchMock.mockResolvedValueOnce(json({code:"VENUE_GALLERY_FULL"},409));const view=setup();await ready();
    fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));await screen.findByText(/VENUE_GALLERY_FULL/);
    expect(screen.queryByRole("button",{name:"Принять фото"})).toBeNull();
    changed.mockImplementationOnce(async()=>{view.update({version:32});});pending();
    fireEvent.click(screen.getByRole("button",{name:"Обновить площадку и очередь"}));await ready();
    expect(changed).toHaveBeenCalledTimes(1);expect(posts()).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json(receipt("reject"))).mockResolvedValueOnce(json({items:[]}));
    fireEvent.click(screen.getByRole("button",{name:"Отклонить фото"}));await waitFor(()=>expect(posts()).toHaveLength(2));
    expect(JSON.parse(posts()[1]![1]!.body as string).expectedVersion).toBe(32);
  });
  it("after a confirmed receipt retries only failed refresh reads",async()=>{
    pending();fetchMock.mockResolvedValueOnce(json(receipt("accept")));changed.mockRejectedValueOnce(new Error("detail read failed"));
    setup();await ready();fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));
    await screen.findByText(/Решение подтверждено. Обновление данных не завершено/);
    fetchMock.mockResolvedValueOnce(json({items:[]}));
    fireEvent.click(screen.getByRole("button",{name:"Обновить данные после решения"}));
    await waitFor(()=>expect(changed).toHaveBeenCalledTimes(2));expect(posts()).toHaveLength(1);
  });
  it("times out a mutation to UNKNOWN and fences its late successful receipt",async()=>{
    pending();const old=deferred<Response>();fetchMock.mockReturnValueOnce(old.promise);setup();await ready();
    vi.useFakeTimers();fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));
    await vi.advanceTimersByTimeAsync(20001);vi.useRealTimers();await screen.findByText(/UNKNOWN: результат/);
    old.resolve(json(receipt("accept")));await Promise.resolve();await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();expect(posts()).toHaveLength(1);
  });
});
