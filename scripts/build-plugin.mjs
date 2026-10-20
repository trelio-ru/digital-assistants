#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
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
]);
const MAX_FILE_BYTES = 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { throw new Error(message); };

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

export async function buildPlugin({ shellRepository, outputDirectory,
  sourceDirectory = path.join(ROOT, 'plugins/trelio-digital-assistant'),
  lockPath = path.join(ROOT, 'shared-shell.lock.json') }) {
  if (!shellRepository || !outputDirectory || !path.isAbsolute(outputDirectory)) {
    fail('Provide --shell-repo and an absolute --output directory');
  }
  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const files = await readSource(sourceDirectory);
  for (const [name, entry] of readShell(shellRepository, lock)) files.set(name, entry);
  const manifest = JSON.parse(files.get('plugin.json').bytes.toString());
  if (manifest.name !== 'trelio-digital-assistant') fail('Unexpected plugin identity');
  // Hash payload and modes, omitting timestamps and local absolute paths. The
  // manifest is an integrity inventory, not a publisher signature or admission.
  const inventory = [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, entry]) => ({ path: name, mode: entry.mode, size: entry.bytes.length,
      sha256: sha256(entry.bytes) }));
  const integrity = { schemaVersion: 1, plugin: manifest.name, version: manifest.version,
    sharedShell: lock, files: inventory };
  files.set('package-integrity.json', {
    bytes: Buffer.from(JSON.stringify(integrity, null, 2) + '\n'), mode: 0o644,
  });

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
