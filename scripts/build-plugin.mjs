#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHELL_FILES = Object.freeze([
  'launch-trelio-node', 'launch-trelio-node.cmd', 'resolve-node.ps1',
  'trelio-host-runtime-download.mjs', 'trelio-host-runtime-loader.mjs',
  'trelio-host-runtime-shell.mjs', 'trelio-mcp-startup-budget.mjs',
]);
const SOURCE_FILES = Object.freeze([
  'plugin.json', 'mcp.json',
  // Presentation assets belong to this plugin, not the pinned shared shell.
  // Keep every manifest image explicit so both local and tagged builds include
  // identical reviewed bytes in their integrity inventories.
  'assets/trelio-assistant-composer-icon.svg',
  'assets/trelio-assistant-logo.svg', 'assets/trelio-assistant-logo-dark.svg',
  'skills/assistant-setup/SKILL.md', 'skills/assistant-task-worker/SKILL.md',
  'skills/assistant-task-worker/references/work-state.md',
]);
// Codex fingerprints the ENTIRE hook-owning plugin, not just hooks.json.
// Keep this executable component independent of versioned MCP/skill content.
// Both packages still use the same exact Git-pinned shell; there is no copied
// executor and no approval migration, ignored-file trick or trust bypass.
export const HOOK_PLUGIN_NAME = 'trelio-digital-assistant-hooks';
const HOOK_SOURCE_FILES = Object.freeze(['plugin.json', 'hooks/hooks.json']);
const MAX_FILE_BYTES = 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };
export const DISTRIBUTION_REPOSITORY = 'https://github.com/trelio-ru/digital-assistants.git';
const COMMIT = /^[a-f0-9]{40}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;

/** Read only regular, bounded source files. A stray credential, symlink or new
 * component cannot silently become part of a distributable plugin: changing the
 * explicit payload list is a reviewable source change. Parent symlinks within
 * the source root are rejected as well as final-file symlinks. */
async function readSource(root, expectedFiles = SOURCE_FILES) {
  const files = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!expectedFiles.some((name) => name.startsWith(relative + '/'))) {
          fail(`Unexpected source directory: ${relative}`);
        }
        await visit(absolute, relative + '/');
      } else {
        if (!entry.isFile() || !expectedFiles.includes(relative)) {
          fail(`Unexpected or non-regular source file: ${relative}`);
        }
        const stat = await fs.lstat(absolute);
        if (stat.size > MAX_FILE_BYTES) fail(`Source file too large: ${relative}`);
        const bytes = await fs.readFile(absolute);
        if (bytes.length > MAX_FILE_BYTES) fail(`Source file too large: ${relative}`);
        files.set(relative, { bytes, mode: 0o644 });
      }
    }
  }
  const metadata = await fs.lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('Unsafe source root');
  await visit(root);
  if (files.size !== expectedFiles.length) fail('Incomplete plugin source');
  return files;
}

/** No checkout scripts run and no worktree files are read. Git object IDs come
 * from one pinned commit tree, so local dirt and branch movement cannot replace
 * the trusted loader or its signature verifier in the generated package. */
function readShell(repository, lock) {
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(lock.revision)
    || lock.repository !== 'https://github.com/trelio-ru/agent-workspaces.git'
    || lock.directory !== 'plugins/trelio-agent-workspaces/scripts'
    || !/^\d+\.\d+\.\d+$/.test(lock.componentVersion)) fail('Invalid shell lock');
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
    maxBuffer: MAX_FILE_BYTES * 2, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const commit = git('rev-parse', '--verify', `${lock.revision}^{commit}`).toString().trim();
  if (commit !== lock.revision) fail('Shell revision must identify an exact commit');
  const entries = git('ls-tree', '-r', '-z', lock.revision, '--', lock.directory)
    .toString('utf8').split('\0').filter(Boolean);
  const files = new Map();
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\t\r\n]+)$/.exec(entry);
    if (!match) fail('Shell tree contains a non-regular or malformed entry');
    const name = match[3].slice(lock.directory.length + 1);
    if (!match[3].startsWith(lock.directory + '/') || !SHELL_FILES.includes(name)) {
      fail('Shell tree contains an unexpected component');
    }
    const bytes = git('cat-file', 'blob', match[2]);
    if (bytes.length > MAX_FILE_BYTES) fail('Shell component too large');
    files.set(`scripts/${name}`, { bytes, mode: match[1] === '100755' ? 0o755 : 0o644 });
  }
  if (files.size !== SHELL_FILES.length) fail('Incomplete pinned shell');
  const version = files.get('scripts/trelio-host-runtime-shell.mjs').bytes.toString();
  if (!version.includes(`export const PLUGIN_VERSION = "${lock.componentVersion}";`)) {
    fail('Pinned shell component version differs from lock');
  }
  return files;
}

