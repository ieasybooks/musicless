// One-time creation before Terraform can scope a token to this Worker's tag.
// Public workers.dev and preview URLs stay disabled; Terraform adds the domain.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
if (git(['branch', '--show-current']) !== 'main') throw new Error('Bootstrap from main after merging the deployment PR');
git(['diff', '--exit-code']);
git(['diff', '--cached', '--exit-code']);
git(['fetch', 'origin', 'main']);
const commit = git(['rev-parse', 'HEAD']);
if (commit !== git(['rev-parse', 'origin/main'])) throw new Error('Update main before bootstrapping');
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('Use the infrastructure vault wrapper to supply the bootstrap token');
const response = await fetch('https://api.cloudflare.com/client/v4/accounts/aaed7434338705aa46de5e4e3575e02b/workers/scripts/musicless-web/settings', {
  headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
  signal: AbortSignal.timeout(30000),
});
if (response.status !== 404) throw new Error(response.ok
  ? 'musicless-web already exists; use the normal deployment workflow'
  : 'Could not verify that musicless-web is absent (HTTP ' + response.status + ')');
await import('./release.mjs');
const { checkModel, release } = await import('./check.mjs');
await checkModel((await release()).model);
execFileSync('./node_modules/.bin/wrangler', ['deploy', '--message', commit, '--tag', commit.slice(0, 12)], {
  cwd: directory, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
console.log('Worker created. Apply the companion Terraform configuration and store its scoped token before enabling automated deployment.');
