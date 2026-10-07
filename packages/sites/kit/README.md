# The kit

What a code page carries so it counts like a data page: views, clicks, forms and bookings in Sites, and leads into the door. Data pages (`/o/<slug>`) get all of this from their template. Copy-paste parts are in `head.html`.

## 1. Register the page

Deploy first, then register its live URL. The command prints the page id.

```sh
./bin/wren sites add --url https://example.pages.dev/compare --repo-path lander/src/pages/compare.astro --offer <offer id>
```

Run it again after a change: it updates the same page by URL.

## 2. The tag

In `<head>`, with the id from step 1:

```html
<script src="https://wrenautomation.com/o/__kit.js" data-page="PAGE_ID" defer></script>
```

It sends a view on load with the utm and referrer and keeps that first touch for the tab. It sets no cookie and sends nothing else about the visitor.

On a lander page that also runs `hit.ts`, which strips utm from the address bar, put the kit tag first.

## 3. Buttons

- `data-cta` on a click toward the form.
- `data-book` on a booking link.

## 4. The form

Use the form in `head.html` as is:

- `form[data-wren-form]`, with a hidden `page`;
- the fields `name`, `email`, `phone`, `note` and `sms_consent`;
- the trap field `website`, kept off screen;
- `data-thanks`, and a `.sent` line for the answer.

The kit posts it to `/o/__form`. Without script it still posts. It needs an email or a phone.

## 5. Links in

Send traffic through `/go/` so the source is counted:

- `https://wrenautomation.com/go/<channel>/<campaign>/<content>?to=/o/<slug>`
- Channels are in lander `src/data/links.json`. Their mediums are `paid` (`ads`), `organic` (`yt`, `li`, `x` and the rest) and `outreach` (`rec`, `sms`).
- For an ad, put the ad id last: `/go/ads/<campaign>/<ad id>?to=/o/<slug>`. That lands as `utm_content`, so Sites shows visits and forms per ad.
- `?to=` only takes our own paths. A code page on another host links in with its own utm.

## 6. Offer data

Take the name, promise, price and guarantee from lander `src/data/offers.json`, which is generated from wren `packages/offers`. Quote only what the offer says, and never hand-edit that file.
