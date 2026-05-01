# GitHub Pages: Building and Hosting a Website

**Researched:** 2026-05-01

## What is GitHub Pages?

GitHub Pages is a free static site hosting service built into GitHub. It serves HTML/CSS/JS directly from a repository. There is no server-side code execution — everything must be pre-built into static files.

## Types of GitHub Pages Sites

| Type | Repo name | URL | Notes |
|---|---|---|---|
| **User site** | `username.github.io` | `https://username.github.io` | One per account |
| **Organization site** | `orgname.github.io` | `https://orgname.github.io` | One per org |
| **Project site** | Any name | `https://username.github.io/repo-name` | One per repo, served at subpath |

**Critical implication:** Project sites live at a subpath. Static site generators that assume `/` as base URL will produce broken asset links. You must configure the base path in your SSG.

---

## Limits

All limits are soft (GitHub may throttle but not hard-block):

| Limit | Value |
|---|---|
| Repository size | 1 GB recommended |
| Published site size | 1 GB |
| Monthly bandwidth | 100 GB |
| Builds per hour | 10 |
| Build timeout | 10 minutes |

### Plan requirements

| Plan | Public repo | Private repo | Private site (access-restricted) |
|---|---|---|---|
| Free | ✓ | ✗ | ✗ |
| Pro ($4/mo) | ✓ | ✓ | ✗ |
| Team | ✓ | ✓ | ✗ |
| Enterprise Cloud | ✓ | ✓ | ✓ |

"Private site" means the published website itself requires authentication to access. Private repo just means the source code is hidden while the site remains public.

---

## Deployment Methods

### Method 1: Deploy from a branch (simplest)

1. Go to **Settings → Pages → Build and deployment**
2. Select **Source: Deploy from a branch**
3. Pick the branch (`main`, `gh-pages`) and folder (`/` or `/docs`)
4. Push files — GitHub serves them directly

This mode optionally runs Jekyll on your files automatically. To disable Jekyll processing, add a `.nojekyll` file to the root:
```bash
touch .nojekyll
git add .nojekyll && git commit -m "disable jekyll" && git push
```

Use this method when: you have pre-built static files, or you want the simplest possible setup.

### Method 2: GitHub Actions (recommended)

1. Go to **Settings → Pages → Build and deployment**
2. Select **Source: GitHub Actions**
3. Add a workflow file at `.github/workflows/deploy.yml`

GitHub Actions lets you run any build tool (Hugo, Astro, Webpack, etc.) before serving the output.

#### Minimal workflow (pure static, no build step)

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
          path: '.'        # directory containing your static files
      - id: deployment
        uses: actions/deploy-pages@v4
```

#### Two-job pattern (build then deploy)

Split into separate jobs when the build is heavy or you want to cache dependencies:

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
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
        id: pages
      # -- your build steps here --
      - uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'   # your SSG output directory

  deploy:
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**The three key actions:**
- `actions/configure-pages` — sets metadata, exposes `steps.pages.outputs.base_url`
- `actions/upload-pages-artifact` — packages the output directory as a gzip'd tar artifact
- `actions/deploy-pages` — triggers the actual Pages deployment

**Required permissions:** `pages: write` + `id-token: write`. The `id-token` is used by deploy-pages to authenticate with GitHub's deployment API.

**Concurrency block:** prevents two simultaneous deployments from racing. `cancel-in-progress: false` lets in-flight deployments finish rather than aborting them.

---

## Static Site Generators

### Jekyll (built-in, no Actions required)

- GitHub auto-builds Jekyll sites when you push Markdown/HTML to the source branch
- Write content in Markdown + Liquid templates, configure `_config.yml`
- **Version lock:** GitHub runs Jekyll 3.x. Jekyll 4 is not supported in auto-build mode.
- **Plugin whitelist:** only these plugins work: `jekyll-seo-tag`, `jekyll-sitemap`, `jekyll-paginate`, `jekyll-redirect-from`, `jekyll-feed`, `jekyll-mentions`, `jekyll-relative-links`, and a handful of others listed in the [pages-gem](https://github.com/github/pages-gem)
- **Workaround for plugin limits:** use GitHub Actions to build with your own `bundle exec jekyll build`, then deploy the output — this bypasses all restrictions

**Best for:** simple blogs, documentation, anyone comfortable with Ruby who doesn't need Jekyll 4 features.

### Hugo (recommended for content-heavy sites)

Hugo is written in Go and is by far the fastest SSG — builds thousands of pages in under a second.

Key config point: set `baseURL` dynamically from Actions rather than hardcoding it:
```bash
hugo --gc --minify --baseURL "${{ steps.pages.outputs.base_url }}/"
```

Example workflow build steps:
```yaml
- name: Setup Hugo
  uses: peaceiris/actions-hugo@v3
  with:
    hugo-version: '0.160.0'
    extended: true

