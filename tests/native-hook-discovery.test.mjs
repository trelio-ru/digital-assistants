import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {buildPlugin} from '../scripts/build-plugin.mjs';


// Explicit native executable + exact read-only shared shell checkout. Never
// discover installed profiles, use an account/model, trust a hook, or import
// user configuration. CI pins the official executable independently below.
test('native Codex discovers the three untrusted hooks of the built package',{
  skip:!process.env.TRELIO_TEST_CODEX_CLI||!process.env.TRELIO_TEST_SHARED_SHELL,
},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'assistant-native-hooks-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const market=path.join(root,'market'),home=path.join(root,'home');
  await fs.mkdir(path.join(market,'.agents/plugins'),{recursive:true});await fs.mkdir(home);
  await buildPlugin({shellRepository:process.env.TRELIO_TEST_SHARED_SHELL,outputDirectory:path.join(market,'plugin')});
  await fs.writeFile(path.join(market,'.agents/plugins/marketplace.json'),JSON.stringify({name:'assistant-discovery-fixture',
    plugins:[{name:'trelio-digital-assistant',source:{source:'local',path:'./plugin'}}]}));
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{HOME:home,USERPROFILE:home,CODEX_HOME:home,LOCALAPPDATA:path.join(home,'local'),APPDATA:path.join(home,'roaming'),
    XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')});
  const exe=process.env.TRELIO_TEST_CODEX_CLI;
  for(const args of [['plugin','marketplace','add',market,'--json'],['plugin','add','trelio-digital-assistant@assistant-discovery-fixture','--json']]){
    const result=spawnSync(exe,args,{env,cwd:home,timeout:30_000,maxBuffer:1024*1024,windowsHide:true});
    assert.equal(result.error,undefined,'native fixture setup failed');assert.equal(result.status,0,'native fixture setup refused');
  }
  const child=spawn(exe,['app-server','--listen','stdio://'],{env,cwd:home,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  const waiting=new Map();let pending='',bytes=0,next=1;
  const failure=()=>{for(const call of waiting.values())call.reject(Error('Native hook inventory unavailable'));waiting.clear();child.kill();};
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=next++;waiting.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  child.on('error',failure);child.on('exit',failure);child.stdin.on('error',failure);child.stdout.on('error',failure);
  child.stdout.on('data',chunk=>{
    bytes+=chunk.length;pending+=chunk.toString();if(bytes>1024*1024)return failure();let n;
    while((n=pending.indexOf('\n'))>=0){let value;try{value=JSON.parse(pending.slice(0,n));}catch{return failure();}pending=pending.slice(n+1);
      const call=waiting.get(value.id);if(call){waiting.delete(value.id);value.error?call.reject(Error('Native read refused')):call.resolve(value.result);}}
  });
  const timer=setTimeout(failure,30_000);
  try{
    await request('initialize',{clientInfo:{name:'assistant_hook_discovery_fixture',version:'1.0.0'}});
    child.stdin.write('{"method":"initialized"}\n');
    const result=await request('hooks/list',{cwds:[home]});
    assert.equal(result.data.length,1);const row=result.data[0];
    assert.deepEqual(row.errors,[]);assert.deepEqual(row.warnings,[]);
    assert.deepEqual(row.hooks.map(h=>h.eventName).sort(),['preToolUse','sessionEnd','sessionStart']);
    for(const hook of row.hooks){assert.equal(hook.source,'plugin');assert.equal(hook.enabled,true);assert.equal(hook.isManaged,false);
      assert.equal(hook.trustStatus,'untrusted','discovery cannot silently approve installed hooks');
      assert.equal(hook.pluginId,'trelio-digital-assistant@assistant-discovery-fixture');}
    // Discovery alone never starts the runtime/MCP, grants a pass or trusts the
    // hook. The real Windows business pass remains a separate acceptance step.
    const config=await fs.readFile(path.join(home,'config.toml'),'utf8');
    assert.doesNotMatch(config,/trusted_hash/);
  }finally{clearTimeout(timer);child.kill();await new Promise(resolve=>child.exitCode===null&&child.signalCode===null?child.once('exit',resolve):resolve());}
});
