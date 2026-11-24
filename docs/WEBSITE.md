# The OrbiTutor website

The one-page website is in `website/` (issue 22, phase B2). It is plain HTML and CSS. It has no build step, no scripts, no cookies and no external requests.

## Files

- `website/index.html`: the page.
- `website/style.css`: the styles. The colors are the Grove palette (issue 22, phase C). Light and dark mode follow the system setting.
- `website/assets/orbitutor-logo.svg`: the logo and the favicon. Phase D can replace it with the final icon file.
- `website/_headers`: the response headers for Cloudflare Pages (the Content Security Policy and the referrer policy). Other hosts ignore this file.
- `tests/website.test.ts`: checks the local links, the absence of external loads, the AGPL notice, the LearnHarness credit and WCAG AA contrast.

## Preview

1. Start a local server:

   ```bash
   python3 -m http.server 8765 --directory website --bind 127.0.0.1
   ```

2. Open `http://127.0.0.1:8765/`.

## Proposed host: Cloudflare Pages

Nothing is deployed. The user chose Cloudflare Pages as the proposal (2026-11-24). When the user approves a deploy:

1. In Cloudflare, create a Pages project and connect it to the `cnovelles/learnharness-mobile` repository.
2. Set the production branch to `master`.
3. Leave the build command empty. Set the build output directory to `website`.
4. Add the custom domain (for example `orbitutor.com`) after the user registers it. Cloudflare gives HTTPS for the domain.

Cloudflare reads `website/_headers` and sends its headers with each page.

## Rules for changes

- Do not add a store link or a download URL before the release exists.
- Keep the LearnHarness credit in the About section and the footer, and keep the AGPL notice and the source links.
- Do not add scripts, analytics, web fonts or other external resources.
- Run `npx jest tests/website.test.ts` after each change.
