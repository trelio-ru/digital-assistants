import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPlugin, buildHookPlugin, HOOK_PLUGIN_NAME, SHELL_FILES, preparePluginDistribution, publishPluginDistribution, prepareHookDependency, publishHookDependency } from '../scripts/build-plugin.mjs';
import { get_encoding } from 'tiktoken';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'plugins/trelio-digital-assistant');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-package-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'shell');
  const prefix = 'plugins/trelio-agent-workspaces/scripts';
  await fs.mkdir(path.join(repository, prefix), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  for (const name of SHELL_FILES) {
    const contents = name === 'trelio-host-runtime-shell.mjs'
      ? 'export const PLUGIN_VERSION = "3.2.3";\n'
      : `// pinned ${name}\n`;
    const destination = path.join(repository, prefix, name);
    await fs.writeFile(destination, contents, { mode: name === 'launch-trelio-node' ? 0o755 : 0o644 });
  }
  git('add', '.');
  // NTFS does not expose POSIX executable bits; record the same reviewed Git
  // mode as the real pinned shell independently of the fixture host OS.
  git('update-index', '--chmod=+x', `${prefix}/launch-trelio-node`);
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture shell');
  const lock = JSON.parse(await fs.readFile(path.join(ROOT, 'shared-shell.lock.json')));
  lock.revision = git('rev-parse', 'HEAD');
  const lockPath = path.join(directory, 'lock.json');
  await fs.writeFile(lockPath, JSON.stringify(lock));
  return { directory, repository, prefix, lock, lockPath, git,
    options: (name, extra = {}) => ({ shellRepository: repository, lockPath, hookLockPath: lockPath,
      outputDirectory: path.join(directory, name), ...extra }) };
}

test('two builds preserve pinned bytes/modes and ignore a dirty shell checkout', async (t) => {
  const f = await fixture(t);
  const first = await buildPlugin(f.options('first'));
  // This local file is deliberately malicious; it must never enter the package.
  await fs.writeFile(path.join(f.repository, f.prefix, 'trelio-host-runtime-loader.mjs'), 'throw new Error("dirty");');
  await fs.writeFile(path.join(f.repository, f.prefix, 'credential.txt'), 'untracked fixture');
  const second = await buildPlugin(f.options('second'));
  assert.deepEqual(second, first);
  for (const entry of first.files) {
    const bytes = await fs.readFile(path.join(f.directory, 'first', entry.path));
    assert.equal(sha256(bytes), entry.sha256);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'second', entry.path)), bytes);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(path.join(f.directory, 'first', entry.path))).mode & 0o777, entry.mode);
    }
  }
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'first/package-integrity.json')),
    await fs.readFile(path.join(f.directory, 'second/package-integrity.json')));
});

test('existing output and its contents survive a failed build', async (t) => {
  const f = await fixture(t);
  const outputDirectory = path.join(f.directory, 'existing');
  await fs.mkdir(outputDirectory);
  await fs.writeFile(path.join(outputDirectory, 'keep'), 'keep');
  await assert.rejects(buildPlugin(f.options('existing')), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(outputDirectory, 'keep'), 'utf8'), 'keep');
});

test('source symlinks and unexpected files fail before output is created', async (t) => {
  const f = await fixture(t);
  const sourceDirectory = path.join(f.directory, 'source');
  await fs.cp(SOURCE, sourceDirectory, { recursive: true });
  const setup = path.join(sourceDirectory, 'skills/assistant-setup/SKILL.md');
  await fs.rm(setup);
  await fs.symlink(path.join(SOURCE, 'skills/assistant-setup/SKILL.md'), setup);
  await assert.rejects(buildPlugin(f.options('symlink', { sourceDirectory })), /non-regular/);
  await assert.rejects(fs.stat(path.join(f.directory, 'symlink')), { code: 'ENOENT' });
  await fs.rm(setup);
  await fs.copyFile(path.join(SOURCE, 'skills/assistant-setup/SKILL.md'), setup);
  await fs.writeFile(path.join(sourceDirectory, 'credential.txt'), 'fixture');
  await assert.rejects(buildPlugin(f.options('unexpected', { sourceDirectory })), /Unexpected/);
});

