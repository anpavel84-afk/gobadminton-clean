import assert from 'node:assert/strict';
import { internalConfig } from 'SERVER_MODULE';
import { adminPath } from 'CLIENT_MODULE';
import { GET, POST } from './proxy.ts';
const main='https://dev.gobadminton.ru';
const dev={ADMIN_INTERNAL_APP_ENABLED:'1',ADMIN_DEV_ENABLED:'1',ADMIN_DEV_PATH_ENABLED:'1',NODE_ENV:'production',APP_ENV:'stage',PUBLIC_WEB_ORIGIN:main,ADMIN_ORIGIN:main,ADMIN_API_URL:main};
for(const flag of ['0','1']) {
  process.env.ADMIN_DEV_PATH_BUILD=flag;
  const {default:config}=await import('./config.ts?flag='+flag);
  const prefix=flag==='1'?'/admin':'';
  assert.equal(config.basePath,prefix);
  assert.equal(config.skipTrailingSlashRedirect,flag==='1');
  assert.equal(config.env.NEXT_PUBLIC_ADMIN_BASE_PATH,prefix);
  process.env.NEXT_PUBLIC_ADMIN_BASE_PATH=prefix;
  assert.equal(adminPath('/internal/auth-ticket'),prefix+'/internal/auth-ticket');
}
process.env.ADMIN_DEV_PATH_BUILD='true';
await assert.rejects(import('./config.ts?invalid'),/Invalid Admin path build opt-in/);
assert.deepEqual(internalConfig(dev),{origin:main,api:main,basePath:'/admin'});
for(const bad of [{APP_ENV:'prod'},{APP_ENV:'local'},{NODE_ENV:'test'},{ADMIN_DEV_ENABLED:'0'},
  {ADMIN_INTERNAL_APP_ENABLED:'0'},{ADMIN_DEV_PATH_ENABLED:'0'},{ADMIN_DEV_PATH_ENABLED:'true'},
  {ADMIN_ORIGIN:main+'/admin'},{ADMIN_ORIGIN:main+'?q'},{ADMIN_ORIGIN:main+'#x'},
  {ADMIN_ORIGIN:'https://user@dev.gobadminton.ru'},{ADMIN_ORIGIN:main+'.evil.test'},
  {ADMIN_API_URL:'https://dev-api.gobadminton.ru'},{ADMIN_TEST_ORIGIN:'http://localhost'}])
  assert.equal(internalConfig({...dev,...bad}),null,JSON.stringify(bad));
process.env.NEXT_PUBLIC_ADMIN_BASE_PATH='';
assert.equal(internalConfig(dev),null);
assert.deepEqual(internalConfig({...dev,ADMIN_DEV_PATH_ENABLED:'0',ADMIN_ORIGIN:'https://dev-admin.gobadminton.ru'}),{origin:'https://dev-admin.gobadminton.ru',api:main});
process.env.NEXT_PUBLIC_ADMIN_BASE_PATH='/admin';
Object.assign(process.env,dev);
const ctx=path=>({params:Promise.resolve({path:path.split('/')})});
let calls=0;
globalThis.fetch=async (url,options)=>{
  calls++;
  assert.equal(url.href,main+'/v1/admin/auth/me');
  assert.equal(options.headers.get('origin'),main);
  assert.equal(options.headers.get('cookie'),'');
  assert.equal(options.headers.has('authorization'),false);
  return Response.json({code:'ADMIN_SESSION_REQUIRED'},{status:401});
};
const headers={host:"dev.gobadminton.ru","x-forwarded-host":"dev.gobadminton.ru","x-forwarded-proto":"https",origin:main,cookie:'__Host-gb_session=consumer',authorization:'Bearer consumer'};
assert.equal((await GET(new Request(main+'/admin/v1/admin/auth/me',{headers}),ctx('auth/me'))).status,401);
assert.equal((await GET(new Request(main+'/v1/admin/auth/me',{headers}),ctx('auth/me'))).status,404);
assert.equal((await POST(new Request(main+'/admin/v1/admin/auth/logout',{method:'POST',headers:{host:"dev.gobadminton.ru","x-forwarded-host":"dev.gobadminton.ru","x-forwarded-proto":"https",origin:'https://evil.test'}}),ctx('auth/logout'))).status,403);
assert.equal(calls,1);
// Actual observed standalone URL: stripped basePath, fixed HTTPS bind authority.
const internal='https://0.0.0.0:3010/v1/admin/auth/me';
assert.equal((await GET(new Request(internal,{headers}),ctx('auth/me'))).status,401);
for(const [key,value] of [['host','evil.test'],['x-forwarded-host','evil.test'],['x-forwarded-proto','http']]) {
 const forged={...headers,[key]:value};
 assert.equal((await GET(new Request(internal,{headers:forged}),ctx('auth/me'))).status,403);
 delete forged[key];
 assert.equal((await GET(new Request(internal,{headers:forged}),ctx('auth/me'))).status,403);
}
for(const url of ['https://0.0.0.0:3011/v1/admin/auth/me','http://0.0.0.0:3010/v1/admin/auth/me',
 'https://127.0.0.1:3010/v1/admin/auth/me'])
 assert.equal((await GET(new Request(url,{headers}),ctx('auth/me'))).status,404);
assert.equal(calls,2);

for(const provider of ['vk','yandex']) {
 globalThis.fetch=async (url,options)=>{
  assert.equal(url.pathname,`/v1/admin/auth/${provider}/callback`);
  assert.equal(url.searchParams.get('code'),'private');
  assert.equal(url.searchParams.has('activation'),false);
  assert.equal(options.headers.get('cookie'),'__Host-gb_admin_binding=bound');
  return Response.json({csrfToken:'secret',principalId:'fixture',status:'pending_mfa'});
 };
 const response=await GET(new Request(main+`/admin/v1/admin/auth/${provider}/callback?state=s&code=private&activation=never`,{headers:{host:"dev.gobadminton.ru","x-forwarded-host":"dev.gobadminton.ru","x-forwarded-proto":"https",cookie:'__Host-gb_admin_binding=bound; __Host-gb_session=consumer'}}),ctx(`auth/${provider}/callback`));
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),main+'/admin/?auth=complete');
 assert.match(response.headers.getSetCookie().join(';'),/Path=\/;.*Secure; HttpOnly; SameSite=Strict/);
}
console.log('Actual Next config / runtime fence / proxy / guest / callback checks passed');
