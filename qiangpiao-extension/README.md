# qiangpiao — Chrome extension (v0.1)

Compliant **Ticketmaster US** purchase helper. Helps you watch events, apply quantity / section prefs on the page, and move toward checkout faster. **You** complete queue, CAPTCHA, and the final pay click.

## What v1 does

1. **Watch list** (popup) — save event URLs with label, preferred quantity, section notes, price notes, optional onsale time, and outcome status.
2. **On-page assist** (Ticketmaster event pages) — floating panel to save prefs, highlight matching section/price UI, best-effort set quantity, and click a safe **Find tickets / Continue / Add to cart** control when present.
3. **Outcome logging** — mark Got tickets / Failed / Sold out on the event for your own tracking.

## What v1 does **not** do

- Jump or automate Ticketmaster queue / waiting room
- Solve CAPTCHA or bypass bot checks / rate limits
- Auto-submit payment or place an order
- Multi-account, proxies, or limit evasion
- Onsale push / email / SMS notifications
- Ticket transfer / friend handoff UI
- Non-US Ticketmaster sites

## Install (load unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `qiangpiao-extension/` (the folder that contains `manifest.json`)
5. Pin **qiangpiao** from the extensions puzzle menu if you want quick access

Works on Chromium Edge the same way via `edge://extensions`.

## How to use

### Watch list

1. Open the extension popup
2. Paste a `ticketmaster.com` event URL (or click **Add current tab** while on an event page)
3. Set quantity, preferred sections, price notes, optional onsale datetime
4. **Add to watch list**
5. Open / edit / remove items anytime; set status to Onsale, Limited, Sold out, Got tickets, or Failed

### On an event page

1. Visit a Ticketmaster US event page while logged into your account
2. The **qiangpiao** panel appears (bottom-right)
3. Confirm qty + section/price notes
4. Click **Save / update watch list** to pin the event
5. At onsale (after you pass queue/CAPTCHA yourself), click **Apply prefs + find tickets**
6. Review highlighted seats/filters, finish selection, and **pay manually**

## Permissions

- `storage` — persist watch list locally in your browser
- `activeTab` — read the current tab URL when you click **Add current tab**
- Host access to `ticketmaster.com` — inject the assist panel on event pages only

No remote servers. No account passwords. Data stays in `chrome.storage.local`.

## Folder layout

```
qiangpiao-extension/
  manifest.json          MV3 manifest
  background.js          Service worker (storage bootstrap)
  README.md
  icons/                 Extension icons
  shared/storage.js      Watch-list helpers
  popup/                 Watch-list UI
  content/               Ticketmaster page assist
```

## Known limits

- Ticketmaster’s DOM changes often; quantity auto-fill and control detection are **best-effort**. If a control is not found, use the highlighted hints and click manually.
- The assist panel shows on likely event / ticket pages under `ticketmaster.com`. Some marketing or account pages will not show it.
- Countdown status uses the onsale datetime **you** enter; the extension does not scrape live inventory APIs.
- SPA navigations are polled lightly; if the panel looks stale after in-site navigation, refresh the page.
- Respect each event’s posted ticket limit. Default quantity UX is a convenience only.

## Compliance reminder

qiangpiao is an **in-page assistant for your logged-in session**. Getting tickets is the goal; skipping protections or auto-paying is out of scope and intentionally unimplemented.
