# Rebuild `maps_scraper.py` into a full lead-gen tool

Keep it as a single Playwright script (same stack: `playwright` + `playwright_stealth`, no new heavy dependencies beyond stdlib).

## 1. Richer Google Maps data capture
Extract per business, in addition to current fields: full address + postcode, business category, opening hours status, price level, review count, rating, and the Maps URL. Handle businesses with **no website** as their own high-priority lead class (currently they're flagged and dropped into the same pile).

## 2. Deeper website audit (new checks + fixes)
- Fix the copyright regex to catch `Copyright © 2020`, `© 2015–2019`, and footer years anywhere on the page.
- New checks: HTTPS/invalid certificate, page load time (measured, not just 5s timeout), broken/missing images on first screen, Wix/GoDaddy/Squarespace/template builder detection (from generator meta / asset URLs — a Wix site is a perfect pitch for your Wix-rescue positioning), missing favicon, huge uncompressed images, no `<h1>`.
- Return a **structured audit result** (list of individual failures + measured load time), not a single flag string.

## 3. Lead scoring (0–100)
Score each lead from audit failures + Maps signals: no website (highest), slow/dead site, fails mobile, outdated copyright, low rating (<4.0) or few recent signals, category weighting. Output sorted by score; CSV gains a `Score` column so you call top prospects first. Also record all flag reasons in one column.

## 4. Email & contact discovery
For each qualifying site: fetch homepage + guess `/contact`, `/contact-us`, `/about`; regex-extract emails (and phone if missing from Maps), plus a `mailto:` fallback. Add `Email(s)` and `Contact Page URL` columns. Skip sites that block scraping (already flagged as "Slow/Dead/Blocked" — still leave the audit note).

## 5. Reliability & speed
- True concurrency with `asyncio` + Playwright async API (4–6 parallel workers instead of the current sequential round-robin).
- Fix the discarded stealth page hack (line 182); apply stealth to every page via a helper.
- Incremental CSV append after **every** lead (crash-safe), plus dedupe against master before appending.
- Retry (1 retry) on detail-page selector failures; tolerate Google's class-name drift by falling back to role/aria-label selectors where possible.
- Per-run CSV (`leads_YYYYMMDD_HHMM.csv`) in addition to `qualified_leads_master.csv`, and an end-of-run summary (found / audited / qualified / by-failure-reason counts) so you can tune filters.

## 6. Run modes
- Interactive prompt as today (single query).
- Batch mode: `python maps_scraper.py --input queries.txt` (one query per line, e.g. `Roofers in Stockport`), running sequentially through queries unattended with a small pause between them.
- `--scrolls N`, `--workers N` optional flags; outreach drafting on by default, `--no-outreach` to skip.

## 7. Outreach drafting
For each qualified lead, generate a first-touch email draft + 2-line call opener personalised from the audit findings (e.g. "Your site took 9s to load on mobile and the copyright still says 2018…"), written in Ajulo Web Solutions' voice, referencing your £2,497+ service positioning. Saved in a second column / separate `outreach_drafts.csv` keyed by business name, ready to paste.

## Files
- Rewrite `~/Desktop/maps_scraper.py` (single file, ~500–600 lines).
- No changes to the portfolio repo — this is the Desktop tool only.
- Per your standing preference: build it in one pass for immediate use, no optional QA runs; you'll test it live against a real query.