- name: Build
  run: hugo --gc --minify --baseURL "${{ steps.pages.outputs.base_url }}/"
```

Output directory is `./public` by default; pass `path: './public'` to `upload-pages-artifact`.

**Best for:** blogs, documentation, large content sites, anything prioritizing build speed.

### Astro (recommended for modern component-based sites)

Astro's islands architecture ships zero JavaScript by default, adding client-side JS only for interactive components. Excellent performance and SEO out of the box.

`astro.config.mjs` for project pages:
```js
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://username.github.io',
  base: '/repo-name',   // omit if this is the username.github.io repo
})
```

All internal links must be prefixed with `import.meta.env.BASE_URL` or the configured `base` value — Astro handles this automatically in most cases.

Example workflow build steps:
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
- run: npm run build
```

Output directory is `./dist`; pass `path: './dist'` to `upload-pages-artifact`.

**Best for:** portfolios, marketing sites, component-driven content sites, anyone coming from React/Vue/Svelte.

### Next.js (static export mode)

Next.js requires static export mode to work with GitHub Pages:
```js
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/repo-name',   // for project pages
}
module.exports = nextConfig
```

Limitations in static export: no `getServerSideProps`, no API routes, no image optimization with default loader, no middleware.

**Best for:** teams already invested in Next.js/React who need a subset of static pages.

### Eleventy (11ty)

Simple, flexible Node.js SSG. Often described as "Jekyll implemented in JavaScript." No framework opinions — you bring your own templates (Nunjucks, Liquid, Handlebars, etc.).

**Best for:** developers who want a lightweight, unopinionated JS-based SSG.

### Zola / Hugo (for Rust/Go fans)

Zola is a Rust-based SSG with a single binary install (like Hugo) and fast build times. Similar sweet spot to Hugo.

---

## Custom Domains

### Apex domain (example.com)

Add four A records at your DNS provider pointing to GitHub's IP addresses:

```
@   A   185.199.108.153
@   A   185.199.109.153
@   A   185.199.110.153
@   A   185.199.111.153
```

### www subdomain

```
www   CNAME   username.github.io
```

If you set an apex domain as your custom domain, GitHub automatically serves `www.example.com` as well. Recommended: configure both and let GitHub redirect between them.

### Configuring in GitHub

1. **Settings → Pages → Custom domain**, type your domain, click Save
2. GitHub creates a `CNAME` file in your repo root
3. **Important:** commit this file to all branches you deploy from, or re-enter it after a redeployment wipes it

### HTTPS

GitHub automatically provisions a Let's Encrypt certificate once DNS propagates. This can take up to 1 hour after saving the custom domain. After provisioning, enable **"Enforce HTTPS"** in Settings.

**Common cert failure causes:**
- Extra A/AAAA records on the apex that GitHub didn't expect
- CNAME records conflicting with apex A records
- DNS hasn't propagated yet (wait and retry)
- Removing and re-adding the custom domain in Settings often unblocks a stuck cert

---

## Known Gotchas

### 1. SPA routing breaks on direct URL access

React Router, Vue Router, etc. rely on the browser never sending the full path to the server. GitHub Pages doesn't support this — navigating directly to `https://user.github.io/repo/about` returns 404.

**Solutions (best to worst):**
1. **Pre-render all routes** at build time (use SSG mode in Next.js, Astro, etc.) — the right answer
2. **Hash routing** (`#/about`) — works, but URLs are ugly and non-standard
3. **404.html redirect hack** — copy index.html to 404.html; JS on 404.html reconstructs the URL. Works but every direct URL briefly returns HTTP 404 (bad for SEO, some proxies)

### 2. Project page base path

Every project page is served at `username.github.io/repo-name/`. Asset paths like `/style.css` will 404. You must configure your SSG with the correct base path, or use relative paths everywhere.

### 3. Case sensitivity

GitHub Pages runs on Linux. URLs are case-sensitive. A link to `About.html` won't find `about.html`. Test on Linux or with a case-sensitive file system before deploying.

