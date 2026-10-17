import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@prisma/client';
import { appModule, configure } from '../app';
import { VERIFIER } from '../auth';
import { REPOSITORY, type Principal, type Repository, type MachineRecord } from '../repository';
const config={NODE_ENV:'test' as const,HOST:'127.0.0.1',PORT:4000,WEB_ORIGIN:'http://localhost:3000'};
const user:Principal={userId:'f03eb9af-73c3-4a1b-abda-753c169265b2',membershipId:'m1',orgId:'org1',organization:'Supreme Industries',displayName:'Test operator',role:Role.OPERATOR};
const machine:MachineRecord={id:'machine1',code:'WH-C',name:'Blown-film line',manufacturer:'Windmöller & Hölscher',model:null,operationalStatus:'NOT_MONITORED',department:null,location:null,createdAt:new Date(),updatedAt:new Date()};
const repo:Repository={async principal(id){if(id==='inactive')return null;return {...user,...(id==='outsider'?{orgId:'org2'}:{}),...(id==='invalid-role'?{role:'EXTERNAL' as Role}:{})};},async machines(p){return p.orgId==='org1'?[machine]:[];},async machine(p,code){return p.orgId==='org1'&&code==='WH-C'?machine:null;}};
let app:INestApplication;
before(async()=>{const module=await Test.createTestingModule({imports:[appModule(config)]}).overrideProvider(VERIFIER).useValue({async verify(token:string){if(token==='expired')throw new UnauthorizedException('Session expired.');return token;}}).overrideProvider(REPOSITORY).useValue(repo).compile();app=module.createNestApplication();app.useLogger(false);configure(app,config);await app.init();});
after(async()=>{await app.close();});
test('health is public; unauthenticated and malformed bearer requests are rejected',async()=>{
 await request(app.getHttpServer()).get('/api/health/live').expect(200);
 for(const path of ['/api/me','/api/machines','/api/machines/WH-C'])await request(app.getHttpServer()).get(path).expect(401);
 await request(app.getHttpServer()).get('/api/me').set('Authorization','Bearer x y').expect(401);
 await request(app.getHttpServer()).get('/api/me').set('Authorization','Bearer expired').expect(401);
});
test('trusted membership determines identity, not browser role/organization headers',async()=>{
 const res=await request(app.getHttpServer()).get('/api/me').set('Authorization','Bearer operator').set('x-role','ADMINISTRATOR').set('x-org-id','org2').expect(200);
 assert.equal(res.body.role,'OPERATOR');assert.equal(res.body.orgId,'org1');
});
test('inactive memberships and roles outside the allowlist are denied',async()=>{
 for(const token of ['inactive','invalid-role'])await request(app.getHttpServer()).get('/api/machines').set('Authorization',`Bearer ${token}`).expect(403);
});
test('authorized user retrieves WH-C while another organization gets no records',async()=>{
 const result=await request(app.getHttpServer()).get('/api/machines/WH-C').set('Authorization','Bearer operator').expect(200);assert.equal(result.body.model,null);
 await request(app.getHttpServer()).get('/api/machines/WH-C').set('Authorization','Bearer outsider').expect(404);
 const list=await request(app.getHttpServer()).get('/api/machines').set('Authorization','Bearer outsider').expect(200);assert.deepEqual(list.body.items,[]);
});
test('invalid inputs receive useful errors and a safe request correlation ID',async()=>{
 for(const path of ['/api/machines?limit=0','/api/machines?limit=1.5','/api/machines?orgId=org2','/api/machines/invalid_code','/api/machines?after=invalid_code']){
  const res=await request(app.getHttpServer()).get(path).set('Authorization','Bearer operator').set('x-request-id','check-123').expect(400);assert.equal(res.body.requestId,'check-123');assert.equal(typeof res.body.message,'string');
 }
});
test('OpenAPI documents protected routes and readiness reports missing configuration honestly',async()=>{
 const spec=await request(app.getHttpServer()).get('/api/openapi.json').expect(200);assert(spec.body.paths['/api/machines/{code}'].get.security);
 const ready=await request(app.getHttpServer()).get('/api/health/ready').expect(503);assert.equal(ready.body.authentication,'unconfigured');
 const cors=await request(app.getHttpServer()).options('/api/machines').set('Origin','http://localhost:3000').set('Access-Control-Request-Method','GET').expect(204);assert.equal(cors.headers['access-control-allow-origin'],'http://localhost:3000');
});
