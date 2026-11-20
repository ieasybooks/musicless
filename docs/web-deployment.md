# Website deployment

The website at `musicless.ieasybooks.com` is served by the static assets of
`musicless-web`. There is no server-side Worker script: audio processing stays
in the browser. The model remains in the existing R2 bucket.

This repo owns the assets, Wrangler settings and deployment workflow.
`ieasybooks/infrastructure` owns the custom domain, its dedicated Cloudflare
token and vault rules. Do not also put the domain in Wrangler or manage the
Worker script/assets in Terraform.

## Build and check

Use Node.js 24 from the repository root:

```sh
npm ci
npm ci --prefix landing
npm --prefix landing run build
npm --prefix landing test
npm --prefix landing run deploy:check
npm --prefix landing run test:hosting
npm --prefix landing run check:model
```

The landing package pins Wrangler independently of the extension's tools.
Its release build calls the normal `landing/build.mjs`, then adds a 404 page,
headers and `release.json` with the commit and each file's checksum. It rejects
assets over Cloudflare's 25 MiB limit and bundled ONNX models. When the audio
tool is present, it records its model URL and hash for the R2 check.

Hosting tests start local Wrangler on an available loopback port and stop it
when finished. They check every published file, the English/Arabic paths,
redirects, MIME types (including JavaScript modules and WASM when present),
cache headers and missing pages/assets. The model check downloads and verifies
the exact R2 model, including CORS and immutable caching, before deployment.

Stable asset names revalidate in browsers so a deployment does not keep old
JavaScript or WASM cached. Cloudflare still caches the static files at its edge.
An unknown path returns a 404, not the homepage.
The responses also use `no-transform` to prevent automatic HTML changes,
including the parent zone's Web Analytics beacon injection. Live checks verify
the files' bytes and this header.

## One-time setup

Set up infrastructure before merging the website deployment PR. Every
successful main CI run deploys automatically; no enablement variable is needed.
The browser audio tool can merge separately: the hosting pipeline supports
the existing landing page as well as the page with MP3/M4A processing.

1. Keep Musicless on the clean deployment PR checkout. From the infrastructure
   repository, create the initial Worker:

   ```sh
   mise run vault:run INFRASTRUCTURE_CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN -- \
     node ../musicless/landing/bootstrap.mjs
   ```

   This checks the Worker does not exist, fetches Musicless main, and builds
   that main commit in a temporary checkout using this PR's deployment tools.
   It installs dependencies, checks the model if present, and deploys with
   the main commit recorded in the version message. `workers.dev` and preview
   URLs stay disabled; there is no public hostname until Terraform adds it.
   The initial creation needs the existing infrastructure credentials because
   Cloudflare's Individual Workers Editor token can only name an existing Worker.
2. Merge the companion infrastructure PR and update its local main. Run the
   normal full plan/review/apply workflow. This adds
   the domain, `MUSICLESS_WEB_DEPLOY_TOKEN` and the vault caller.
3. Save the generated token to the vault without printing it:

   ```sh
   mise run tf -- show -json \
     | jq -r '.values.root_module.resources[] | select(.address == "cloudflare_account_token.worker_deploy[\"MUSICLESS_WEB_DEPLOY_TOKEN\"]") | .values.value' \
     | mise run vault:set MUSICLESS_WEB_DEPLOY_TOKEN
   ```

4. Merge this website deployment PR. Its main CI run deploys after all checks
   pass. A manual rerun is also available:

   ```sh
   gh workflow run ci.yml --ref main --repo ieasybooks/musicless
   ```

The first CI deployment checks the already published bootstrap version or
deploys a newer main commit. It verifies the actual files served at the custom
domain. A request may need to wait briefly for the domain's certificate.

## Automatic deployments

On a push to main, or CI manually dispatched on main by AliOsm, the production
job waits for both the extension tests and the website hosting checks. It
builds exactly the tested commit, fetches its restricted token via
`ieasybooks/vault`, and deploys with the full commit SHA as its version message.

The token is unique to Musicless. It can edit only `musicless-web`, cannot
create/delete Workers, and has no access to other apps, R2 uploads or DNS.
The vault allows only `ieasybooks/musicless`, main, `ci.yml`, push/manual
events, AliOsm and the `production` environment. PR jobs never receive it.
Other actors' pushes still run tests but do not deploy; Ali can dispatch CI
on main afterwards.

Main CI runs are serialized and a new push does not interrupt a deployment.
Before uploading, the job compares its commit with the live version: newer
commits deploy, the same commit only rechecks, and older queued/retried runs
skip. Diverged histories, missing commit metadata and split traffic fail for
inspection. A complete Git checkout is required for these ancestry checks.

Afterward, live checks compare `release.json` and every static file with the
build, with bounded retries for deployment propagation. Website deployment
does not publish an extension release or require another Terraform apply.

## Rollback

Revert the change on main and merge the revert; it passes checks and deploys
as a new commit. For an urgent rollback, an authorized operator can use
`npm --prefix landing run rollback` to select a previous version.
The next successful main deployment moves the site forward again. Keep the
model's old content-hashed R2 objects for pages that still reference them.
