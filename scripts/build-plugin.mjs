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
  'plugin.json', 'mcp.json', 'hooks/hooks.json',
  'skills/assistant-setup/SKILL.md', 'skills/assistant-task-worker/SKILL.md',
  'skills/assistant-task-worker/references/work-state.md',
]);
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
async function readSource(root) {
  const files = new Map();
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SOURCE_FILES.some((name) => name.startsWith(relative + '/'))) {
          fail(`Unexpected source directory: ${relative}`);
        }
        await visit(absolute, relative + '/');
      } else {
        if (!entry.isFile() || !SOURCE_FILES.includes(relative)) {
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
  if (files.size !== SOURCE_FILES.length) fail('Incomplete plugin source');
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
function pluginIntegrity(files, lock) {
  const manifest = JSON.parse(files.get('plugin.json').bytes.toString());
  if (manifest.name !== 'trelio-digital-assistant') fail('Unexpected plugin identity');
  const inventory = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, entry]) => ({ path: name, mode: entry.mode, size: entry.bytes.length,
      sha256: sha256(entry.bytes) }));
  return { schemaVersion: 1, plugin: manifest.name, version: manifest.version,
    sharedShell: lock, files: inventory };
}
const integrityFile = integrity => ({
  bytes: Buffer.from(JSON.stringify(integrity, null, 2) + '\n'), mode: 0o644,
});

export async function buildPlugin({ shellRepository, outputDirectory,
  sourceDirectory = path.join(ROOT, 'plugins/trelio-digital-assistant'),
  lockPath = path.join(ROOT, 'shared-shell.lock.json') }) {
  if (!shellRepository || !outputDirectory || !path.isAbsolute(outputDirectory)) {
    fail('Provide --shell-repo and an absolute --output directory');
  }
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const files = await readSource(sourceDirectory);
  for (const [name, entry] of readShell(shellRepository, lock)) files.set(name, entry);
  // Hash payload and modes, omitting timestamps and local absolute paths. The
  // manifest is an integrity inventory, not a publisher signature or admission.
  const integrity = pluginIntegrity(files, lock);
  files.set('package-integrity.json', integrityFile(integrity));

  // Reserve a new directory exclusively: an existing installation/output must
  // never be replaced, including after a failed concurrent build. Cleanup only
  // removes the directory this invocation successfully created.
  await fs.mkdir(outputDirectory, { mode: 0o755 });
  try {
    for (const [name, { bytes, mode }] of files) {
      const destination = path.join(outputDirectory, name);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      await fs.writeFile(destination, bytes, { flag: 'wx', mode });
      await fs.chmod(destination, mode);
    }
  } catch (error) {
    await fs.rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
  return integrity;
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

function distributionSource(repository, sourceCommit, version) {
  if (!COMMIT.test(sourceCommit ?? '') || !VERSION.test(version ?? '')
    || gitScalar(repository, ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceCommit
    || gitScalar(repository, ['rev-parse', '--verify', `refs/tags/v${version}^{commit}`]) !== sourceCommit
    || gitBytes(repository, ['status', '--porcelain', '--untracked-files=no']).length) fail('Distribution source must be the exact clean release commit');
  const lock = JSON.parse(gitBytes(repository, ['show', `${sourceCommit}:shared-shell.lock.json`]));
  const marketplace = JSON.parse(gitBytes(repository, ['show', `${sourceCommit}:.agents/plugins/marketplace.json`]));
  const entries = marketplace.plugins?.filter(entry => entry.name === 'trelio-digital-assistant');
  const distributionRef = `refs/tags/plugin-v${version}`;
  if (marketplace.name !== 'trelio-digital-assistants' || entries?.length !== 1
    || !entries[0].source || Object.keys(entries[0].source).sort().join(',') !== 'ref,source,url'
    || entries[0].source.source !== 'url' || entries[0].source.url !== DISTRIBUTION_REPOSITORY
    || entries[0].source.ref !== `plugin-v${version}`)
    fail('Marketplace must select the exact installable Git release');
  const files = new Map(SOURCE_FILES.map(name => [name, {
    bytes: gitBytes(repository, ['show', `${sourceCommit}:plugins/trelio-digital-assistant/${name}`]), mode: 0o644,
  }]));
  const manifest = JSON.parse(files.get('plugin.json').bytes);
  if (manifest.name !== 'trelio-digital-assistant' || manifest.version !== version) fail('Distribution release version differs from plugin manifest');
  return { lock, files, distributionRef };
}

function expectedDistribution(repository, shellRepository, sourceCommit, version) {
  const source = distributionSource(repository, sourceCommit, version);
  for (const [name, entry] of readShell(shellRepository, source.lock)) source.files.set(name, entry);
  const integrity = pluginIntegrity(source.files, source.lock);
  source.files.set('package-integrity.json', integrityFile(integrity));
  return { ...source, integrity };
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

function writeDistributionCommit(repository, {tree,sourceCommit,version,sharedShellRevision,integritySha256}) {
  const timestamp = gitScalar(repository, ['show','-s','--format=%ct',sourceCommit]);
  if (!/^\d+$/u.test(timestamp)) fail('Invalid release source timestamp');
  const message = `Installable trelio-digital-assistant ${version}\n\nSource: ${sourceCommit}\nSource tag: v${version}\nShared shell: ${sharedShellRevision}\nIntegrity SHA-256: ${integritySha256}\n`;
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
export async function preparePluginDistribution({ sourceRepository = ROOT, shellRepository, outputDirectory, sourceCommit, version }) {
  const expected = expectedDistribution(sourceRepository, shellRepository, sourceCommit, version);
  const integrity = await buildPlugin({shellRepository,outputDirectory,
    sourceDirectory:path.join(sourceRepository,'plugins/trelio-digital-assistant'),
    lockPath:path.join(sourceRepository,'shared-shell.lock.json')});
  if (JSON.stringify(integrity) !== JSON.stringify(expected.integrity)) fail('Builder output differs from the exact tagged source');
  for (const [name, entry] of expected.files) {
    if (!entry.bytes.equals(await fs.readFile(path.join(outputDirectory,name)))) fail('Builder payload changed after verification');
  }
  // Repeat the source check after asynchronous file I/O. A moved or modified
  // source cannot lend its release identity to an already prepared payload.
  distributionSource(sourceRepository,sourceCommit,version);
  const tree = writeDistributionTree(sourceRepository, expected.files);
  const integritySha256 = sha256(expected.files.get('package-integrity.json').bytes);
  const commit = writeDistributionCommit(sourceRepository,{tree,sourceCommit,version,sharedShellRevision:expected.lock.revision,integritySha256});
  return {schemaVersion:1,version,sourceCommit,sourceTag:`v${version}`,distributionRef:expected.distributionRef,
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
  const expected = expectedDistribution(sourceRepository,shellRepository,prepared.sourceCommit,prepared.version);
  if (prepared.sourceTag !== `v${prepared.version}` || prepared.distributionRef !== expected.distributionRef
    || prepared.sharedShellRevision !== expected.lock.revision || prepared.integritySha256 !== sha256(expected.files.get('package-integrity.json').bytes)
    || gitScalar(sourceRepository,['rev-parse',`${prepared.distributionCommit}^{tree}`]) !== prepared.tree
    || writeDistributionTree(sourceRepository,expected.files) !== prepared.tree
    // Also pin orphan parents, metadata and public provenance. Matching files
    // alone must not publish a caller-supplied commit/history under this name.
    || writeDistributionCommit(sourceRepository,prepared) !== prepared.distributionCommit) fail('Prepared distribution no longer matches its exact source');
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
