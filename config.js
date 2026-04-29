// ─────────────────────────────────────────────
//  FRAGRA DASHBOARD · CONFIG
//  Fill in your values below, then deploy.
// ─────────────────────────────────────────────

window.FRAGRA_CONFIG = {

  // 1. Your Google Sheets API key
  //    → https://console.cloud.google.com → APIs & Services → Credentials → Create API Key
  //    → Restrict it to "Google Sheets API" and your GitHub Pages domain
  API_KEY: 'AIzaSyCgxJPsgZZSmliET_e6A4CftiFlAR2rRSY',

  // 2. Your Google Sheet ID
  //    → Found in the URL: docs.google.com/spreadsheets/d/SHEET_ID/edit
  SHEET_ID: '13_IctPlDnA_YegNS8FainxO1-fkjfgavtIYxiInj_t0',

  // 3. Tab names exactly as they appear in your Google Sheet
  TABS: {
    main:      'Main_Dashboard',   // inventory + sales data
    depletion: 'Depletion Model',  // weekly forecast
  },

  // 4. Column mappings for Main_Dashboard tab
  //    Change letters to match your actual column layout
  MAIN_COLS: {
    shopifyLink:     'A',  // Shopify link / SKU code
    productName:     'B',  // Product name
    status:          'C',  // Active / Inactive
    type:            'D',  // Essential Oil / Diffuser etc.
    available:       'H',  // ShipHero available units
    committed:       'I',  // Committed orders (negative = orders pending)
    assemblyOrder:   'J',
    intransit:       'K',
    readyStock:      'L',
    production:      'M',
    totalPipeline:   'N',
  },

  // 5. Column mappings for Depletion Model tab
  DEPL_COLS: {
    productName:    'A',  // Product name
    status:         'B',  // Status
    sku:            'C',  // SKU
    // First date column in your Depletion Model (e.g. 'D' if dates start at column D)
    weekStart:      'I',
    // Last column of your forecast window — set this to the last date column in your sheet
    // SKUs that are still positive at this column will show: "[stock] units at [date]"
    // Check your sheet: if your last date is in column V, set this to 'V'
    forecastEndCol: 'AB',
  },

  // 6. Dashboard display settings
  SETTINGS: {
    brandName:        'Fragra',
    criticalDays:     14,   // ≤ this = Critical (red)
    lowDays:          30,   // ≤ this = Low (amber)
    dataStartRow:     4,    // Row where data begins (after headers)
    deplDataStartRow: 2,    // Depletion model data start row
    maxTimelineItems: 15,   // How many bars in the urgency chart
  },

};
