# Deploying pdf.harrys.monster

The site is static: HTML, CSS, ES modules and three vendored libraries. No build
step, no server code, nothing to configure at runtime.

**Nothing here has been done yet.** The repository is local only. Publishing is
a decision, not a step.

## 1. Push the repository

```bash
gh repo create pdf.harrys.monster --public --source=. --remote=origin --push
```

Public is a choice. The site itself carries no secrets, but a public repo means
the fixture-free history and every commit message goes with it.

## 2. Create the Cloudflare Pages project

In the Cloudflare dashboard, Workers & Pages → Create → Pages → Connect to Git,
and pick the new repository.

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `/` |
| Root directory | `/` |

An empty build command is what you want. Pages serves the repository as-is.

## 3. Add the custom domain

Pages project → Custom domains → Set up a custom domain → `pdf.harrys.monster`.
`harrys.monster` already runs on Cloudflare nameservers, so Cloudflare writes the
CNAME itself and issues the certificate. Nothing to add at the registrar.

## 4. Confirm the headers arrived

```bash
curl -sI https://pdf.harrys.monster | grep -i 'content-security-policy'
```

Pages applies `_headers` automatically for any file it serves. There is no
setting for it, and no way to test it from `python3 -m http.server`, which sends
no headers at all.

## The CSP, and how to test it locally

`_headers` sets a strict policy. Task 11 exercised it for the first time by
serving the site through a small Node server that reads `_headers` and applies
every line, then walking all nine tools in Chromium. Everything passed, and the
run included two controls that failed as they should: a `fetch()` to
`example.com` and an injected inline `<script>`, both blocked.

What the policy has to allow, and why:

| Directive | Needed by |
|---|---|
| `worker-src 'self' blob:` | the pdf.js worker, which every thumbnail and page render goes through |
| `img-src 'self' data: blob:` | the favicon (a `data:` SVG) and the signature preview (`blob:`) |
| `style-src … 'unsafe-inline'` | inline `style` properties written by `sign.js` and `reorder.js` |
| `style-src … fonts.googleapis.com` and `font-src fonts.gstatic.com` | the two web fonts |

Downloads are not affected. Clicking an `<a download>` pointing at a `blob:` URL
is not a fetch or a navigation the CSP governs, and all nine tools delivered
their file with the policy on.

If you ever self-host the fonts (see below), `font-src` must become `'self'` and
the `fonts.googleapis.com` entry in `style-src` can go.

To re-run the local check, serve the directory with a server that applies
`_headers` rather than `python3 -m http.server`, load the site, and watch the
console while you use each tool. A CSP failure shows up there and nowhere else.

## Open decision: the fonts contradict the privacy line

`index.html` loads Space Grotesk and JetBrains Mono from Google. Every visit
therefore tells Google someone loaded this page, along with their IP address and
user agent, while the footer says nothing leaves your device. The claim about
files stays true. The visit does not.

Self-hosting both fonts removes the requests and keeps the design identical. It
costs roughly 200-400 KB of woff2 in the repository, one `@font-face` block, and
a deviation from "reuse the harrys.monster CSS verbatim" that will need
repeating whenever that CSS changes.

Left for you to decide.
