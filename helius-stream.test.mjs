import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { HeliusStream, accountFingerprint, summarizeComparison } from './helius-stream.mjs';

test('account identity includes account data and excludes context slot', () => {
  const a = { lamports: 42, owner: 'owner', executable: false, data: ['AA==','base64'] };
  assert.equal(accountFingerprint(a), accountFingerprint({...a}));
  assert.notEqual(accountFingerprint(a), accountFingerprint({...a,data:['AQ==','base64']}));
  assert.equal(accountFingerprint(null), 'missing');
});
test('comparison pairs identical states and retains both directions and skipped states', () => {
  const s = summarizeComparison([{source:'websocket',hash:'a',ms:10,slot:1},{source:'websocket',hash:'a',ms:11,slot:1},
    {source:'http',hash:'a',ms:30,slot:5},{source:'http',hash:'b',ms:50,slot:6},{source:'websocket',hash:'b',ms:55,slot:6},
    {source:'websocket',hash:'c',ms:60,slot:7},{source:'http',hash:'d',ms:70,slot:8}]);
  assert.equal(s.matchedStates,2);assert.equal(s.websocketOnlyStates,1);assert.equal(s.httpOnlyStates,1);
  assert.equal(s.websocketFirstPairs,1);assert.equal(s.httpFirstPairs,1);assert.equal(s.pairs[1].httpMinusWebsocketMs,-5);
  assert.equal(summarizeComparison([]).medianHttpMinusWebsocketMs,null);
});
test('real local WebSocket server: ack, notification, reconnect and subscription restoration', async t => {
  const server = new WebSocketServer({port:0}); await once(server,'listening');
  t.after(()=>server.close()); let connections=0, ready=0, notifications=0;
  server.on('connection', ws => { connections++; ws.on('message', raw => {
    const request = JSON.parse(raw);ws.send(JSON.stringify({jsonrpc:'2.0',id:request.id,result:connections}));
    ws.send(JSON.stringify({jsonrpc:'2.0',method:'accountNotification',params:{subscription:connections,result:{context:{slot:connections},value:null}}}));
  }); });
  let resolveDone;const done=new Promise(resolve=>resolveDone=resolve);
  const stream = new HeliusStream('never-log-this-key',[{name:'account',method:'accountSubscribe',params:['address']}],event=>{
    if(event.type==='ready'){ready++;if(ready===1)stream.disconnect();}
    if(event.type==='notification'){notifications++;if(ready>=2)resolveDone();}
  },{url:`ws://127.0.0.1:${server.address().port}`,retryMs:5,heartbeatMs:20}).start();
  t.after(()=>stream.stop());let timeout;
  try {await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('reconnection timed out')),3000);})]);}
  finally {clearTimeout(timeout);stream.stop();}
  assert.ok(connections>=2);assert.equal(ready,2);assert.ok(notifications>=1);assert.equal(stream.stats.reconnects,1);
});
test('subscription errors fail closed instead of pretending the stream is ready',async t=>{
  const server=new WebSocketServer({port:0});await once(server,'listening');t.after(()=>server.close());
  server.on('connection',ws=>ws.on('message',raw=>ws.send(JSON.stringify({id:JSON.parse(raw).id,error:{code:-32602}}))));
  let resolveDone;const done=new Promise(resolve=>resolveDone=resolve);const events=[];
  const stream=new HeliusStream('key',[{name:'bad',method:'bad',params:[]}],e=>{events.push(e.type);if(e.type==='fatal')resolveDone();},
    {url:`ws://127.0.0.1:${server.address().port}`,retryMs:5}).start();t.after(()=>stream.stop());
  let timeout;try{await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('fatal timed out')),3000);})]);}finally{clearTimeout(timeout);stream.stop();}
  assert.ok(events.includes('subscription-rejected'));assert.equal(events.includes('ready'),false);assert.equal(stream.stats.reconnects,0);
});

test('replacement requires finalized unspent expiry and exact unchanged native and USDC balances', async () => {
  const { canReplaceExpired } = await import('./stream-trade.mjs');
  const prior={before:{usdcBaseUnits:'3000000',solLamports:4000000}};
  const expired={state:'expired-or-unobserved'}, invalid={value:false}, wallet={...prior.before};
  assert.equal(canReplaceExpired(prior,expired,invalid,null,wallet),true);
  assert.equal(canReplaceExpired(prior,{state:'unknown'},invalid,null,wallet),false);
  assert.equal(canReplaceExpired(prior,{state:'finalized'},invalid,null,wallet),false);
  assert.equal(canReplaceExpired(prior,expired,{value:true},null,wallet),false);
  assert.equal(canReplaceExpired(prior,expired,invalid,{meta:{}},wallet),false);
  assert.equal(canReplaceExpired(prior,expired,invalid,null,{...wallet,usdcBaseUnits:'2000000'}),false);
  assert.equal(canReplaceExpired(prior,expired,invalid,null,{...wallet,solLamports:3995000}),false);
});