/** One inventory format for local builds and the installable Git source. The
 * generated ref contains these exact bytes/modes, not another shell source or
 * a ZIP transport invented by the marketplace. */
function pluginIntegrity(files, lock, hookComponent = null) {
  const manifest = JSON.parse(files.get('.codex-plugin/plugin.json').bytes.toString());
  if (!['trelio-digital-assistant', HOOK_PLUGIN_NAME].includes(manifest.name)) fail('Unexpected plugin identity');
  const inventory = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, entry]) => ({ path: name, mode: entry.mode, size: entry.bytes.length,
      sha256: sha256(entry.bytes) }));
  return { schemaVersion: 1, plugin: manifest.name, version: manifest.version,
    sharedShell: lock, files: inventory, ...(hookComponent ? {hookComponent} : {}) };
}
const integrityFile = integrity => ({
  bytes: Buffer.from(JSON.stringify(integrity, null, 2) + '\n'), mode: 0o644,
});
function completePluginFiles(files, shellRepository, lock) {
  // Codex 0.164 discovers skills/MCP from an Agent Plugins root manifest but
  // explicitly skips that format's lifecycle hooks. File existence therefore
  // did not prove admission on Windows. Emit its supported native manifest,
  // exactly as the human plugin does; NEVER retain root plugin.json, which
  // wins native discovery and would silently select the hook-less format.
  // Only presentation/paths are translated. Hook bytes, shared shell, device
  // endpoint, approval/trust and all runtime authority remain unchanged.
  const portable = JSON.parse(files.get('plugin.json').bytes.toString());
  const extension = portable.extensions?.['com.openai'];
  const mcp = JSON.parse(files.get('mcp.json').bytes.toString());
  const server = mcp.mcpServers?.['trelio-assistant'];
  if (Object.keys(mcp.mcpServers ?? {}).join(',') !== 'trelio-assistant'
    || server?.cwd !== '${PLUGIN_ROOT}' || server.type !== 'stdio'
    || extension?.hooks !== undefined) fail('Unsupported assistant source composition');
  const { type: _type, cwd: _cwd, ...nativeServer } = server;
  const manifest = { name: portable.name, version: portable.version,
    description: portable.description, author: portable.author,
    repository: portable.repository, skills: './skills/',
    onboardingSkill: extension.onboardingSkill,
    interface: extension.interface,
    // Native compatibility discovery resolves "." from the plugin root. The
    // portable source keeps ${PLUGIN_ROOT}; do not confuse the two parsers.
    mcpServers: { 'trelio-assistant': { ...nativeServer, cwd: '.' } } };
  files.delete('plugin.json');
  files.delete('mcp.json');
  files.set('.codex-plugin/plugin.json', {
    bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), mode: 0o644,
  });
  for (const [name, entry] of readShell(shellRepository, lock)) files.set(name, entry);
  // Git-backed installation must preserve the very bytes in the inventory.
  // In particular Windows autocrlf cannot rewrite the pinned loader/launcher
  // after publication. This fixed generated metadata adds no shell behavior.
  files.set('.gitattributes', {bytes:Buffer.from('* -text\n'),mode:0o644});
  return files;
}

function completeHookPluginFiles(files, shellRepository, lock) {
  const manifest = JSON.parse(files.get('plugin.json').bytes);
  if (manifest.name !== HOOK_PLUGIN_NAME || !VERSION.test(manifest.version ?? '')
    || manifest.hooks !== './hooks/hooks.json'
    || Object.keys(manifest).some(key => !['name','version','description','author','repository','hooks'].includes(key)))
    fail('Unsupported stable hook component');
  files.delete('plugin.json');
  files.set('.codex-plugin/plugin.json', {
    bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), mode: 0o644,
  });
  for (const [name, entry] of readShell(shellRepository, lock)) files.set(name, entry);
  files.set('.gitattributes', {bytes:Buffer.from('* -text\n'),mode:0o644});
  return files;
}

