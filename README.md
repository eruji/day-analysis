# Sales by Day & Hour — CSV analyzer

A client-side, single-page analyzer that turns a sales export CSV into a **day-of-week × hour-of-day revenue heatmap** so you can decide operating hours from actual data.

- **No server, no build step, no dependencies** — pure HTML/CSS/JS, works from `file://` and on any static host (Netlify, GitHub Pages, S3…).
- Your CSV is parsed **entirely in your browser** — nothing is uploaded anywhere.
- Click any heatmap cell to drill into the individual transactions (date & time, receipt #, staff, items).
- Filter by **date range** (presets + pickers) and **day of week** to focus on any period.
- **Existing-hours overlay** — an orange band outlines the hours you're currently open on the grid, so quiet open hours and sales that happen outside the box jump out instantly.
- **Per-day count bars** — each day's header in the heatmap carries a thin horizontal bar scaled to its receipt count (colored like the heatmap by revenue share) with the **count digits at the end** and the day's **$** total beneath — no `· 13x` clutter, no separate chart.
- **Keeps your data between visits** — the last CSV is stored in this browser's localStorage and auto-restored on reload, until you load a new file. A **✕ forget saved copy** button clears it. Still nothing is ever uploaded anywhere.
- **Online vs retail split** — if the export has a channel-ish column (`Register`, `Channel`, `Sale Type`, `Source`, `Platform`, `Store`…), a *Channel* dropdown filters heatmap, bar chart, drill-down and CSV export to **All / Online / Retail** — or any unrecognized values you have.

## Marking your current hours

By default the overlay outlines **Mon–Fri 10 AM–5 PM, Sat 9 AM–5 PM, Sun 9 AM–2 PM**. Edit the `OPEN` config at the top of `js/app.js` to match your real schedule: weekday keys `0=Mon … 6=Sun`, each value a half-open `[open, close)` hour span. Because a sale lands in the column of its clock hour, a 5 PM close outlines the **10 AM–4 PM** columns — a sale at 5:00 PM or later happened after close. Multi-span days use nested arrays (`[[9,12],[14,17]]`); omit a weekday (or use `[]`) to mark it closed. The legend line above the table is generated automatically from the config.

## Try it

Drag `data/sample.csv` onto the page, or click **Use sample data** (sample is a real Lightspeed POS export, Jun–Sep 2026).

## Expected CSV format

The analyzer auto-detects columns by header name (case/space-insensitive). Minimum required:

| What | Accepts headers like |
|---|---|
| **Date/time** (required) | `Date`, `DateTime`, `Posting Date`, `Timestamp`, `Created` |
| **Amount** (required) | `Total`, `Amount`, `Paid`, `Subtotal`, `Gross`, `Net` |
| Line type *(optional)* | `Line Type`, `Type`, `Line` |
| Status *(optional)* | `Status` |
| Receipt/order id *(optional)* | `Receipt Number`, `Order`, `Invoice`, `Transaction ID` |
| User *(optional)* | `User`, `Employee`, `Staff`, `Cashier` |
| Item details *(optional)* | `Details`, `Description`, `Items`, `Product` |
| Channel *(optional)* | `Channel`, `Register`, `Sale Type`, `Source`, `Platform`, `Store`, `Location`, `Order Type` | Values containing online/web/ecom/delivery/shipped… map to **Online**; register/retail/store/walk-in/pickup/dine-in… map to **Retail** (e.g. Lightspeed's `Online register` vs `Main Register`). Unrecognized values are listed on their own in the dropdown. |

Supported timestamps: `2026-09-05 15:37:11` and `9/5/2026 3:37 PM` (both 12h and 24h). Amounts may include `$ € £`, commas, or parentheses for negatives.

### How rows become receipts

1. **Line-item exports (e.g. Lightspeed)**: if a *line type* column exists, only the sale **header** rows (`Line Type = Sale`) are counted, so items/payments aren't double-counted.
2. **Statuses**: rows whose status is `VOIDED`, `SAVED`, `PARKED`, `CANCELLED`, or `DELETED` are excluded (they never completed). Completed refunds appear as negative totals and are netted.
3. **Order-id exports (e.g. Shopify/Stripe)**: if no line-type column exists but a receipt/order column does, repeated ids are auto-grouped into one receipt per order.
4. Otherwise every row is treated as one receipt.

The status line under the load box always tells you exactly what was excluded and why — no silent surprises.

## Run locally

```bash
python -m http.server 8000        # then open http://localhost:8000
# or just open index.html in a browser and drag a CSV in
```

## Deploy to Netlify

**Option A — drag & drop (fastest):** go to [app.netlify.com/drop](https://app.netlify.com/drop) and drop this folder in. No config needed.

**Option B — from git:** push this repo to GitHub/GitLab, then in Netlify: *Add new site → Import an existing project*. Netlify auto-detects `netlify.toml` (publish root = repo root, no build command).

## Tests

```bash
node test/test.js
```

Validates the parser + analysis core against the bundled sample (expects 148 receipts, $15,007.50 net, correct month/day filtering).

## Project layout

```
index.html        UI shell
css/style.css     styling
js/csv.js         RFC4180 CSV parser (pure)
js/core.js        schema detection, parsing, day×hour math, formatters (pure)
js/app.js         DOM wiring, loading, rendering, drill-down, CSV export
data/sample.csv   sample Lightspeed export
test/test.js      node test suite (pure core logic)
test/smoke.js     headless-Chrome UI smoke test (serves the page, loads sample, checks heatmap + per-day count bars)
netlify.toml      Netlify config (static, no build)
```
