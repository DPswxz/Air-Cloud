'use strict';
const {BlockList,isIP}=require('node:net');

function normalize(address='') {
  return address.startsWith('::ffff:') && isIP(address.slice(7))===4 ? address.slice(7) : address;
}

function createProxyIdentity(value='') {
  const allowed=new BlockList();
  for(const entry of value.split(',').map(s=>s.trim()).filter(Boolean)) {
    const [address,prefix,...extra]=entry.split('/');
    const family=isIP(address);
    if(!family || extra.length || (prefix!==undefined && (!/^\d+$/.test(prefix) || +prefix>(family===4?32:128)))) {
      throw Error('Invalid NAS_TRUSTED_PROXIES entry: '+entry);
    }
    if(prefix===undefined) allowed.addAddress(address,family===4?'ipv4':'ipv6');
    else allowed.addSubnet(address,+prefix,family===4?'ipv4':'ipv6');
  }
  function trusted(address) {
    address=normalize(address);
    const family=isIP(address);
    return !!family && allowed.check(address,family===4?'ipv4':'ipv6');
  }
  return req=>{
    let address=normalize(req.socket.remoteAddress);
    let protocol=req.socket.encrypted?'https':'http';
    if(trusted(address)) {
      // Walk from our peer toward the client, stopping at the first untrusted hop.
      const chain=String(req.headers['x-forwarded-for']||'').split(',').map(s=>normalize(s.trim()));
      for(let i=chain.length-1;i>=0&&trusted(address);i--) {
        if(!isIP(chain[i])) break;
        address=chain[i];
      }
      if(['http','https'].includes(req.headers['x-forwarded-proto'])) protocol=req.headers['x-forwarded-proto'];
    }
    return {address,protocol};
  };
}
module.exports={createProxyIdentity};