const hookComponentDescriptor = (files, lock) => {
  const integrity = pluginIntegrity(files, lock);
  return {pluginId:`${HOOK_PLUGIN_NAME}@trelio-digital-assistants`,
    version:integrity.version,integritySha256:sha256(integrityFile(integrity).bytes)};
};

async function writePluginOutput(files, lock, outputDirectory, hookComponent = null) {
  const integrity = pluginIntegrity(files, lock, hookComponent);
  files.set('package-integrity.json', integrityFile(integrity));
  await fs.mkdir(outputDirectory, { mode: 0o755 });
  try {
    for (const [name, {bytes,mode}] of files) {
      const destination=path.join(outputDirectory,name);
      await fs.mkdir(path.dirname(destination), {recursive:true,mode:0o755});
      await fs.writeFile(destination,bytes,{flag:'wx',mode});
      await fs.chmod(destination,mode);
    }
  } catch (error) {
    await fs.rm(outputDirectory,{recursive:true,force:true});
    throw error;
  }
  return integrity;
}

export async function buildHookPlugin({shellRepository,outputDirectory,
  sourceDirectory=path.join(ROOT,'plugins',HOOK_PLUGIN_NAME),
  lockPath=path.join(ROOT,'hook-shell.lock.json')}) {
  if(!shellRepository||!outputDirectory||!path.isAbsolute(outputDirectory))fail('Provide --shell-repo and an absolute --output directory');
  const lock=JSON.parse(await fs.readFile(lockPath,'utf8'));
  return writePluginOutput(completeHookPluginFiles(await readSource(sourceDirectory,HOOK_SOURCE_FILES),shellRepository,lock),lock,outputDirectory);
}

export async function buildPlugin({ shellRepository, outputDirectory,
  sourceDirectory = path.join(ROOT, 'plugins/trelio-digital-assistant'),
  hookSourceDirectory = path.join(ROOT, 'plugins', HOOK_PLUGIN_NAME),
  hookLockPath = path.join(ROOT,'hook-shell.lock.json'),
  lockPath = path.join(ROOT, 'shared-shell.lock.json') }) {
  if (!shellRepository || !outputDirectory || !path.isAbsolute(outputDirectory)) {
    fail('Provide --shell-repo and an absolute --output directory');
  }
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const files = completePluginFiles(await readSource(sourceDirectory), shellRepository, lock);
  // The dependency descriptor binds the complete executable component bytes.
  // It lives ONLY in the mutable main package. No main version/instructions,
  // provenance or source commit can contaminate the hook bundle fingerprint.
  const hookLock=JSON.parse(await fs.readFile(hookLockPath,'utf8'));
  const hookFiles=completeHookPluginFiles(await readSource(hookSourceDirectory,HOOK_SOURCE_FILES),shellRepository,hookLock);
  return writePluginOutput(files,lock,outputDirectory,hookComponentDescriptor(hookFiles,hookLock));
}

const runDistributionGit = (repository, args, options = {}) => spawnSync('git', ['-C', repository, ...args], {
  maxBuffer: MAX_FILE_BYTES * 2, windowsHide: true, ...options, stdio: ['pipe', 'pipe', 'pipe'],
});
const gitBytes = (repository, args, options) => {
  const result = runDistributionGit(repository, args, options);
  // Never print Git stderr: a remote/configuration failure may contain an
  // authenticated URL. Even successful metadata with stderr is not clean proof.
  if (result.error || result.status !== 0 || result.stderr.length) fail('Distribution Git operation failed');
  return result.stdout;
};
const gitScalar = (repository, args, options) => gitBytes(repository, args, options).toString('utf8').replace(/\n$/u, '');

