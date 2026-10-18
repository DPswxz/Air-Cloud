const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProxyIdentity}=require('../portal/proxy-identity.cjs');
const request=(address,headers={},encrypted=false)=>({socket:{remoteAddress:address,encrypted},headers});

test('direct clients cannot spoof their address or HTTPS state',()=>{
  const identify=createProxyIdentity();
  assert.deepEqual(identify(request('::ffff:192.0.2.10',{'x-forwarded-for':'1.2.3.4','x-forwarded-proto':'https'})),{address:'192.0.2.10',protocol:'http'});
  assert.equal(identify(request('::1',{},true)).protocol,'https');
});
test('trusted proxy chains stop at the nearest untrusted hop',()=>{
  const identify=createProxyIdentity('10.0.0.0/24,::1');
  assert.deepEqual(identify(request('10.0.0.2',{'x-forwarded-for':'1.2.3.4, 192.0.2.10, 10.0.0.3','x-forwarded-proto':'https'})),{address:'192.0.2.10',protocol:'https'});
  assert.equal(identify(request('::1',{'x-forwarded-for':'::ffff:192.0.2.11'})).address,'192.0.2.11');
});
test('invalid proxy headers cannot become a client address or protocol',()=>{
  const identify=createProxyIdentity('10.0.0.0/24');
  assert.deepEqual(identify(request('10.0.0.2',{'x-forwarded-for':'1.2.3.4, invalid','x-forwarded-proto':'javascript'})),{address:'10.0.0.2',protocol:'http'});
  for(const value of ['all','10.0.0.0/33','::1/129','127.0.0.1/-1','127.0.0.1/8/9']) assert.throws(()=>createProxyIdentity(value));
});
