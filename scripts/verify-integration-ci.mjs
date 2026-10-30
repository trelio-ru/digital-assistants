import {verifyHosted} from '@trelio/git-coordinator/hosted-ci';
const [mode, sha] = process.argv.slice(2);
if (mode !== '--prepare' || !/^[a-f0-9]{40}$/u.test(sha ?? '')) throw Error('Use --prepare SHA');
await verifyHosted(process.cwd(), sha, [{"file": "plugin-tests.yml", "jobs": ["Plugin package (ubuntu-latest)", "Plugin package (macos-latest)", "Plugin package (windows-latest)"]}], {prepare: true});
