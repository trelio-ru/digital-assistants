import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {buildHookPlugin} from '../scripts/build-plugin.mjs';


// Explicit native executable + exact read-only shared shell checkout. Never
// discover installed profiles, use an account/model, trust a hook, or import
// user configuration. CI pins the official executable independently below.
test('native Codex keeps hook hashes across main updates and detects executable hook changes',{
  skip:!process.env.TRELIO_TEST_CODEX_CLI||!process.env.TRELIO_TEST_SHARED_SHELL,
},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'assistant-native-hooks-'));
  // Windows may retain a just-closed native SQLite/directory handle briefly
  // after process exit. Retry only removal of this owned fixture, with a fixed
  // bound; discovery, installation and native requests are never repeated.
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const market=path.join(root,'market'),home=path.join(root,'home');
  await fs.mkdir(path.join(market,'.agents/plugins'),{recursive:true});await fs.mkdir(home);
  // Use the SAME real Git repository for main URL refs and the fixed hook
  // subdirectory ref. Local-source fixtures miss Codex's checkout-index writes
  // during main installation and falsely certify stable native fingerprints.
  const repository=path.join(root,'repository');await fs.mkdir(path.join(repository,'.codex-plugin'),{recursive:true});
  await buildHookPlugin({shellRepository:process.env.TRELIO_TEST_SHARED_SHELL,outputDirectory:path.join(repository,'plugin')});
  const mainManifest=path.join(repository,'.codex-plugin/plugin.json');
  await fs.writeFile(mainManifest,JSON.stringify({name:'trelio-digital-assistant',version:'0.1.0'}));
  await fs.writeFile(path.join(repository,'README.md'),'Synthetic main instructions one\n');
  await fs.writeFile(path.join(repository,'.gitattributes'),'* -text\n');
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{HOME:home,USERPROFILE:home,CODEX_HOME:home,LOCALAPPDATA:path.join(home,'local'),APPDATA:path.join(home,'roaming'),
    XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache')});
  // A real empty config file is required on Windows; os.devNull maps to a
  // device path Git cannot read as its global configuration. Never borrow a
  // maintainer identity, credential helper or executable Git hook.
  const gitConfig=path.join(root,'git-config'),gitHooks=path.join(root,'git-hooks');
  await fs.writeFile(gitConfig,'');await fs.mkdir(gitHooks);
  Object.assign(env,{GIT_CONFIG_GLOBAL:gitConfig,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'});
  const git=args=>{
    const result=spawnSync('git',['-c',`core.hooksPath=${gitHooks}`,...args],{env,cwd:repository,timeout:30_000,maxBuffer:1024*1024,windowsHide:true});
    assert.equal(result.error,undefined,'synthetic Git setup failed');assert.equal(result.status,0,'synthetic Git setup refused');
  };
  const commit=message=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm',message]);};
  git(['init','-q']);commit('First main and fixed hook payload');git(['tag','main-one']);git(['tag','fixed-hooks']);
  await fs.writeFile(mainManifest,JSON.stringify({name:'trelio-digital-assistant',version:'0.1.1'}));
  await fs.appendFile(path.join(repository,'README.md'),'Synthetic changed main instructions\n');
  commit('Second main only');git(['tag','main-two']);
  const catalogue={name:'assistant-discovery-fixture',plugins:[
    {name:'trelio-digital-assistant',source:{source:'url',url:pathToFileURL(repository).href,ref:'main-one'}},
    {name:'trelio-digital-assistant-hooks',source:{source:'git-subdir',url:pathToFileURL(repository).href,path:'./plugin',ref:'fixed-hooks'}}]};
  const catalogueFile=path.join(market,'.agents/plugins/marketplace.json');
  await fs.writeFile(catalogueFile,JSON.stringify(catalogue));
  const exe=process.env.TRELIO_TEST_CODEX_CLI;
  const native=args=>{
    const result=spawnSync(exe,args,{env,cwd:home,timeout:30_000,maxBuffer:1024*1024,windowsHide:true});
    assert.equal(result.error,undefined,'native fixture setup failed');assert.equal(result.status,0,'native fixture setup refused');
    return JSON.parse(result.stdout.toString());
  };
  native(['plugin','marketplace','add',market,'--json']);
  const install=name=>native(['plugin','add',`${name}@assistant-discovery-fixture`,'--json']);
  const installedHooks=install('trelio-digital-assistant-hooks');
  const component=JSON.parse(await fs.readFile(path.join(repository,'plugin','.codex-plugin/plugin.json'),'utf8'));
  assert.equal(path.resolve(installedHooks.installedPath),path.join(home,'plugins','cache','assistant-discovery-fixture','trelio-digital-assistant-hooks',component.version),
    'native git-subdir must preserve the exact versioned installation layout');
  await assert.rejects(fs.lstat(path.join(installedHooks.installedPath,'.git')),{code:'ENOENT'});
  const readHooks=async()=>{
  const child=spawn(exe,['app-server','--listen','stdio://'],{env,cwd:home,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  // `exit` precedes closure of the child's stdio handles. Keep the close promise
  // from spawn time, so cleanup cannot race their release on Windows.
  const closed=new Promise(resolve=>child.once('close',resolve));
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
      assert.equal(hook.pluginId,'trelio-digital-assistant-hooks@assistant-discovery-fixture');
      assert.equal(path.resolve(hook.sourcePath),path.resolve(installedHooks.installedPath,'hooks/hooks.json')); }
    return row.hooks.map(h=>({event:h.eventName,hash:h.currentHash})).sort((a,b)=>a.event.localeCompare(b.event));
  }finally{clearTimeout(timer);child.kill();await closed;}
  };
  const original=await readHooks();
  install('trelio-digital-assistant');
  assert.deepEqual(await readHooks(),original,'installing main from the SAME Git URL cannot alter hook hashes');
  catalogue.plugins[0].source.ref='main-two';await fs.writeFile(catalogueFile,JSON.stringify(catalogue));
  install('trelio-digital-assistant');
  assert.deepEqual(await readHooks(),original,'updating main version/ref/instructions must NOT change native hook trust hashes');
  await assert.rejects(fs.lstat(path.join(installedHooks.installedPath,'.git')),{code:'ENOENT'});
  // Mutate ONLY the isolated installed fixture. No trust record is written:
  // compare the real Codex hashes which a genuine approval is bound to.
  const hookFile=path.join(installedHooks.installedPath,'hooks','hooks.json');
  const hook=JSON.parse(await fs.readFile(hookFile,'utf8'));hook.hooks.PreToolUse[0].hooks[0].timeout++;
  await fs.writeFile(hookFile,JSON.stringify(hook));
  const changedHook=await readHooks();assert.notDeepEqual(changedHook,original,'changed hooks must still change native hashes');
  await fs.appendFile(path.join(installedHooks.installedPath,'scripts','trelio-host-runtime-loader.mjs'),'\n// synthetic changed executable dependency\n');
  assert.notDeepEqual(await readHooks(),changedHook,'changed loader bytes must still change native hashes');
  const config=await fs.readFile(path.join(home,'config.toml'),'utf8');
  assert.doesNotMatch(config,/trusted_hash|trusted_content_hash|bypass_hook_trust/);
  t.diagnostic('Native unchanged-main hash preservation and changed-hook/loader invalidation verified without approving any hook');
});