test('invalid lock, missing pinned components and committed symlinks are rejected', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.lockPath, JSON.stringify({ ...f.lock, directory: '../scripts' }));
  await assert.rejects(buildPlugin(f.options('path-escape')), /Invalid shell lock/);
  await fs.writeFile(f.lockPath, JSON.stringify({ ...f.lock, componentVersion: '9.9.9' }));
  await assert.rejects(buildPlugin(f.options('wrong-version')), /version differs/);
  const loader = path.join(f.repository, f.prefix, 'trelio-host-runtime-loader.mjs');
  await fs.rm(loader);
  f.git('add', '-u');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Remove loader');
  await fs.writeFile(f.lockPath, JSON.stringify({ ...f.lock, revision: f.git('rev-parse', 'HEAD') }));
  await assert.rejects(buildPlugin(f.options('missing')), /Incomplete pinned shell/);
  await fs.symlink('trelio-host-runtime-shell.mjs', loader);
  f.git('add', '.');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Symlink loader');
  await fs.writeFile(f.lockPath, JSON.stringify({ ...f.lock, revision: f.git('rev-parse', 'HEAD') }));
  await assert.rejects(buildPlugin(f.options('shell-link')), /non-regular/);
});

test('installed composition uses only the assistant profile and resolves onboarding', async (t) => {
  const f = await fixture(t);
  await buildPlugin(f.options('package'));
  const root = path.join(f.directory, 'package');
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.codex-plugin/plugin.json')));
  // A portable root wins Codex discovery and currently suppresses ALL bundled
  // hooks, even when its extension and the hooks file are otherwise valid.
  await assert.rejects(fs.stat(path.join(root, 'plugin.json')), {code:'ENOENT'});
  await assert.rejects(fs.stat(path.join(root, 'mcp.json')), {code:'ENOENT'});
  assert.deepEqual(Object.keys(manifest.mcpServers), ['trelio-assistant']);
  const server = manifest.mcpServers['trelio-assistant'];
  assert.deepEqual(server.args.slice(1), ['bridge', 'assistant', 'mcp']);
  assert.equal(server.type, undefined);
  assert.equal(server.cwd, '.', 'native compatibility discovery resolves the plugin root');
  assert.ok((await fs.stat(path.resolve(root, server.command))).isFile());
  assert.ok((await fs.stat(path.resolve(root, server.args[0]))).isFile());
  const extension = manifest;
  // Resolve images from the BUILT plugin root: a source-only SVG must not pass
  // while the marketplace package still falls back to the generic icon.
  for (const field of ['composerIcon', 'logo', 'logoDark']) {
    const relative = extension.interface[field];
    assert.match(relative, /^\.\/assets\/[^/]+\.svg$/u);
    const bytes = await fs.readFile(path.resolve(root, relative), 'utf8');
    assert.match(bytes, /<svg[^>]+viewBox="0 0 512 512"/u);
    assert.ok((await fs.stat(path.resolve(root, relative))).isFile());
  }
  assert.ok((await fs.stat(path.resolve(root, extension.onboardingSkill))).isFile());
  assert.equal(extension.hooks,undefined,'mutable main package owns no hooks');
  await assert.rejects(fs.stat(path.join(root,'hooks')),{code:'ENOENT'});
  const mainIntegrity=JSON.parse(await fs.readFile(path.join(root,'package-integrity.json')));
  await buildHookPlugin(f.options('stable-hooks'));
  const hookRoot=path.join(f.directory,'stable-hooks');
  const hookManifest=JSON.parse(await fs.readFile(path.join(hookRoot,'.codex-plugin/plugin.json')));
  assert.equal(hookManifest.name,HOOK_PLUGIN_NAME);
  assert.equal(hookManifest.mcpServers,undefined);
  assert.equal(hookManifest.skills,undefined);
  assert.equal(mainIntegrity.hookComponent.integritySha256,sha256(await fs.readFile(path.join(hookRoot,'package-integrity.json'))));
  const hooks = JSON.parse(await fs.readFile(path.resolve(hookRoot, hookManifest.hooks)));
  const matcher = new RegExp(hooks.hooks.PreToolUse[0].matcher);
  for (const name of ['mcp__trelio_assistant__complete_pass',
    'mcp__plugin_trelio-digital-assistant_trelio-assistant__get_task', 'trelio-assistant/get_task']) {
    assert.ok(matcher.test(name), name);
  }
  for (const name of ['mcp__trelio__get_task', 'mcp__other__get_task',
    'mcp__trelio_assistant__get_task_extra/other', 'exec_command']) {
    assert.equal(matcher.test(name), false, name);
  }
});

