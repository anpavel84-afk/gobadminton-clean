// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenuePhotoCandidates } from "../src/components/VenuePhotoCandidates";
import type { Session } from "../src/lib/admin-client";
import { act } from "@testing-library/react";
import { AdminApp } from "../src/components/AdminApp";

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

describe("AdminApp navigation with an unresolved candidate decision",()=>{
  // Real AdminApp -> Venues -> candidate, including the section unmount boundary.
  // Only transport and browser scrolling are synthetic; no component or hook mocks.
  function adminHarness() {
    const selectedVenue = {
      id:venue,cityId:other,cityName:"Город",name:"Зал для проверки навигации",address:"Проверенный адрес",
      timezone:"Europe/Moscow",latitude:55.75,longitude:37.62,identityDiscriminator:"",
      lifecycleState:"unverified",canonicalVenueId:null,version:31,
    };
    const state = {
      session:{...session,stepUpAt:new Date().toISOString()},
      settled:false,
      nextAuthority:null as Promise<Response> | null,
    };
    const decision = vi.fn<(init:RequestInit)=>Promise<Response>>();
    decision.mockRejectedValueOnce(new TypeError("original response lost"));
    fetchMock.mockImplementation(async(input,init)=>{
      const path=String(input);
      if(path === "/v1/admin/auth/me") {
        if(state.nextAuthority) { const response=state.nextAuthority;state.nextAuthority=null;return response; }
        return json(state.session);
      }
      if(path === "/v1/admin/auth/logout") return new Response(null,{status:204});
      if(path === `${root}/${candidateId}/decision`) return decision(init!);
      if(path === root) return json({items:state.settled ? [] : [candidate]});
      if(path === candidate.previewPath) return png();
      if(path === `/v1/admin/venues/${venue}/gallery`) return json({version:state.settled ? 32 : 31,items:[]});
      if(path === `/v1/admin/venues/${venue}`) return json({...selectedVenue,version:state.settled ? 32 : 31});
      if(path.startsWith("/v1/admin/venues?")) return json({items:[selectedVenue],nextBeforeId:null});
      throw new Error(`Unexpected synthetic Admin request: ${path}`);
    });
    vi.stubGlobal("requestAnimationFrame",vi.fn(()=>0));
    render(<AdminApp/>);
    async function open() {
      fireEvent.click(await screen.findByRole("button",{name:"Площадки"}));
      fireEvent.click(await screen.findByRole("button",{name:/Зал для проверки навигации · Открыть/}));
      await ready();
      await waitFor(()=>expect((screen.getByRole("button",{name:"Принять фото"}) as HTMLButtonElement).disabled).toBe(false));
    }
    return {state,decision,open};
  }

  it("retains the mounted UNKNOWN packet across attempted switch/return and reconciles only its exact body/key",async()=>{
    const h=adminHarness();await h.open();
    const overview=screen.getByRole("button",{name:"Обзор"}) as HTMLButtonElement;
    const venues=screen.getByRole("button",{name:"Площадки"}) as HTMLButtonElement;
    const authorityReads=()=>fetchMock.mock.calls.filter(([path])=>path === "/v1/admin/auth/me").length;
    const before=authorityReads();
    // Both handlers run before React commits disabled navigation: the ref must guard it.
    act(()=>{
      fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));
      fireEvent.click(overview);
    });
    await screen.findByText(/UNKNOWN: результат/);
    expect(authorityReads()).toBe(before);
    const reconciliation=screen.getByRole("button",{name:"Сверить исходное решение"});
    const original=posts()[0]!;
    expect(overview.disabled).toBe(true);expect(venues.disabled).toBe(true);
    fireEvent.click(overview);fireEvent.click(venues);
    fireEvent.focus(window);
    await waitFor(()=>expect(authorityReads()).toBe(before+1));
    expect(screen.getByRole("button",{name:"Сверить исходное решение"})).toBe(reconciliation);
    expect(venues.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button",{name:"Принять фото"})).toBeNull();
    expect(posts()).toHaveLength(1);

    const response=deferred<Response>();h.decision.mockReturnValueOnce(response.promise);
    fireEvent.click(reconciliation);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![0]).toBe(original[0]);
    expect(posts()[1]![1]!.body).toBe(original[1]!.body);
    expect(posts()[1]![1]!.headers).toEqual(original[1]!.headers);
    expect(overview.disabled).toBe(true);
    h.state.settled=true;response.resolve(json(receipt("accept")));
    await screen.findByText(/Фото принято в галерею/);
    await waitFor(()=>expect(overview.disabled).toBe(false));
    fireEvent.click(overview);await screen.findByRole("heading",{name:"Ваш доступ"});
    fireEvent.click(venues);await screen.findByRole("button",{name:/Зал для проверки навигации · Открыть/});
    expect(posts()).toHaveLength(2);
  });

  it("guards a section transition already awaiting authority when the candidate starts sending",async()=>{
    const h=adminHarness();await h.open();
    const authority=deferred<Response>();h.state.nextAuthority=authority.promise;
    const overview=screen.getByRole("button",{name:"Обзор"}) as HTMLButtonElement;
    fireEvent.click(overview);
    fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));
    await screen.findByText(/UNKNOWN: результат/);
    authority.resolve(json(h.state.session));
    await waitFor(()=>expect((screen.getByRole("button",{name:"Выйти"}) as HTMLButtonElement).disabled).toBe(false));
    expect(overview.disabled).toBe(true);
    expect(screen.getByRole("button",{name:"Площадки"}).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button",{name:"Сверить исходное решение"})).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"Ваш доступ"})).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  for(const loss of ["logout","actor/role loss"] as const) it(`releases the navigation lock on ${loss} without replaying the old actor's packet`,async()=>{
    const h=adminHarness();await h.open();
    fireEvent.click(screen.getByRole("button",{name:"Принять фото"}));await screen.findByText(/UNKNOWN: результат/);
    const original=posts()[0]!;
    expect((screen.getByRole("button",{name:"Обзор"}) as HTMLButtonElement).disabled).toBe(true);
    if(loss === "logout") {
      expect((screen.getByRole("button",{name:"Выйти"}) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole("button",{name:"Выйти"}));
      await screen.findByRole("heading",{name:"Выберите способ входа"});
      expect((screen.getByRole("button",{name:"Войти через VK"}) as HTMLButtonElement).disabled).toBe(false);
    } else {
      h.state.session={...h.state.session,principalId:"replacement-admin",userId:"replacement-user",sessionId:"replacement-session",roles:["support"]};
      fireEvent.focus(window);
      await screen.findByText("replacement-admin");
      await waitFor(()=>{
        expect((screen.getByRole("button",{name:"Обзор"}) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole("button",{name:"Обращения"}) as HTMLButtonElement).disabled).toBe(false);
      });
      expect(screen.queryByRole("button",{name:"Площадки"})).toBeNull();
    }
    expect(screen.queryByRole("button",{name:"Сверить исходное решение"})).toBeNull();
    expect(fetchMock.mock.calls.filter(([path])=>path === original[0])).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-candidate");
  });
});
