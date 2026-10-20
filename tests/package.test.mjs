import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPlugin, SHELL_FILES } from '../scripts/build-plugin.mjs';
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
    options: (name, extra = {}) => ({ shellRepository: repository, lockPath,
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
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin.json')));
  const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp.json')));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['trelio-assistant']);
  const server = mcp.mcpServers['trelio-assistant'];
  assert.deepEqual(server.args.slice(1), ['bridge', 'assistant', 'mcp']);
  assert.equal(server.type, 'stdio');
  assert.ok((await fs.stat(path.resolve(root, server.command))).isFile());
  assert.ok((await fs.stat(path.resolve(root, server.args[0]))).isFile());
  const extension = manifest.extensions['com.openai'];
  assert.ok((await fs.stat(path.resolve(root, extension.onboardingSkill))).isFile());
  const hooks = JSON.parse(await fs.readFile(path.resolve(root, extension.hooks)));
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
