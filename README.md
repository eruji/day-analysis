# Sales by Day & Hour — CSV analyzer

A client-side, single-page analyzer that turns a sales export CSV into a **day-of-week × hour-of-day revenue heatmap** so you can decide operating hours from actual data.

- **No server, no build step, no dependencies** — pure HTML/CSS/JS, works from `file://` and on any static host (Netlify, GitHub Pages, S3…).
- Your CSV is parsed **entirely in your browser** — nothing is uploaded anywhere.
- Click any heatmap cell to drill into the individual transactions (date & time, receipt #, staff, items).
- Filter by **date range** (presets + pickers), **day of week**, and hide large orders (≥ $200) to separate walk-in traffic from big-ticket sales.

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
test/test.js      node test suite
netlify.toml      Netlify config (static, no build)
```