### 4. Jekyll processes files by default

Even non-Jekyll sites get processed by Jekyll unless you add `.nojekyll`. This is usually harmless but can cause issues with files containing Liquid-like syntax (`{{ }}`).

### 5. Jekyll plugin whitelist

If using auto-build Jekyll (no Actions), only whitelisted plugins work. Non-whitelisted plugins are silently skipped. Use GitHub Actions to build Jekyll if you need any plugin not on the whitelist.

### 6. Commercial use restrictions

GitHub Pages may not be used to run:
- E-commerce sites
- SaaS platforms
- Any site "primarily directed at facilitating commercial transactions"

Allowed: portfolios, documentation, personal blogs, open-source project sites, donation buttons.

### 7. No server-side code

GitHub Pages is 100% static. There is no PHP, Node.js, Python, databases, or any server-side execution. For dynamic behavior, you must call external APIs from client-side JavaScript.

### 8. 10 builds/hour soft limit

Rapid pushes (e.g., CI that commits generated files) can hit this. The `concurrency` block in your Actions workflow helps by not queuing redundant deployments.

---

## Alternatives in 2026

| Platform | Free bandwidth | Build mins (free) | Edge | Serverless | Best for |
|---|---|---|---|---|---|
| **GitHub Pages** | 100 GB | Via Actions minutes | Few | No | OSS projects, portfolios |
| **Cloudflare Pages** | Unlimited | 500/mo | 300+ PoPs | Workers (edge) | Performance, edge compute |
| **Vercel** | 100 GB | Generous | Many | Functions | Next.js, React frameworks |
| **Netlify** | ~30 GB | 100/mo (reduced 2025) | Some | Functions | Jamstack + CMS integrations |

**When to choose GitHub Pages:**
- You want zero external service dependencies
- It's an open-source project where the source and site live in the same repo
- The site is simple (portfolio, docs, blog)
- You want the cheapest possible option for non-commercial sites

**When to choose Cloudflare Pages:**
- You need better global performance
- You need edge compute (Workers) alongside static assets
- Unlimited bandwidth matters (media-heavy sites)

**When to choose Vercel:**
- You're using Next.js
- You need server-side rendering or API routes

---

## Quick-start Decision Tree

```
Is your site purely static files with no build step?
  └─ Yes → Deploy from branch (simplest possible)
  └─ No  → Use GitHub Actions

Which SSG?
  ├─ I want zero setup, Markdown content, Ruby is fine → Jekyll (auto-build)
  ├─ I want fastest builds, large content site → Hugo
  ├─ I want modern components, React/Vue/Svelte → Astro
  ├─ I'm already using Next.js → Next.js with output: 'export'
  └─ I want JS ecosystem, no framework opinions → Eleventy

Do I need a custom domain?
  └─ Yes → Buy domain, add A records, set in Settings, wait for HTTPS cert
```

---

## Sources

- [GitHub Pages limits — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Configuring a publishing source — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Using custom workflows with GitHub Pages — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Managing a custom domain — GitHub Docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Securing your GitHub Pages site with HTTPS — GitHub Docs](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [About GitHub Pages and Jekyll — GitHub Docs](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll)
- [GitHub Terms for Additional Products — GitHub Docs](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
- [Deploy to GitHub Pages — Astro Docs](https://docs.astro.build/en/guides/deploy/github/)
- [Host on GitHub Pages — Hugo Docs](https://gohugo.io/host-and-deploy/host-on-github-pages/)
- [actions/deploy-pages — GitHub](https://github.com/actions/deploy-pages)
- [actions/upload-pages-artifact — GitHub](https://github.com/actions/upload-pages-artifact)
- [Making GitHub Pages Work With Jekyll 4+](https://www.moncefbelyamani.com/making-github-pages-work-with-latest-jekyll/)
- [GitHub Pages SPA 404 routing discussion](https://github.com/orgs/community/discussions/64096)
- [GitHub Pages: Branch Deployment vs GitHub Actions — BSWEN](https://docs.bswen.com/blog/2026-04-16-github-pages-deployment-comparison/)
- [Cloudflare Pages vs Netlify vs Vercel (2026) — DanubeData](https://danubedata.ro/blog/cloudflare-pages-vs-netlify-vs-vercel-static-hosting-2026)
- [Top 12 Static Site Generators 2026 — Hygraph](https://hygraph.com/blog/top-12-ssgs)
