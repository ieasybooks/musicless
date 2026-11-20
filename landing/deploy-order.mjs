import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
export function liveCommit(status, version) {
  const versions = status.versions || [];
  if (versions.length !== 1 || versions[0].percentage !== 100) throw new Error('Production must have one version at 100%');
  const commit = version.annotations?.['workers/message'];
  if (!SHA.test(commit || '')) throw new Error('Live version must record a full commit SHA; follow the bootstrap instructions');
  return commit;
}
export function decide(candidate, live, isAncestor) {
  if (!SHA.test(candidate) || !SHA.test(live)) throw new Error('Expected full commit SHAs');
  if (candidate === live) return 'recheck';
  if (isAncestor(live, candidate)) return 'deploy';
  if (isAncestor(candidate, live)) return 'skip';
  throw new Error('Candidate and live commits have diverged; refusing to replace production');
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(command + ' failed: ' + (result.stderr || result.error || result.stdout));
  return result.stdout.trim();
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candidate = process.argv[2];
  if (!SHA.test(candidate || '')) throw new Error('Pass the full commit SHA');
  if (run('git', ['rev-parse', 'HEAD']) !== candidate) throw new Error('Checkout does not match the tested commit');
  const wrangler = './node_modules/.bin/wrangler';
  const status = JSON.parse(run(wrangler, ['deployments', 'status', '--json']));
  if (status.versions?.length !== 1 || status.versions[0].percentage !== 100) throw new Error('Production must have one version at 100%');
  const version = JSON.parse(run(wrangler, ['versions', 'view', status.versions[0].version_id, '--json']));
  const live = liveCommit(status, version);
  const action = decide(candidate, live, (base, head) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd: directory });
    if (![0, 1].includes(result.status)) throw new Error('Could not compare deployment history; fetch complete Git history');
    return result.status === 0;
  });
  console.log('Deployment action: ' + action + ' (candidate ' + candidate + ', live ' + live + ')');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'action=' + action + '\n');
}