function distributionSource(repository, sourceCommit, version, kind='assistant') {
  if(!['assistant','hooks'].includes(kind))fail('Unsupported distribution kind');
  if(!COMMIT.test(sourceCommit??'')||!VERSION.test(version??''))fail('Distribution source must be the exact clean release commit');
  const name=kind==='hooks'?HOOK_PLUGIN_NAME:'trelio-digital-assistant';
  // A source release tests both components together. Their installable
  // versions are independent: the first main v0.1.5 may publish hooks 0.1.0.
  const releaseVersion=kind==='hooks'?JSON.parse(gitBytes(repository,['show',`${sourceCommit}:plugins/trelio-digital-assistant/plugin.json`])).version:version;
  if(!VERSION.test(releaseVersion??''))fail('Invalid source release version');
  const sourceTag=`v${releaseVersion}`;
  if (!COMMIT.test(sourceCommit ?? '') || !VERSION.test(version ?? '')
    || gitScalar(repository, ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceCommit
    || gitScalar(repository, ['rev-parse', '--verify', `refs/tags/${sourceTag}^{commit}`]) !== sourceCommit
    || gitBytes(repository, ['status', '--porcelain', '--untracked-files=no']).length) fail('Distribution source must be the exact clean release commit');
  const lock = JSON.parse(gitBytes(repository, ['show', `${sourceCommit}:${kind==='hooks'?'hook-shell':'shared-shell'}.lock.json`]));
  const marketplace = JSON.parse(gitBytes(repository, ['show', `${sourceCommit}:.agents/plugins/marketplace.json`]));
  const entries = marketplace.plugins?.filter(entry => entry.name === name);
  const ref=kind==='hooks'?`hooks-v${version}`:`plugin-v${version}`;
  const distributionRef = `refs/tags/${ref}`;
  // Codex fingerprints checkout metadata when a Git-URL plugin occupies the
  // repository root. A native git-subdir projection installs ONLY this fixed
  // immutable payload, with .git remaining outside the hook-owning bundle.
  // Legacy 0.1.0 is read/verified in its original format; never rewrite its tag.
  const subdirectory = kind === 'hooks' && version !== '0.1.0';
  if (marketplace.name !== 'trelio-digital-assistants' || entries?.length !== 1
    || !entries[0].source || Object.keys(entries[0].source).sort().join(',') !== (subdirectory?'path,ref,source,url':'ref,source,url')
    || entries[0].source.source !== (subdirectory?'git-subdir':'url')
    || subdirectory && entries[0].source.path !== './plugin'
    || entries[0].source.url !== DISTRIBUTION_REPOSITORY
    || entries[0].source.ref !== ref)
    fail('Marketplace must select the exact installable Git release');
  const files = new Map((kind==='hooks'?HOOK_SOURCE_FILES:SOURCE_FILES).map(file => [file, {
    bytes: gitBytes(repository, ['show', `${sourceCommit}:plugins/${name}/${file}`]), mode: 0o644,
  }]));
  const manifest = JSON.parse(files.get('plugin.json').bytes);
  if (manifest.name !== name || manifest.version !== version) fail('Distribution release version differs from plugin manifest');
  return { lock, files, distributionRef, sourceTag };
}

function expectedDistribution(repository, shellRepository, sourceCommit, version, kind='assistant') {
  const source = distributionSource(repository, sourceCommit, version, kind);
  let descriptor=null;
  if(kind==='hooks')completeHookPluginFiles(source.files,shellRepository,source.lock);
  else {
    completePluginFiles(source.files,shellRepository,source.lock);
    const hookFiles=new Map(HOOK_SOURCE_FILES.map(file=>[file,{bytes:gitBytes(repository,['show',`${sourceCommit}:plugins/${HOOK_PLUGIN_NAME}/${file}`]),mode:0o644}]));
    const hookLock=JSON.parse(gitBytes(repository,['show',`${sourceCommit}:hook-shell.lock.json`]));
    descriptor=hookComponentDescriptor(completeHookPluginFiles(hookFiles,shellRepository,hookLock),hookLock);
  }
  const integrity = pluginIntegrity(source.files, source.lock, descriptor);
  source.files.set('package-integrity.json', integrityFile(integrity));
  // The builder output/inventory still describes the installed package root.
  // Only its immutable Git transport tree gains the reviewed wrapper. Keep a
  // root attributes file too so Windows Git cannot rewrite nested payloads.
  // This is native materialization, not post-install cache pruning/exclusions.
  const treeFiles = kind === 'hooks' && version !== '0.1.0'
    ? new Map([['.gitattributes',source.files.get('.gitattributes')],
      ...[...source.files].map(([name,entry])=>[`plugin/${name}`,entry])]) : source.files;
  return { ...source, integrity, treeFiles };
}

function writeDistributionTree(repository, files) {
  const root = new Map();
  for (const [relative, entry] of files) {
    const parts = relative.split('/'); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
    }
    const object = gitScalar(repository, ['hash-object', '-w', '--stdin'], { input: entry.bytes });
    node.set(parts.at(-1), { object, mode: entry.mode === 0o755 ? '100755' : '100644' });
  }
  const write = node => gitScalar(repository, ['mktree', '-z'], { input: Buffer.from([...node].map(([name, entry]) =>
    entry instanceof Map ? `040000 tree ${write(entry)}\t${name}\0` : `${entry.mode} blob ${entry.object}\t${name}\0`).join('')) });
  return write(root);
}

