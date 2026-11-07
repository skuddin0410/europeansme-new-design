# europeansme-new-design

Redesign concept for [europeansme.eu](https://europeansme.eu): a cleaner editorial look, new site sections, free tools for European SMEs, and three demo articles.

Live, clickable version (Claude Design canvas): https://claude.ai/artifact/MaCga5ikFmnCYBbSJBNMDh

## What's here

```
design/          One file per page or component (.dc.html), plus canvas.json (layout of the canvas)
docs/            DESIGN_REVIEW.md — review of the current site and the reasoning behind the redesign
```

### Pages

| File | What it is |
|---|---|
| `Main.dc.html` | Homepage (desktop) — cover story, newsletter, Tools strip, sections, most read |
| `Mobile.dc.html` | Homepage (mobile, 390 px) |
| `Article.dc.html` | Article page template (business plan guide) |
| `ArticleAIAct.dc.html` | Demo article — AI Act deadlines and the Digital Omnibus |
| `ArticleEInvoicing.dc.html` | Demo article — e-invoicing mandates 2026–2027 |
| `ArticleEUInc.dc.html` | Demo article — EU Inc. / the 28th regime |
| `Tools.dc.html` | Tools hub, EU Support Directory, alerts sign-up |
| `FundingFinder.dc.html` | EU Funding Finder with working filters |
| `Compliance.dc.html` | EU Compliance Calendar with country and topic filters |
| `Calculators.dc.html` | EU VAT calculator and late-payment interest calculator |
| `Checkers.dc.html` | "Am I an SME?" and the e-invoicing country checker |
| `CountryHub.dc.html` | Country hub (Germany example) |

### Components

| File | What it is |
|---|---|
| `SiteHeader.dc.html` | Shared header and navigation (`active` prop highlights a section) |
| `Cover.dc.html` | EU-star story cover used where no photo exists yet |
| `VisualAIAct.dc.html`, `VisualEInvoice.dc.html`, `VisualEUInc.dc.html` | Editorial graphics for the demo articles |

## Design system (summary)

- **Colours:** EU navy `#0B2A6B`, deep navy `#071C4A`, blue `#2F5BB7`, pale blue `#E6ECF7`, ink `#0E1525`, muted text `#4A5568`, lines `#DDE2EA`, surface `#F4F6FA`, accent yellow `#FFC72C` (fills on navy only).
- **Type:** Source Serif 4 for headlines and article body; Inter for UI and metadata (Google Fonts).
- **Layout:** 1240 px max container, 32 px side padding, flex/grid layouts that wrap to a single column on phones.

## Before going live

- Replace every `[EDITOR NAME]`, `[DATE]` and `[AMOUNT]` placeholder with real, verified values.
- Re-check all deadlines, VAT rates and thresholds against official sources (they change — e.g. the AI Act's high-risk dates moved in July 2026).
- The demo articles are temporary; facts were checked on 7 November 2026.
- Forms (newsletter, alerts) and "Official call" / "Our guide" buttons are not wired up yet.

## Note on the file format

The `.dc.html` files are Claude Design components. They render inside the Claude Design canvas (link above), which provides the `support.js` runtime; opened directly in a browser they will not display. Use them as the reference for building the pages in WordPress (SmartMag/Elementor).
