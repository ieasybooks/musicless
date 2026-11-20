// One-time creation before Terraform can scope a token to this Worker's tag.
// Public workers.dev and preview URLs stay disabled; Terraform adds the domain.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
git(['diff', '--exit-code']);
git(['diff', '--cached', '--exit-code']);
git(['fetch', 'origin', 'main']);
const commit = git(['rev-parse', 'origin/main']);
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('Use the infrastructure vault wrapper to supply the bootstrap token');
const response = await fetch('https://api.cloudflare.com/client/v4/accounts/aaed7434338705aa46de5e4e3575e02b/workers/scripts/musicless-web/settings', {
  headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
  signal: AbortSignal.timeout(30000),
});
if (response.status !== 404) throw new Error(response.ok
  ? 'musicless-web already exists; use the normal deployment workflow'
  : 'Could not verify that musicless-web is absent (HTTP ' + response.status + ')');
// Build the current main site's source with these deployment tools. This lets
// infrastructure be ready before this PR merges and starts its first CI deploy.
const temporary = mkdtempSync(join(tmpdir(), 'musicless-bootstrap-'));
try {
  const checkout = join(temporary, 'source');
  execFileSync('git', ['clone', '--shared', '--no-checkout', root, checkout], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', commit], { cwd: checkout, stdio: 'inherit' });
  const landing = join(checkout, 'landing');
  mkdirSync(landing, { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'wrangler.jsonc', 'release.mjs', 'check.mjs']) {
    copyFileSync(join(directory, file), join(landing, file));
  }
  // Dependency installation and builds do not need the infrastructure token.
  const buildEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete buildEnv.CLOUDFLARE_API_TOKEN;
  const run = (command, args, cwd = checkout) => execFileSync(command, args, { cwd, stdio: 'inherit', env: buildEnv });
  run('npm', ['ci', '--no-audit', '--no-fund']);
  run('npm', ['ci', '--no-audit', '--no-fund'], landing);
  run(process.execPath, ['release.mjs'], landing);
  run(process.execPath, ['check.mjs', '--model-only'], landing);
  console.log('Bootstrapping the main site at ' + commit);
  // A new Worker can take a moment to appear in Cloudflare's settings API
  // after its assets are uploaded. Retrying this same initial build is safe.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawnSync('./node_modules/.bin/wrangler', ['deploy', '--message', commit, '--tag', commit.slice(0, 12)], {
      cwd: landing, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    if (result.error) throw result.error;
    if (result.status === 0) break;
    if (attempt === 3) throw new Error('Initial Worker deployment failed');
    await setTimeout(2000);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('Worker created. Apply Terraform and store its scoped token, then merge the website PR to deploy automatically.');
