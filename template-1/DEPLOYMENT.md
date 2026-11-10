# European SME — deployment checklist

Things to do when the new design moves from the GitHub demo to the live site.

## 1. Cloudflare location detection (country opens first)

The site already has the code. It needs Cloudflare in front of the domain to work.

- [ ] Put europeansme.eu behind Cloudflare with the DNS records **proxied** (orange cloud). Location detection does not work on "DNS only" records.
- [ ] Check it works: open `https://europeansme.eu/cdn-cgi/trace` and look for a line `loc=XX` (your two-letter country code).
- [ ] Nothing else to configure. `support.js` reads that `loc=` value. It picks the visitor's country in this order:
  1. a `?country=de` link (always wins, handy for testing and campaigns)
  2. the country the visitor picked before (saved in their browser)
  3. Cloudflare's location (`/cdn-cgi/trace`)
  4. the browser's language region (for example `de-DE`), used as a fallback when Cloudflare is not in front
- [ ] Visitors outside the 27 EU countries get no auto-selection. They see the country picker.
- [ ] If WordPress ever renders pages server-side by country, read the `CF-IPCountry` request header (enabled under Network → IP Geolocation). Then set the cache to vary by country, or keep the personalisation in the browser as it is now. The current approach is cache-safe.
- [ ] Do **not** redirect visitors by country. Search engines crawl from the US and would never see the country pages. Open the right hub on the page and keep URLs the same for everyone.

## 2. Where the country is auto-selected (already built)

- [ ] Header top bar: country pill (flag + name, links to that country's hub)
- [ ] Homepage: "Today in {country}" strip with that country's latest news
- [ ] Articles page: Country filter preselected ("Latest in Germany")
- [ ] Countries page: the visitor's country is highlighted with an "Open hub" shortcut
- [ ] Country hub: opens on the visitor's country when no country is in the link
- [ ] VAT calculator: "country you sell into" preselected
- [ ] E-invoicing checker: "where is your business established" preselected
- [ ] Compliance Calendar: filtered to the visitor's country when it is one of the listed countries
- [ ] Every auto-selected tool shows a small "Set from your location" note so the visitor knows they can change it

## 3. Content set-up in WordPress before launch

- [ ] Merge the 34 categories into the 7 topics (keep the detail as sub-categories)
- [ ] Add a **Country** taxonomy: 27 countries + "EU-wide"
- [ ] Add a **Type** taxonomy: News, Guide, Explainer, Interview
- [ ] Tag the existing 50 posts. Most are EU-wide guides.
- [ ] Make topic, country and type required before publishing
- [ ] Daily news desk: check each country's sources every day and publish only when there is real news. A day with nothing newsworthy gets no post, and the pages skip that day.
- [ ] Replace the sample news in `support.js` (`NEWS_TPL`, `EU_NEWS`) with a WordPress REST query for posts of type News, filtered by country
- [ ] Trending needs real view counts: add a view-counter plugin or connect Google Analytics, then replace the demo ranking in `ESME.trending`
- [ ] Remove the yellow "Sample data" banners and "Sample" labels

## 4. Other items before go-live

- [ ] Publish a privacy policy page (needed for newsletter sign-ups in the EU). Mention the country lookup and the saved country choice in it.
- [ ] Add the real social media profile links to the header top bar
- [ ] Self-host the flag images (they currently load from flagcdn.com)
- [ ] Re-check all tool data (VAT rates, e-invoicing dates, funding calls) against the official sources on launch day
