import {describe,it,expect} from "vitest";
import {loadEnv,type AppEnv} from "../../src/config/env";
import {devQaKeyAllowed,qaSessionRouteAllowed} from "../../src/admin/dev-qa-policy";
describe("exact DEV QA isolation",()=>{
 const allowed={ADMIN_DEV_QA_KEY_ENABLED:true,ADMIN_DEV_QA_VPS_VERIFIED:true,ADMIN_INTERNAL_ENABLED:true,ADMIN_DEV_ENABLED:true,ADMIN_DEV_PATH_ENABLED:true,NODE_ENV:"production",APP_ENV:"mvp",PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru",PUBLIC_API_ORIGIN:"https://dev.gobadminton.ru",ADMIN_ORIGIN:"https://dev.gobadminton.ru",COOKIE_SECURE:true} as AppEnv;
 it("requires every exact flag/origin, fails closed despite a forced flag in PROD",()=>{
  expect(devQaKeyAllowed(allowed)).toBe(true);
  for(const patch of [{APP_ENV:"prod"},{NODE_ENV:"test"},{ADMIN_DEV_QA_KEY_ENABLED:false},{ADMIN_DEV_QA_VPS_VERIFIED:false},{ADMIN_DEV_PATH_ENABLED:false},{ADMIN_DEV_ENABLED:false},{ADMIN_INTERNAL_ENABLED:false},{ADMIN_ORIGIN:"https://gobadminton.ru"},{PUBLIC_WEB_ORIGIN:"https://gobadminton.ru"},{PUBLIC_API_ORIGIN:"https://gobadminton.ru"},{COOKIE_SECURE:false}])
   expect(devQaKeyAllowed({...allowed,...patch} as AppEnv)).toBe(false);
  expect(()=>loadEnv({NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:"postgres://test:test@127.0.0.1:5432/test",AUTH_PEPPER:"qa-local-test-not-a-live-pepper-0000",PUBLIC_WEB_ORIGIN:"http://localhost:3000",PUBLIC_API_ORIGIN:"http://localhost:3001",ADMIN_DEV_QA_KEY_ENABLED:"1"})).toThrow();
 });
 it("permits only pilot, own authority and logout",()=>{
  expect(qaSessionRouteAllowed("GET","/v1/admin/pilot-metrics?cityId=x")).toBe(true);
  expect(qaSessionRouteAllowed("GET","/v1/admin/auth/me")).toBe(true);
  expect(qaSessionRouteAllowed("POST","/v1/admin/auth/logout")).toBe(true);
  for(const path of ["/v1/admin/venues","/v1/admin/games","/v1/admin/auth/webauthn/options","/v1/admin/auth/vk/start","/v1/admin/identity/commands","/v1/admin/pilot-metrics/extra"])
   for(const method of ["GET","POST"])expect(qaSessionRouteAllowed(method,path)).toBe(false);
  expect(qaSessionRouteAllowed("POST","/v1/admin/pilot-metrics")).toBe(false);
 });
});
