import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { SupabaseVerifier } from '../auth';
import type { Config } from '../config';
let server:Server;let verifier:SupabaseVerifier;let seen='';
const id='f03eb9af-73c3-4a1b-abda-753c169265b2';
before(async()=>{
 server=createServer((req,res)=>{
   seen=req.headers.authorization||'';res.setHeader('content-type','application/json');
   if(req.url!=='/auth/v1/user'){res.statusCode=404;res.end('{}');return;}
   if(seen!=='Bearer accepted'){res.statusCode=401;res.end(JSON.stringify({message:'invalid token',error_code:'bad_jwt'}));return;}
   res.end(JSON.stringify({id,aud:'authenticated',role:'authenticated',user_metadata:{role:'ADMINISTRATOR',orgId:'untrusted'},app_metadata:{},created_at:new Date().toISOString()}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert(address&&typeof address==='object');
 verifier=new SupabaseVerifier({NODE_ENV:'test',HOST:'127.0.0.1',PORT:4000,WEB_ORIGIN:'http://localhost:3000',SUPABASE_URL:`http://127.0.0.1:${address.port}`,SUPABASE_PUBLISHABLE_KEY:'test-public-key'} as Config);
});
after(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
test('Supabase verifier calls the Auth user endpoint and returns only the verified UUID',async()=>{assert.equal(await verifier.verify('accepted'),id);assert.equal(seen,'Bearer accepted');});
test('Supabase rejects invalid tokens, including browser-forged role metadata',async()=>{await assert.rejects(verifier.verify('forged'),e=>(e as {status:number}).status===401);});
test('unconfigured authentication never admits a development user',async()=>{
 const unconfigured=new SupabaseVerifier({NODE_ENV:'test',HOST:'127.0.0.1',PORT:4000,WEB_ORIGIN:'http://localhost:3000'});
 await assert.rejects(unconfigured.verify('anything'),e=>(e as {status:number}).status===503);
});
