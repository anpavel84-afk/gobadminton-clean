import {afterEach,describe,expect,it,vi} from "vitest";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {AdminApp} from "../src/components/AdminApp";
import {visibleNavigation,canReadPilot} from "../src/lib/admin-client";
import {devQaKeyUiEnabled} from "../src/lib/server-config";
import {POST} from "../src/app/v1/admin/[...path]/route";
const dev={NODE_ENV:"production",APP_ENV:"mvp",ADMIN_INTERNAL_APP_ENABLED:"1",ADMIN_DEV_ENABLED:"1",ADMIN_DEV_PATH_ENABLED:"1",ADMIN_DEV_QA_KEY_ENABLED:"1",ADMIN_DEV_QA_VPS_VERIFIED:"1",PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",ADMIN_ORIGIN:"https://dev.gobadminton.ru",ADMIN_API_URL:"https://dev.gobadminton.ru"};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("QA-only Admin affordances and path gate",()=>{
 it("shows only overview/pilot for viewer; other staff scopes unchanged",()=>{
  expect(visibleNavigation(["pilot_viewer"]).map(v=>v.id)).toEqual(["overview","pilot"]);
  expect(canReadPilot(["pilot_viewer"])).toBe(true);expect(canReadPilot(["support"])).toBe(false);
  expect(visibleNavigation(["support"]).map(v=>v.id)).toEqual(["overview","cases"]);
 });
 it("server flag requires exact runtime DEV configuration",()=>{
  vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH","/admin");expect(devQaKeyUiEnabled(dev)).toBe(true);
  for(const patch of [{APP_ENV:"prod"},{ADMIN_DEV_QA_KEY_ENABLED:"0"},{ADMIN_DEV_QA_VPS_VERIFIED:"0"},{PUBLIC_WEB_ORIGIN:"https://gobadminton.ru"}])expect(devQaKeyUiEnabled({...dev,...patch})).toBe(false);
  // SSR only: authenticated interaction is checked separately in a real browser.
  expect(renderToStaticMarkup(React.createElement(AdminApp,{qaKeyEnabled:false}))).not.toContain('aria-label="Ключ QA"');
 });
 it("OFF blocks login before upstream; query key is never forwarded",async()=>{
  for(const[k,v]of Object.entries(dev))vi.stubEnv(k,v);vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH","/admin");
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  const ctx={params:Promise.resolve({path:["auth","dev-qa-key"]})};
  const request=()=>new Request("https://dev.gobadminton.ru/admin/v1/admin/auth/dev-qa-key?key=synthetic",{method:"POST"});
  expect((await POST(request(),ctx)).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
  vi.stubEnv("ADMIN_DEV_QA_KEY_ENABLED","0");expect((await POST(request(),ctx)).status).toBe(404);expect(fetch).not.toHaveBeenCalled();
 });
});
