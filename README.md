# PDF tools

A browser-based PDF toolkit: merge, split, compress, rotate, reorder, sign, resize to A4, convert images to PDF, and convert PDF pages to PNG/JPG.

Everything runs client-side. No file ever leaves your device, there is no backend and no upload.

## Stack

Plain HTML, CSS and JavaScript. No build step, no bundler, no framework. Browsers load the source files directly. PDF and image handling comes from vendored copies of `pdf-lib`, `pdf.js` and `jszip` under `vendor/`.

## Developing

Serve the project root with a static file server, since ES modules will not load over `file://`:

```bash
python3 -m http.server
```

Then open `http://localhost:8000`.

Run the test suite with:

```bash
npm test
```

## Deployment

Hosted on Cloudflare Pages. Build command: none. Output directory: `/`.
