# The OrbiTutor website

The one-page website is in `website/` (issue 22, phase B2). It is plain HTML and CSS. It has no build step, no scripts, no cookies and no external requests.

## Files

- `website/wrangler.jsonc`: the Cloudflare Workers config. It is an assets-only Worker (no script) that serves `website/public/`. Cloudflare returns `404.html` for a page that does not exist.
- `website/public/index.html`: the page.
- `website/public/404.html`: the "Page not found" page.
- `website/public/style.css`: the styles. The colors are the Grove palette (issue 22, phase C). Light and dark mode follow the system setting.
- `website/public/assets/orbitutor-logo.svg`: the logo and the favicon. Phase D can replace it with the final icon file.
- `website/public/_headers`: the response headers (the Content Security Policy, the referrer policy and others). Cloudflare reads this file and does not serve it. Do not add comment lines to it.
- `tests/website.test.ts`: checks the local links and files, the absence of external loads, the demo clip attributes, the AGPL notice, the LearnHarness credit, the link to the author's page, the headers and WCAG AA contrast.

## Preview

1. Start a local server:

   ```bash
   python3 -m http.server 8765 --directory website/public --bind 127.0.0.1
   ```

2. Open `http://127.0.0.1:8765/`.

## Proposed host: Cloudflare Workers (static assets)

Nothing is deployed. The user chose Cloudflare (2026-11-24). Cloudflare tells new projects to use Workers, not Pages, so the site uses an assets-only Worker. Requests for static files are free. The limits are 25 MiB for each file and 20,000 files.

When the user approves a deploy:

1. In the Cloudflare dashboard, open Workers & Pages and create an application from the `cnovelles/learnharness-mobile` GitHub repository (Workers Builds).
2. Use the Worker name `orbitutor-website`. It must be the same as `name` in `website/wrangler.jsonc`.
3. Set the root directory to `website`. Leave the build command empty. Keep the deploy command `npx wrangler deploy`.
4. Set the production branch to `master`. Other branches get a preview URL.
5. Add the custom domain (for example `orbitutor.com`) after the user registers it. Cloudflare gives HTTPS for the domain.

Check the field names in the dashboard when you do this. They come from the Cloudflare docs of 2026-11-24.

## Demos (screenshots and short clips)

Each project page shows the real app, like the LearnHarness site. Use the same rules for each project.

- Put the files in `website/public/media/`.
- Use only test data, for example the golden test data. Never record the user's real courses.
- Screenshots: WebP or PNG, with alt text that says what the screen shows.
- Clips: MP4 (H.264), 5–15 seconds, no sound, about 2–5 MB each. The limit is 25 MiB for each file. Put longer videos on YouTube as a link, or on Cloudflare R2.
- Record the iPhone app in the Simulator with `xcrun simctl io booted recordVideo demo.mov`. Record the Mac app with the macOS screen recorder (Shift-Command-5). Convert and shrink the result to MP4.
- Show a clip with this markup. It needs no script, and it respects the page's Content Security Policy (`media-src 'self'`):

  ```html
  <figure class="demo">
    <video
      src="media/teach.mp4"
      poster="media/teach.webp"
      autoplay
      muted
      loop
      playsinline
      preload="none"
      width="1280"
      height="800"
    ></video>
    <figcaption>A lesson step on the iPhone.</figcaption>
  </figure>
  ```

- The poster image shows before the clip loads, and for visitors who turn off autoplay. The test fails if a clip has no `muted`, `playsinline` or `poster`.

## Rules for changes

- Do not add a store link or a download URL before the release exists. When the App Store listing exists, change the test that blocks store links in the same commit.
- Keep the LearnHarness credit in the About section and the footer, and keep the AGPL notice and the source links.
- Keep the footer link to the author's page (`https://www.christiangonzalezlopez.com`). It lists the other projects.
- Do not add scripts, analytics, web fonts or other external resources.
- Run `npx jest tests/website.test.ts` after each change.