function writeDistributionCommit(repository, {tree,sourceCommit,version,sharedShellRevision,integritySha256,sourceTag=`v${version}`}, kind='assistant') {
  const timestamp = gitScalar(repository, ['show','-s','--format=%ct',sourceCommit]);
  if (!/^\d+$/u.test(timestamp)) fail('Invalid release source timestamp');
  const name=kind==='hooks'?HOOK_PLUGIN_NAME:'trelio-digital-assistant';
  const message = `Installable ${name} ${version}\n\nSource: ${sourceCommit}\nSource tag: ${sourceTag}\nShared shell: ${sharedShellRevision}\nIntegrity SHA-256: ${integritySha256}\n`;
  const commit = gitScalar(repository, ['-c','commit.gpgsign=false','commit-tree',tree], {input:Buffer.from(message),env:{...process.env,
    GIT_AUTHOR_NAME:'Trelio',GIT_AUTHOR_EMAIL:'noreply@trelio.ru',GIT_COMMITTER_NAME:'Trelio',GIT_COMMITTER_EMAIL:'noreply@trelio.ru',
    GIT_AUTHOR_DATE:`${timestamp} +0000`,GIT_COMMITTER_DATE:`${timestamp} +0000`}});
  if (!COMMIT.test(commit)) fail('Invalid installable commit');
  return commit;
}

/** Release preparation writes only disposable builder output and immutable
 * local Git objects. No ref/remote/install is changed. Source and pinned shell
 * bytes are independently compared with the SAME builder output before the
 * orphan installable commit is constructed. Its fixed metadata makes rerunning
 * preparation yield the same commit rather than a different immutable tag. */
export async function preparePluginDistribution({ sourceRepository = ROOT, shellRepository, outputDirectory, sourceCommit, version, kind='assistant' }) {
  const expected = expectedDistribution(sourceRepository, shellRepository, sourceCommit, version,kind);
  const build=kind==='hooks'?buildHookPlugin:buildPlugin;
  const integrity = await build({shellRepository,outputDirectory,
    sourceDirectory:path.join(sourceRepository,'plugins',kind==='hooks'?HOOK_PLUGIN_NAME:'trelio-digital-assistant'),
    hookSourceDirectory:path.join(sourceRepository,'plugins',HOOK_PLUGIN_NAME),
    hookLockPath:path.join(sourceRepository,'hook-shell.lock.json'),
    lockPath:path.join(sourceRepository,kind==='hooks'?'hook-shell.lock.json':'shared-shell.lock.json')});
  if (JSON.stringify(integrity) !== JSON.stringify(expected.integrity)) fail('Builder output differs from the exact tagged source');
  for (const [name, entry] of expected.files) {
    if (!entry.bytes.equals(await fs.readFile(path.join(outputDirectory,name)))) fail('Builder payload changed after verification');
  }
  // Repeat the source check after asynchronous file I/O. A moved or modified
  // source cannot lend its release identity to an already prepared payload.
  distributionSource(sourceRepository,sourceCommit,version,kind);
  const tree = writeDistributionTree(sourceRepository, expected.treeFiles);
  const integritySha256 = sha256(expected.files.get('package-integrity.json').bytes);
  const commit = writeDistributionCommit(sourceRepository,{tree,sourceCommit,version,sharedShellRevision:expected.lock.revision,integritySha256,sourceTag:expected.sourceTag},kind);
  return {schemaVersion:1,version,sourceCommit,sourceTag:expected.sourceTag,distributionRef:expected.distributionRef,
    distributionCommit:commit,tree,sharedShellRevision:expected.lock.revision,integritySha256};
}

/** Exactly one immutable ref creation, followed by authoritative read-back.
 * This is release glue around native Git, not a plugin/runtime executor. It
 * never force-updates a tag, touches main or installs/trusts anything. A lost
 * push reply is successful only when the exact remote commit is observed. */
