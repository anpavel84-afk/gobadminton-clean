import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const api=JSON.parse(readFileSync(new URL("../openapi.json",import.meta.url),"utf8"));
// Admin identity proofs deliberately burn challenges; they are not repeatable
// business commands. This bounded check does not suppress foundation findings.
const proofs=new Set(["/admin/auth/{provider}/start","/admin/auth/webauthn/options","/admin/auth/webauthn/verify"]);
let operations=0;
for(const [path,item] of Object.entries(api.paths)) {
 if(!path.startsWith("/admin/"))continue;
 for(const [method,op] of Object.entries(item)) {
  if(!["get","post","patch","put","delete"].includes(method))continue;
  operations++;
  const parameters=(op.parameters??[]).map(p=>p.$ref?p.$ref.split('/').slice(1).reduce((v,k)=>v[k],api):p);
  const headers=Object.fromEntries(parameters.filter(p=>p.in==='header').map(p=>[p.name.toLowerCase(),p]));
  assert.equal(op['x-client-surface'],'admin-only',path);
  assert(!JSON.stringify(op.security??[]).includes('Consumer'),path);
  if(method==='post' && proofs.has(path)) {
   assert.equal(op['x-auth-challenge-protocol'],'admin-bound-single-use-v1',path);
   assert.equal(headers.origin?.required,true,path);
   assert.notEqual(headers['idempotency-key']?.required,true,path);
   if(!path.endsWith('/start'))assert.equal(headers['x-csrf-token']?.required,true,path);
  } else if(method==='post') {
   assert.equal(headers['idempotency-key']?.required,true,path);
   assert.equal(headers['x-csrf-token']?.required,true,path);
   assert.deepEqual(op.security,[{AdminSessionCookie:[]}],path);
  }
 }
}
assert.equal(operations,28,"Update this inventory deliberately when adding an Admin operation");
for(const path of proofs) assert(api.paths[path]?.post, `Missing proof ceremony ${path}`);
console.log(`ADMIN PROTOCOL CHECK: PASS (${operations} operations; three bound single-use proof ceremonies)`);
