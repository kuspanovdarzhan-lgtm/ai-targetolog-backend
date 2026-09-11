import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {db,initDb,findClientByCode} from '../lib/db.js';
import {requireAdmin,requireClient,TARIFF_LIMITS} from '../lib/auth.js';

test('personal account is seeded once and preserves revocation, usage and other data',async()=>{
  const original={data:db.data,read:db.read,write:db.write};
  db.data={clients:[{id:'existing',code:'legacy-fixture',active:true}],videoJobs:[{id:'video-fixture'}]};db.read=async()=>{};db.write=async()=>{};
  try {
    await initDb();const owner=db.data.clients.find(c=>c.id==='darzhan-personal');
    assert.ok(owner);assert.equal(owner.code,undefined);assert.equal(owner.tariff,'PRO');assert.equal(TARIFF_LIMITS[owner.tariff],40);
    assert.equal(findClientByCode('legacy-fixture').id,'existing');assert.equal(db.data.videoJobs.length,1);
    owner.active=false;owner.usageUnits=7;await initDb();assert.equal(owner.active,false);assert.equal(owner.usageUnits,7);assert.equal(db.data.clients.length,2);
  }finally{db.data=original.data;db.read=original.read;db.write=original.write;}
});

test('hashed access works through normal client auth, rejects wrong/revoked codes, grants no admin access',()=>{
  const previous=db.data;const oldKey=process.env.ADMIN_API_KEY;
  const code='unit-test-fixture-not-a-real-code';
  const client={id:'fixture',codeHash:crypto.createHash('sha256').update(code).digest('hex'),active:true};
  db.data={clients:[client]};
  try {
    assert.equal(findClientByCode(code),client);assert.equal(findClientByCode('wrong'),undefined);assert.equal(findClientByCode({}),undefined);
    let passed=false;const req={headers:{'x-client-code':code}};
    requireClient(req,{status(){throw new Error('unexpected rejection');}},()=>passed=true);assert.equal(passed,true);assert.equal(req.client,client);
    client.active=false;assert.equal(findClientByCode(code),undefined);
    delete process.env.ADMIN_API_KEY;let status;const res={status(s){status=s;return this;},json(){return this;}};
    requireAdmin({headers:{}},res,()=>assert.fail('admin access granted'));assert.equal(status,401);
  }finally{db.data=previous;if(oldKey===undefined)delete process.env.ADMIN_API_KEY;else process.env.ADMIN_API_KEY=oldKey;}
});
