# OP Box Index Security Policy

## Sensitive Data

- Never commit eBay `Client Secret`, GitHub tokens, API keys, passwords, AdSense private data, or analytics account access.
- Keep local credentials in `.env`.
- Keep production credentials in GitHub Actions repository secrets.
- Do not paste secrets into handoff documents, screenshots, commits, issues, or logs.

## eBay API

- eBay API calls must run only from local scripts or GitHub Actions.
- The public website must not call eBay APIs directly from browser JavaScript.
- The site should publish only sanitized JSON results and public listing URLs.
- Rotate the eBay client secret immediately if it appears in a screenshot, chat, commit, or log.

## Affiliate Links

- eBay Partner Network parameters are public tracking parameters and may appear in rendered links.
- Keep the visible disclosure near eBay links:
  - `Paid Link`
  - Buyer must verify seller, shipping, taxes, authenticity, and reseal risk.
- Do not hide or remove affiliate disclosure text.

## Static Site Hardening

- Use `rel="noopener noreferrer sponsored"` for external paid links.
- Do not add third-party scripts unless they are required for Google Analytics, Google AdSense, or trusted product images.
- Keep all secrets out of HTML, JavaScript, JSON, and source maps.
- If the site moves to a server platform later, add security headers at the HTTP layer:
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy`
  - `Permissions-Policy`

## Before Deploy

Run these checks before pushing:

```powershell
git status --short
rg -n "(SECRET|TOKEN|PASSWORD|CLIENT_SECRET|EBAY_CLIENT_SECRET|sk-|BEGIN PRIVATE)" -S .
node --check packs.js
node tools/audit-active-listings.js
```

## Incident Response

1. Rotate the exposed secret first.
2. Replace the value in GitHub Secrets and local `.env`.
3. Check commits and logs for remaining exposure.
4. If needed, invalidate or delete the compromised credential in the provider dashboard.