export async function publishPluginDistribution({ sourceRepository = ROOT, shellRepository, prepared, runGit = runDistributionGit }) {
  const keys=['schemaVersion','version','sourceCommit','sourceTag','distributionRef','distributionCommit','tree','sharedShellRevision','integritySha256'];
  if (!prepared || Object.keys(prepared).sort().join(',') !== keys.sort().join(',')
    || prepared.schemaVersion !== 1 || !COMMIT.test(prepared.distributionCommit ?? '') || !COMMIT.test(prepared.tree ?? ''))
    fail('Invalid prepared distribution');
  const kind=prepared.distributionRef===`refs/tags/hooks-v${prepared.version}`?'hooks':'assistant';
  const expected = expectedDistribution(sourceRepository,shellRepository,prepared.sourceCommit,prepared.version,kind);
  if (prepared.sourceTag !== expected.sourceTag || prepared.distributionRef !== expected.distributionRef
    || prepared.sharedShellRevision !== expected.lock.revision || prepared.integritySha256 !== sha256(expected.files.get('package-integrity.json').bytes)
    || gitScalar(sourceRepository,['rev-parse',`${prepared.distributionCommit}^{tree}`]) !== prepared.tree
    || writeDistributionTree(sourceRepository,expected.treeFiles) !== prepared.tree
    // Also pin orphan parents, metadata and public provenance. Matching files
    // alone must not publish a caller-supplied commit/history under this name.
    || writeDistributionCommit(sourceRepository,prepared,kind) !== prepared.distributionCommit) fail('Prepared distribution no longer matches its exact source');
  const observe = () => {
    const result = runGit(sourceRepository,['ls-remote','--refs','origin',prepared.distributionRef]);
    if (result.error || result.status !== 0 || result.stderr.length) fail('Cannot read distribution ref; do not repeat publication');
    const text = result.stdout.toString();
    if (!text) return null;
    const match = /^([a-f0-9]{40})\t([^\r\n]+)\n?$/u.exec(text);
    if (!match || match[2] !== prepared.distributionRef) fail('Invalid distribution remote read-back');
    return match[1];
  };
  const before = observe();
  if (before && before !== prepared.distributionCommit) fail('Installable tag already exists with different bytes; never overwrite it');
  if (before === prepared.distributionCommit) return {...prepared,published:true,alreadyPublished:true};
  // Do not retry this write, including after a transport error. The caller
  // receives only a structural result after the same native remote read-back.
  try { runGit(sourceRepository,['push','origin',`${prepared.distributionCommit}:${prepared.distributionRef}`]); }
  catch { /* An exception is uncertain, not permission for another push. */ }
  if (observe() !== prepared.distributionCommit) fail('Distribution publication uncertain; read back the exact ref before another decision');
  return {...prepared,published:true,alreadyPublished:false};
}

const HOOK_RELEASE_LOCK='hook-component.lock.json';
const distributionKeys=['schemaVersion','version','sourceCommit','sourceTag','distributionRef','distributionCommit','tree','sharedShellRevision','integritySha256'];
function readHookReleaseLock(repository, sourceCommit) {
  const entry=gitScalar(repository,['ls-tree',sourceCommit,'--',HOOK_RELEASE_LOCK]);
  if(!entry)return null;
  if(!/^100644 blob [a-f0-9]{40}\thook-component\.lock\.json$/u.test(entry))fail('Unsafe hook release lock');
  const lock=JSON.parse(gitBytes(repository,['show',`${sourceCommit}:${HOOK_RELEASE_LOCK}`]));
  if(!lock||Object.keys(lock).sort().join(',')!==[...distributionKeys].sort().join(',')||lock.schemaVersion!==1
    ||![lock.sourceCommit,lock.distributionCommit,lock.tree,lock.sharedShellRevision].every(value=>COMMIT.test(value??''))
    ||!/^v\d+\.\d+\.\d+$/u.test(lock.sourceTag??'')||!VERSION.test(lock.version??'')
    ||lock.distributionRef!==`refs/tags/hooks-v${lock.version}`||!/^[a-f0-9]{64}$/u.test(lock.integritySha256??''))
    fail('Invalid hook release lock');
  return lock;
}

