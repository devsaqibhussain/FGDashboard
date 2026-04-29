# Fragra Inventory Dashboard

A live client-facing inventory dashboard that pulls directly from your Google Sheets.

---

## Setup in 5 steps

### Step 1 — Enable Google Sheets API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Go to **APIs & Services → Library**
4. Search for **Google Sheets API** and click **Enable**

### Step 2 — Create an API Key

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → API Key**
3. Copy the key
4. Click **Edit** on the key → under **API restrictions**, select **Restrict key** → choose **Google Sheets API**
5. Under **Website restrictions**, add your GitHub Pages URL:
   `https://YOUR_USERNAME.github.io`

### Step 3 — Make your Google Sheet accessible

1. Open your Google Sheet
2. Click **Share** (top right)
3. Change access to **Anyone with the link → Viewer**
   _(The data is read-only — no one can edit it)_
4. Copy the Sheet ID from the URL:
   `docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

### Step 4 — Fill in config.js

Open `config.js` and fill in:

```js
API_KEY: 'AIzaSy...your key here...',
SHEET_ID: '1BxiM...your sheet id here...',
```

Also check that your tab names and column letters match exactly:

```js
TABS: {
  main:      'Main_Dashboard',   // must match tab name exactly
  depletion: 'Depletion Model',
},
MAIN_COLS: {
  productName: 'B',   // column B = Product Name
  available:   'H',   // column H = ShipHero Available
  // ... etc
}
```

### Step 5 — Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `fragra-dashboard`)
2. Upload all 4 files:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
3. Go to **Settings → Pages**
4. Under **Source**, select **Deploy from branch → main → / (root)**
5. Click **Save**

Your dashboard will be live at:
`https://YOUR_USERNAME.github.io/fragra-dashboard`

---

## Column mapping guide

Open your Main_Dashboard sheet and check which column letter each field is in.
Update `MAIN_COLS` in `config.js` accordingly.

| Field | What it is | Default column |
|---|---|---|
| `productName` | Product name | B |
| `shopifyLink` | SKU / Shopify link | A |
| `status` | Active/Inactive | C |
| `type` | Essential Oil / Diffuser | D |
| `available` | ShipHero available units | H |
| `committed` | Committed orders | I |
| `totalPipeline` | Total pipeline units | N |

For the Depletion Model sheet:

| Field | Default column |
|---|---|
| `productName` | A |
| `status` | B |
| `sku` | C |
| `weekStart` | D (first date column) |

---

## Customising thresholds

In `config.js`, under `SETTINGS`:

```js
criticalDays: 14,  // ≤ 14 days = red Critical badge
lowDays: 30,       // ≤ 30 days = amber Low badge
```

Change these to whatever makes sense for your reorder lead times.

---

## File structure

```
fragra-dashboard/
├── index.html     ← Page structure and layout
├── style.css      ← All styling
├── app.js         ← Data fetching, parsing, rendering
└── config.js      ← Your API key, Sheet ID, column mappings
```

---

## Troubleshooting

**"Could not load data" error**
- Check your API key is correct and the Sheets API is enabled
- Check your Sheet is set to "Anyone with link can view"
- Check your tab names in config.js match exactly (case-sensitive)

**Numbers show as 0 or undefined**
- Check your column letters in `MAIN_COLS` match your actual sheet
- Check `dataStartRow` — this should be the row number where your first product row is (not the header row)

**Depletion data not showing**
- Check `deplDataStartRow` — row 2 means headers are in row 1, data starts row 2
- Check `weekStart` column letter is the first date column in your Depletion Model tab