test('portable MCP rejects the legacy cwd before creating distributable output', async (t) => {
  const f = await fixture(t);
  const sourceDirectory = path.join(f.directory, 'source');
  await fs.cp(SOURCE, sourceDirectory, { recursive: true });
  const configPath = path.join(sourceDirectory, 'mcp.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  // The old package passed file-existence checks on all three OSes. Reproduce
  // its exact declaration, including the real file, so only the portable cwd
  // incompatibility causes rejection before an installable tree can be sealed.
  config.mcpServers['trelio-assistant'].cwd = '.';
  await fs.writeFile(configPath, JSON.stringify(config));
  await assert.rejects(buildPlugin(f.options('legacy-cwd', { sourceDirectory })),
    /Unsupported assistant source composition/u);
  await assert.rejects(fs.stat(path.join(f.directory, 'legacy-cwd')), { code: 'ENOENT' });
  config.mcpServers['trelio-assistant'].cwd = '${PLUGIN_ROOT}';
  await fs.writeFile(configPath, JSON.stringify(config));
  await buildPlugin(f.options('portable-cwd', { sourceDirectory }));
  const native=JSON.parse(await fs.readFile(path.join(f.directory, 'portable-cwd/.codex-plugin/plugin.json')));
  assert.equal(native.mcpServers['trelio-assistant'].cwd,'.');
});

test('skill discovery stays concise and setup/task instruction budget is bounded', async () => {
  const encoder = get_encoding('cl100k_base');
  try {
    let total = 0;
    for (const name of ['assistant-setup', 'assistant-task-worker']) {
      const source = await fs.readFile(path.join(SOURCE, 'skills', name, 'SKILL.md'), 'utf8');
      const metadata = source.split('---')[1];
      assert.ok(metadata.split(/\r?\n/).includes(`name: ${name}`));
      total += encoder.encode(source).length;
    }
    assert.ok(total < 2100, `Bundled instruction tokens: ${total}`);
  } finally { encoder.free(); }
});

async function distributionFixture(t) {
  const f=await fixture(t),sourceRepository=path.join(f.directory,'source'),remote=path.join(f.directory,'remote.git');
  await fs.mkdir(path.join(sourceRepository,'plugins'),{recursive:true});
  await fs.cp(SOURCE,path.join(sourceRepository,'plugins/trelio-digital-assistant'),{recursive:true});
  await fs.cp(path.join(ROOT,'plugins',HOOK_PLUGIN_NAME),path.join(sourceRepository,'plugins',HOOK_PLUGIN_NAME),{recursive:true});
  await fs.copyFile(f.lockPath,path.join(sourceRepository,'shared-shell.lock.json'));
  await fs.copyFile(f.lockPath,path.join(sourceRepository,'hook-shell.lock.json'));
  await fs.mkdir(path.join(sourceRepository,'.agents/plugins'),{recursive:true});
  await fs.copyFile(path.join(ROOT,'.agents/plugins/marketplace.json'),path.join(sourceRepository,'.agents/plugins/marketplace.json'));
  const git=(...args)=>execFileSync('git',['-C',sourceRepository,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','main');git('config','core.autocrlf','false');git('add','.');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Release source');
  const sourceCommit=git('rev-parse','HEAD');git('tag','v0.1.7');
  execFileSync('git',['init','-q','--bare',remote],{stdio:['ignore','pipe','pipe']});git('remote','add','origin',remote);
  const prepare=output=>preparePluginDistribution({sourceRepository,shellRepository:f.repository,outputDirectory:path.join(f.directory,output),sourceCommit,version:'0.1.7'});
  const publish=(prepared,runGit)=>publishPluginDistribution({sourceRepository,shellRepository:f.repository,prepared,runGit});
  return {...f,sourceRepository,remote,sourceCommit,git,prepare,publish};
}

test('installable Git preparation is deterministic, self-contained and pins exact source, shell, bytes and modes',async t=>{
  const f=await distributionFixture(t),first=await f.prepare('first-distribution'),second=await f.prepare('second-distribution');
  assert.deepEqual(second,first);assert.equal(first.sourceCommit,f.sourceCommit);assert.equal(first.sharedShellRevision,f.lock.revision);
  assert.equal(first.distributionRef,'refs/tags/plugin-v0.1.7');
  assert.equal(f.git('rev-parse','HEAD'),f.sourceCommit,'preparation cannot switch the source checkout');
  assert.equal(f.git('rev-list','--parents','-n','1',first.distributionCommit),first.distributionCommit,'installable tree has no source/history parents');
  const tree=f.git('ls-tree','-r',first.distributionCommit);
  assert.equal(tree.split('\n').length,16);assert.match(tree,/100755 blob [a-f0-9]{40}\tscripts\/launch-trelio-node/u);
  assert.doesNotMatch(tree,/credential|node_modules|AGENTS\.md|\.git\//u);
  const inventory=JSON.parse(f.git('show',`${first.distributionCommit}:package-integrity.json`));
  const inventoryBytes=Buffer.from(f.git('show',`${first.distributionCommit}:package-integrity.json`)+'\n');
  assert.equal(sha256(inventoryBytes),first.integritySha256);
  for(const entry of inventory.files){
    const actual=execFileSync('git',['-C',f.sourceRepository,'show',`${first.distributionCommit}:${entry.path}`]);
    assert.equal(sha256(actual),entry.sha256);assert.equal(actual.length,entry.size);
    assert.deepEqual(await fs.readFile(path.join(f.directory,'first-distribution',entry.path)),actual);
  }
  const native=JSON.parse(f.git('show',`${first.distributionCommit}:.codex-plugin/plugin.json`)),server=native.mcpServers['trelio-assistant'];
  for(const relative of [server.command,server.args[0]])assert.ok(f.git('show',`${first.distributionCommit}:${relative.replace(/^\.\//u,'')}`));
  assert.equal(spawnSync('git',['-C',f.sourceRepository,'show-ref','--verify','--quiet',first.distributionRef]).status,1,'preparation creates no local or remote release ref');
});

test('source version, marketplace target, source tag and clean tracked bytes are release requirements',async t=>{
  const f=await distributionFixture(t),options={sourceRepository:f.sourceRepository,shellRepository:f.repository,
    outputDirectory:path.join(f.directory,'rejected'),sourceCommit:f.sourceCommit,version:'0.1.7'};
  await assert.rejects(preparePluginDistribution({...options,sourceCommit:'f'.repeat(40)}),/exact clean release commit/u);
  await assert.rejects(preparePluginDistribution({...options,version:'0.1.7-draft'}),/exact clean release commit/u);
  f.git('tag','-d','v0.1.7');await assert.rejects(preparePluginDistribution(options),/Git operation failed/u);f.git('tag','v0.1.7');
  await fs.appendFile(path.join(f.sourceRepository,'plugins/trelio-digital-assistant/plugin.json'),'\n');
  await assert.rejects(preparePluginDistribution(options),/exact clean release commit/u);
  f.git('restore','--','plugins/trelio-digital-assistant/plugin.json');
  const catalog=path.join(f.sourceRepository,'.agents/plugins/marketplace.json'),data=JSON.parse(await fs.readFile(catalog));
  data.plugins[0].source.ref='main';await fs.writeFile(catalog,JSON.stringify(data));f.git('add','.');
  f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Wrong distribution source');
  const moved=f.git('rev-parse','HEAD');f.git('tag','-d','v0.1.7');f.git('tag','v0.1.7');
  await assert.rejects(preparePluginDistribution({...options,sourceCommit:moved}),/exact installable Git release/u);
  await assert.rejects(fs.stat(options.outputDirectory),{code:'ENOENT'});
});

test('publication creates only the immutable generated tag and an exact repeat performs no push',async t=>{
  const f=await distributionFixture(t),prepared=await f.prepare('publish'),args=[];
  const runGit=(repository,argv)=>{args.push(argv);return spawnSync('git',['-C',repository,...argv]);};
  const first=await f.publish(prepared,runGit);assert.equal(first.published,true);assert.equal(first.alreadyPublished,false);
  assert.equal(f.git('ls-remote','--refs','origin',prepared.distributionRef).split('\t')[0],prepared.distributionCommit);
  assert.equal(f.git('rev-parse','HEAD'),f.sourceCommit);assert.equal(f.git('ls-remote','--refs','origin','refs/heads/main'),'');
  const replay=await f.publish(prepared,runGit);assert.equal(replay.alreadyPublished,true);
  assert.equal(args.filter(argv=>argv[0]==='push').length,1);assert.ok(args.every(argv=>!argv.some(value=>value.startsWith('--force'))));
  const install=path.join(f.directory,'installed');
  // Real Windows CI exposed the default autocrlf rewrite. Exercise it on ALL
  // OSes instead of disabling conversion in the fixture and hiding a broken
  // install. Generated attributes must preserve every inventory byte.
  execFileSync('git',['clone','-q','--config','core.autocrlf=true','--branch','plugin-v0.1.7',f.remote,install],{stdio:['ignore','pipe','pipe']});
  assert.equal(execFileSync('git',['-C',install,'config','--get','core.autocrlf'],{encoding:'utf8'}).trim(),'true');
  const integrity=JSON.parse(await fs.readFile(path.join(install,'package-integrity.json'),'utf8'));
  for(const file of [...integrity.files,{path:'package-integrity.json'}])
    assert.deepEqual(await fs.readFile(path.join(install,file.path)),await fs.readFile(path.join(f.directory,'publish',file.path)));
  assert.equal(await fs.readFile(path.join(install,'.gitattributes'),'utf8'),'* -text\n');
});

test('a lost successful push reply is recovered by exact read-back without a second write',async t=>{
  const f=await distributionFixture(t),prepared=await f.prepare('lost'),pushes=[];
  const result=await f.publish(prepared,(repository,args)=>{
    const actual=spawnSync('git',['-C',repository,...args]);
    if(args[0]==='push'){pushes.push(args);assert.equal(actual.status,0);return {...actual,status:1,stderr:Buffer.from('synthetic lost response')};}
    return actual;
  });
  assert.equal(result.published,true);assert.equal(result.alreadyPublished,false);assert.equal(pushes.length,1);
});

test('existing mismatched tags, tampered provenance and unknown delivery never force or replay publication',async t=>{
  const f=await distributionFixture(t),prepared=await f.prepare('blocked');let pushes=0;
  const runGit=(repository,args)=>{if(args[0]==='push')pushes++;return spawnSync('git',['-C',repository,...args]);};
  for(const changed of [{distributionRef:'refs/heads/main'},{sourceCommit:'f'.repeat(40)},{integritySha256:'f'.repeat(64)},
    {credential:'PRIVATE'},{distributionCommit:f.sourceCommit}])await assert.rejects(f.publish({...prepared,...changed},runGit));
  assert.equal(pushes,0);
  await assert.rejects(f.publish(prepared,(repository,args)=>{
    if(args[0]==='push'){pushes++;return {status:1,stdout:Buffer.alloc(0),stderr:Buffer.from('synthetic no delivery')};}
    return spawnSync('git',['-C',repository,...args]);
  }),/publication uncertain/u);
  assert.equal(pushes,1,'unknown result cannot repeat even its own one write');
  f.git('push','-q','origin',`${f.sourceCommit}:${prepared.distributionRef}`);pushes=0;
  await assert.rejects(f.publish(prepared,runGit),/already exists with different bytes/u);assert.equal(pushes,0);
  assert.equal(f.git('ls-remote','--refs','origin',prepared.distributionRef).split('\t')[0],f.sourceCommit);
});

test('failed or noisy remote metadata never turns into a missing installable tag',async t=>{
  const f=await distributionFixture(t),prepared=await f.prepare('metadata');let pushes=0;
  for(const result of [{status:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)},
    {status:0,stdout:Buffer.alloc(0),stderr:Buffer.from('warning')},
    {status:0,stdout:Buffer.from(`${f.sourceCommit}\trefs/heads/main\n`),stderr:Buffer.alloc(0)}]){
    await assert.rejects(f.publish(prepared,(_repository,args)=>{if(args[0]==='push')pushes++;return result;}));
  }
  assert.equal(pushes,0);
});

test('marketplace and tagged workflow publish an existing builder Git source after exact three-OS evidence',async()=>{
  const marketplace=JSON.parse(await fs.readFile(path.join(ROOT,'.agents/plugins/marketplace.json')));
  assert.equal(marketplace.name,'trelio-digital-assistants');assert.equal(marketplace.plugins.length,2);
  assert.deepEqual(marketplace.plugins[0].source,{source:'url',url:'https://github.com/trelio-ru/digital-assistants.git',ref:'plugin-v0.1.7'});
  assert.deepEqual(marketplace.plugins[0].policy,{installation:'AVAILABLE',authentication:'ON_INSTALL'});
  const workflow=await fs.readFile(path.join(ROOT,'.github/workflows/plugin-tests.yml'),'utf8');
  assert.match(workflow,/tags: \['v\*'\]/u);assert.doesNotMatch(workflow,/tags:.*plugin-v/u);
  assert.match(workflow,/needs: verified-source/u);assert.match(workflow,/head_sha: context\.sha/u);
  const verifier=workflow.split('  verified-source:')[1].split('  release-package:')[0];
  assert.match(verifier,/contents: read/u);assert.match(verifier,/actions: read/u);
  assert.match(verifier,/git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main/u);
  assert.match(workflow,/\['ubuntu-latest','macos-latest','windows-latest'\]/u);
  assert.match(workflow,/ref: \$\{\{ steps\.shell\.outputs\.revision \}\}/u);
  assert.match(workflow,/preparePluginDistribution/u);assert.match(workflow,/publishPluginDistribution/u);
  assert.doesNotMatch(workflow,/npm publish|--force|git push.*main|trelio-backend|SIGNING_KEY/u);
});

test('main releases retain the original immutable hook release instead of minting version-dependent hook bundles',async t=>{
  const f=await distributionFixture(t);
  const first=await prepareHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,
    outputDirectory:path.join(f.directory,'hooks-first'),sourceCommit:f.sourceCommit});
  assert.equal(first.mode,'publish');assert.equal(first.prepared.version,'0.1.0');assert.equal(first.prepared.sourceTag,'v0.1.7');
  await publishHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,sourceCommit:f.sourceCommit,dependency:first});
  await fs.writeFile(path.join(f.sourceRepository,'hook-component.lock.json'),JSON.stringify(first.prepared,null,2)+'\n');
  const manifestPath=path.join(f.sourceRepository,'plugins/trelio-digital-assistant/plugin.json');
  const manifest=JSON.parse(await fs.readFile(manifestPath));manifest.version='0.1.8';await fs.writeFile(manifestPath,JSON.stringify(manifest));
  const marketPath=path.join(f.sourceRepository,'.agents/plugins/marketplace.json'),market=JSON.parse(await fs.readFile(marketPath));
  market.plugins[0].source.ref='plugin-v0.1.8';await fs.writeFile(marketPath,JSON.stringify(market));
  f.git('add','.');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Unchanged hooks, updated main');
  f.git('tag','v0.1.8');const sourceCommit=f.git('rev-parse','HEAD');
  const retained=await prepareHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,
    outputDirectory:path.join(f.directory,'hooks-retained'),sourceCommit});
  assert.equal(retained.mode,'retained');assert.deepEqual(retained.prepared,first.prepared);
  let pushes=0;
  const runGit=(repository,args)=>{if(args[0]==='push')pushes++;return spawnSync('git',['-C',repository,...args]);};
  const readBack=await publishHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,sourceCommit,dependency:retained,runGit});
  assert.equal(readBack.alreadyPublished,true);assert.equal(pushes,0,'a main-only release cannot rewrite or republish trusted executable bytes');
  await assert.rejects(publishHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,sourceCommit,dependency:{...retained,mode:'publish'},runGit}),/locked/);
  // A real executable change requires a new component version/release/review;
  // it cannot inherit the previous bundle's provenance or native approval.
  await fs.appendFile(path.join(f.sourceRepository,'plugins',HOOK_PLUGIN_NAME,'hooks/hooks.json'),'\n');
  f.git('add','.');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','Changed executable component');
  f.git('tag','-d','v0.1.8');f.git('tag','v0.1.8');
  await assert.rejects(prepareHookDependency({sourceRepository:f.sourceRepository,shellRepository:f.repository,
    outputDirectory:path.join(f.directory,'changed-hooks'),sourceCommit:f.git('rev-parse','HEAD')}),/hook bytes changed/);
  assert.equal(pushes,0);
});

test('main shell pin changes do not rewrite an unchanged independently pinned hook component',async t=>{
  const f=await fixture(t);
  const a=await buildPlugin(f.options('old-main-pin'));
  await fs.writeFile(path.join(f.repository,'README.md'),'Synthetic non-hook source metadata change\n');
  f.git('add','.');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','New main-only shell provenance');
  const newerLock=path.join(f.directory,'main-new-lock.json');await fs.writeFile(newerLock,JSON.stringify({...f.lock,revision:f.git('rev-parse','HEAD')}));
  const b=await buildPlugin(f.options('new-main-pin',{lockPath:newerLock}));
  assert.notEqual(a.sharedShell.revision,b.sharedShell.revision);
  assert.deepEqual(a.hookComponent,b.hookComponent,'main provenance must never contaminate native hook approval');
});
