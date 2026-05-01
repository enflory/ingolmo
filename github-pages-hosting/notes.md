# Research Notes: Building and Hosting a Website on GitHub Pages

**Date:** 2026-05-01  
**Branch:** claude/github-pages-research-Cy9Xt

## Prior work
No related prior research found in this repo.

## Research plan
1. GitHub Pages fundamentals, limits, deployment options
2. Static site generators compatible with GitHub Pages
3. Custom domains and HTTPS
4. GitHub Actions workflows for deployment
5. Gotchas and advanced patterns

---

## Session log

### Round 1 — parallel web searches

Searched simultaneously for:
- GitHub Pages official docs (limits, bandwidth, storage, pricing)
- Deployment options (branch vs. Actions)
- Best static site generators for GitHub Pages in 2026
- Custom domain + HTTPS setup

**Key findings from round 1:**

Limits (soft, not hard):
- Repo size: 1 GB recommended
- Published site: 1 GB max
- Bandwidth: 100 GB/month
- Builds: 10 per hour
- Build timeout: 10 minutes

Pricing: Free for public repos. Private repos require GitHub Pro/Team/Enterprise.

Deployment has two modes:
- "Deploy from a branch" — serves files from gh-pages, main, or /docs. For pure static files or auto-Jekyll builds.
- "GitHub Actions" — recommended. Any SSG, full control.

Best SSGs in 2026 per search:
- Jekyll: native GH Pages support but locked to 3.x + whitelist of plugins
- Hugo: fastest (Go), handles huge sites, needs Actions
- Astro: islands architecture, zero JS by default, great for modern static sites
- Next.js: needs `output: 'export'` for static mode; overkill for pure static
- Eleventy: Jekyll alternative in JS ecosystem

---

### Round 2 — SPA gotchas + Jekyll limits + Actions workflow YAML

**SPA routing (big gotcha):**
GitHub Pages doesn't understand client-side routing. Direct navigation to /about on a React Router app returns 404. Three workarounds:
1. HashRouter (ugly URLs with #)
2. Custom 404.html that redirects to index.html with query-string encoding (hacky, bad for SEO)
3. Pre-render all routes at build time (best approach — use SSG mode)

**Jekyll limits:**
- Auto-build uses Jekyll 3.x (GitHub lags behind), not Jekyll 4+
- Only whitelisted plugins run in safe mode: jekyll-seo-tag, jekyll-sitemap, jekyll-paginate, jekyll-redirect-from, jekyll-feed, etc.
- Any non-whitelisted plugin silently fails or errors
- Workaround: use GitHub Actions to build with any Jekyll version + any plugin
- To disable Jekyll entirely: add `.nojekyll` file to root

**GitHub Actions workflow (canonical modern pattern):**

Required permissions:
```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

Required concurrency (prevents race conditions):
```yaml
concurrency:
  group: "pages"
  cancel-in-progress: false
```

Three key actions:
1. `actions/configure-pages@v5` — gathers metadata, sets base_url output
2. `actions/upload-pages-artifact@v3` — packages the output dir as a gzip'd tar
3. `actions/deploy-pages@v4` — triggers the actual deployment

Full minimal YAML (pure static, no build step):
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: "pages"
  cancel-in-progress: false
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

### Round 3 — Astro config, Hugo workflow, custom domains, plan tiers, alternatives

**Astro base path (project pages):**
- User/org repos (`username.github.io`): no base needed
- Project repos (`username.github.io/my-repo`): must set `base: '/my-repo'` in astro.config.mjs
- All internal links must be prefixed with base value

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
export default defineConfig({
  site: 'https://username.github.io',
  base: '/my-repo',
})
```

**Hugo baseURL:**
Best practice: don't hardcode it; let the Actions workflow set it dynamically:
```bash
hugo --gc --minify --baseURL "${{ steps.pages.outputs.base_url }}/"
```
This avoids hardcoding project vs. user page URLs.

**Custom domains:**
- Apex domain: 4 A records → 185.199.108.153, .109.153, .110.153, .111.153
- www subdomain: CNAME → username.github.io
- Set custom domain in Settings > Pages → creates CNAME file in repo
- HTTPS: auto-provisioned via Let's Encrypt, can take up to 1 hour
- Gotcha: extra AAAA/A records or conflicting CNAMEs can block cert generation

**Plan tiers:**
- Free: public repos only
- Pro ($4/mo): public + private repos
- Team: public + private
- Enterprise Cloud: public + private + private site publishing (restricted access via SSO)

**Alternatives in 2026:**
| Platform | Free bandwidth | Edge nodes | Serverless | Best for |
|---|---|---|---|---|
| GitHub Pages | 100 GB | Few | No | OSS projects, portfolios |
| Cloudflare Pages | Unlimited | 300+ | Workers | Performance-critical sites |
| Vercel | 100 GB | Many | Yes | Next.js apps |
| Netlify | ~30 GB (credit) | Some | Yes | Jamstack CMS sites |

- Netlify cut free build minutes from 300→100 in 2025
- Cloudflare Pages added Docker container support in 2026
- Vercel added Fluid Compute in 2026 for optimized serverless functions

**Commercial use rules:**
- Not allowed: e-commerce, SaaS, online business primarily driving commercial transactions
- Allowed: portfolios, docs, personal sites, donation buttons, open source project sites
- Gray area: consult GitHub Support if unsure

---

### Surprises / dead ends
- WebFetch returning 403 for most targets (docs.github.com, astro.build, gohugo.io) — relied on search result summaries instead
- Hugo 0.160.0 and Dart Sass 1.99.0 are current as of early 2026 per search results
- GitHub Pages still at Jekyll 3.x for auto-build — no Jekyll 4 support in sight after years of waiting

---

### Open questions
- Exact Jekyll whitelist as of 2026 (could differ from my list — check github/pages-gem for authoritative list)
- Whether `actions/configure-pages@v5` is the latest version (was v4 in some examples; v5 appeared in search text)