/** A later MAIN release must retain the original hook release provenance,
 * not mint a new companion commit merely because the main source SHA changed.
 * The whole hook tree (including its inventory) must remain byte-identical.
 * A real hook/shell update removes the old lock and publishes a NEW immutable
 * component version through the same exact source gate and native publisher. */
export async function prepareHookDependency({sourceRepository=ROOT,shellRepository,outputDirectory,sourceCommit}) {
  const version=JSON.parse(gitBytes(sourceRepository,['show',`${sourceCommit}:plugins/${HOOK_PLUGIN_NAME}/plugin.json`])).version;
  const candidate=await preparePluginDistribution({sourceRepository,shellRepository,outputDirectory,sourceCommit,version,kind:'hooks'});
  const lock=readHookReleaseLock(sourceRepository,sourceCommit);
  if(!lock)return {mode:'publish',prepared:candidate};
  verifyLockedHookDependency({sourceRepository,shellRepository,sourceCommit,prepared:lock});
  return {mode:'retained',prepared:lock};
}

function verifyLockedHookDependency({sourceRepository,shellRepository,sourceCommit,prepared}) {
  const lock=readHookReleaseLock(sourceRepository,sourceCommit);
  if(!lock||distributionKeys.some(key=>lock[key]!==prepared?.[key]))fail('Hook release provenance differs from its tracked lock');
  gitBytes(sourceRepository,['merge-base','--is-ancestor',lock.sourceCommit,sourceCommit]);
  if(gitScalar(sourceRepository,['rev-parse',`${lock.sourceTag}^{commit}`])!==lock.sourceCommit)
    fail('Hook source tag differs from its locked source');
  const expected=expectedDistribution(sourceRepository,shellRepository,sourceCommit,lock.version,'hooks');
  if(writeDistributionTree(sourceRepository,expected.treeFiles)!==lock.tree
    ||sha256(expected.files.get('package-integrity.json').bytes)!==lock.integritySha256
    ||expected.lock.revision!==lock.sharedShellRevision
    ||writeDistributionCommit(sourceRepository,lock,'hooks')!==lock.distributionCommit
    ||gitScalar(sourceRepository,['rev-parse',`${lock.distributionCommit}^{tree}`])!==lock.tree)
    fail('Stable hook bytes changed; publish a new hook component requiring native review');
}

export async function publishHookDependency({sourceRepository=ROOT,shellRepository,sourceCommit,dependency,runGit=runDistributionGit}) {
  if(!dependency||Object.keys(dependency).sort().join(',')!=='mode,prepared')fail('Invalid hook dependency release');
  if(dependency.mode==='publish'){
    if(readHookReleaseLock(sourceRepository,sourceCommit)!==null||dependency.prepared?.sourceCommit!==sourceCommit)
      fail('A locked hook component cannot be republished by a main release');
    return publishPluginDistribution({sourceRepository,shellRepository,prepared:dependency.prepared,runGit});
  }
  if(dependency.mode!=='retained')fail('Invalid hook dependency release mode');
  verifyLockedHookDependency({sourceRepository,shellRepository,sourceCommit,prepared:dependency.prepared});
  const result=runGit(sourceRepository,['ls-remote','--refs','origin',dependency.prepared.distributionRef]);
  if(result.error||result.status!==0||result.stderr.length
    ||result.stdout.toString().trim()!==`${dependency.prepared.distributionCommit}\t${dependency.prepared.distributionRef}`)
    fail('Locked hook distribution remote read-back failed');
  return {...dependency.prepared,published:true,alreadyPublished:true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--shell-repo' || args[2] !== '--output') {
    console.error('Usage: node scripts/build-plugin.mjs --shell-repo PATH --output ABSOLUTE_NEW_DIRECTORY');
    process.exitCode = 2;
  } else {
    try {
      const result = await buildPlugin({ shellRepository: args[1], outputDirectory: args[3] });
      console.log(JSON.stringify({ plugin: result.plugin, version: result.version,
        payloadFiles: result.files.length, outputDirectory: args[3] }));
    } catch (error) {
      // Do not dump child-process stderr or the environment; the builder reads
      // only public source, but Git configuration may include unrelated URLs.
      console.error(error.code === 'EEXIST' ? 'Output already exists' : 'Plugin build failed: ' + error.message.split('\n')[0]);
      process.exitCode = 1;
    }
  }
}
