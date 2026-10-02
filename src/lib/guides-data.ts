export type GuideArticle = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  notes?: string[];
};

export type GuideSection = {
  id: string;
  title: string;
  articles: GuideArticle[];
};

export type GuideChapter = {
  id: string;
  number: string;
  title: string;
  intro: string;
  sections: GuideSection[];
};

/** FinaceManagerIAG Guides structure for FinanceIAG (full TOC). */
export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: "first-steps",
    number: "1",
    title: "First Steps",
    intro: "Establish businesses and users, set preferences, enable modules, and localize for your country.",
    sections: [
      {
        id: "initial-setup",
        title: "1.1 Initial Setup",
        articles: [
          {
            id: "install-windows",
            title: "Install or update desktop edition on Windows",
            summary: "Open finacemanageriag.io in the browser (or install the desktop app). Updates do not require deleting the previous version first.",
            steps: ["Download the current installer", "Run the installer (normal user; no admin password required for default path)", "Optional: add a desktop shortcut", "Confirm install directory and finish"],
            notes: ["32-bit Windows needs the alternative download.", "Do not install into Program Files unless you intend multi-user shared install."]
          },
          {
            id: "install-macos",
            title: "Install or update desktop edition on macOS",
            summary: "Allow App Store and identified developers, download the installer, and open FinaceManagerIAG. Back up before updating.",
            steps: ["System Settings → Privacy & Security → allow identified developers", "Download Mac build → open .dmg", "Drag app to Applications (not a Dock alias)", "On update: Replace, Keep Both, or Stop"],
            notes: ["After opening data in a newer version, do not reopen with an older version without restoring a pre-update backup."]
          },
          {
            id: "add-business",
            title: "Add a new business",
            summary: "Businesses → Add Business → Create New Business. Choose Country for localization starters.",
            steps: ["Open Businesses (or Settings → Business Profiles)", "Add Business → Create New Business", "Enter name and Country → Add", "Customize tabs and chart of accounts"],
            notes: ["Opening a .financeiag backup directly does not add it to the Businesses list.", "Duplicate names are allowed — rename carefully."]
          },
          {
            id: "rename-business",
            title: "Name or rename a business",
            summary: "File name (Businesses list) is separate from trading name on forms (Settings → Business Details).",
            steps: ["Trading name: Settings → Business Details → Business Name → Update", "File name: Rename beside the business at the top → Update"]
          },
          {
            id: "business-details",
            title: "Enter business details",
            summary: "Business Name, Address, and Country appear on forms. HTML is allowed in address fields.",
            steps: ["Settings → Business Details", "Enter name, address, identifiers, country", "Update"]
          },
          {
            id: "base-currency",
            title: "Set base currency",
            summary: "Required before foreign currencies on banks, customers, suppliers, employees, journals, or special accounts.",
            steps: ["Settings → Base Currency (or Currencies)", "Code, Name, Symbol, Decimal places", "Update"],
            notes: ["Changing currency does not convert historical amounts."]
          },
          {
            id: "foreign-currencies",
            title: "Define foreign currencies",
            summary: "National currencies, crypto, or custom exchange units — treated as foreign currencies in the program.",
            steps: ["Settings → Foreign Currencies → New", "Code, Name, Symbol, Decimal places", "Update", "Assign currency on banks, customers, suppliers, etc."]
          },
          {
            id: "set-language",
            title: "Set language",
            summary: "Language is per user (footer links). Translates UI labels, not your chart names or custom field content.",
            steps: ["Click language in the footer or + for all languages", "Set language before creating a business for default P&L placeholders", "Bilingual charts: rename accounts with both languages"]
          },
          {
            id: "rtl-languages",
            title: "Use right-to-left languages",
            summary: "Arabic, Dhivehi, Hebrew, Kurdish, Persian, and Urdu reverse the whole interface.",
            steps: ["Switch language via footer", "Verify chart and reports layout"]
          },
          {
            id: "date-format",
            title: "Set date format",
            summary: "Day/month/year order per business under Date & Number Format.",
            steps: ["Settings → Date & Number Format", "Choose date format → Update"]
          },
          {
            id: "time-format",
            title: "Set time format",
            summary: "24-hour or 12-hour with AM/PM — used mainly in History. Time zone follows the computer.",
            steps: ["Settings → Date & Number Format", "Choose time format → Update"]
          },
          {
            id: "first-day-of-week",
            title: "Set first day of week",
            summary: "Controls pop-up calendars for transaction dates.",
            steps: ["Settings → Date & Number Format", "Choose first day of week → Update"]
          },
          {
            id: "number-format",
            title: "Set number format",
            summary: "Digit grouping, decimal mark, and group size per business.",
            steps: ["Settings → Date & Number Format", "Choose number format → Update"]
          },
          {
            id: "backup-restore",
            title: "Backup, restore, import, and transfer businesses",
            summary: "Backup one business at a time. Import under Add Business → Import Business. Keep versions aligned when transferring.",
            steps: ["Open the business → Backup (optionally exclude attachments/emails/history)", "Store off-machine", "Add Business → Import Business → Choose File", "Verify and rename if needed"],
            notes: ["Newer versions can modify structure; older apps may not open newer backups.", "Very old files may need intermediate version 20.9.89 first."]
          },
          {
            id: "remove-business",
            title: "Remove a business",
            summary: "Removes from the Businesses list; data moves to Trash in the application data folder until deleted there.",
            steps: ["Businesses → Remove Business", "Select business → Remove", "Optionally delete from Trash folder to purge"]
          }
        ]
      },
      {
        id: "summary",
        title: "1.2 Summary",
        articles: [
          {
            id: "customize-business",
            title: "Customize a business",
            summary: "Enable only the tabs you need. Tabs with data cannot be disabled until data is deleted.",
            steps: ["Click Customize under the left pane", "Check modules (Banking, Sales, Purchases, Inventory, Payroll, …)", "Update", "Add more later as needed"],
            notes: ["Think before enabling — disabling used tabs is tedious."]
          },
          {
            id: "simplify-manager",
            title: "Simplify FinaceManagerIAG",
            summary: "Fewer tabs means cleaner balance sheet, Settings, Reports, and entry forms.",
            steps: ["Customize → uncheck unused empty tabs", "Update"]
          },
          {
            id: "reporting-period",
            title: "Set reporting period",
            summary: "Show balances for a specified period so P&L matches the current year.",
            steps: ["Overview / Summary → Edit", "Show balances for specified period", "From / To (Today keeps it current)", "Update"]
          },
          {
            id: "accrual-cash",
            title: "Choose accrual or cash basis",
            summary: "Accrual: when earned/incurred. Cash: when money moves. Reports can use either method.",
            steps: ["Overview → Edit → Accrual or Cash → Update", "When creating reports, pick method per report"]
          },
          {
            id: "show-account-codes",
            title: "Display account codes on Summary",
            summary: "Requires codes assigned on accounts first.",
            steps: ["Overview → Edit → Show account codes → Update"]
          },
          {
            id: "exclude-zero",
            title: "Exclude zero-balance accounts from Summary",
            summary: "Hide unused zero-balance accounts after the first periods.",
            steps: ["Overview → Edit → Exclude zero balances → Update"]
          },
          {
            id: "clear-suspense",
            title: "Clear transactions in Suspense",
            summary: "Never journal Suspense away. Fix incomplete or unbalanced entries one by one on accrual basis.",
            steps: ["Drill into Suspense balance", "Ensure Accrual basis", "Edit each transaction", "Confirm Suspense is empty"]
          },
          {
            id: "close-period",
            title: "Close an accounting period",
            summary: "Adjust accruals, distribute earnings, pay draws, save reports, set Lock Date, then reset Summary From date.",
            steps: ["Adjusting entries", "Earnings distributions / dividends", "Save P&L and Balance Sheet", "Settings → Lock Date", "Overview → new period From date"]
          }
        ]
      },
      {
        id: "localization",
        title: "1.3 Business Localization",
        articles: [
          {
            id: "add-localized",
            title: "Add localized settings and features",
            summary: "Country on Business Details (or at create time) enables tax codes, custom fields, report transformations, and extensions when available.",
            steps: ["Settings → Business Details → Country", "Update", "Review Tax Codes and Reports"],
            notes: ["Changing country may not auto-add tax codes on established businesses."]
          },
          {
            id: "update-localizations",
            title: "Update localizations and report transformations",
            summary: "Update FinaceManagerIAG at finacemanageriag.io; installed transformations refresh automatically.",
            steps: ["Update to the latest version", "Re-open localized reports"]
          }
        ]
      },
      {
        id: "users",
        title: "1.4 Users",
        articles: [
          {
            id: "create-users",
            title: "Create users",
            summary: "Administrator vs Restricted. Restricted users get selected businesses; permissions set separately.",
            steps: ["IAG Admin → Users & roles → Create user", "Name, Username, Password, Role", "Select businesses for restricted users", "Create"],
            notes: ["Usernames are case-sensitive.", "Avoid extra Administrators when hosting many client businesses."]
          },
          {
            id: "user-permissions",
            title: "Set user permissions",
            summary: "Per tab: No access / View / Create / Update / Delete. Full access for business managers who are not account admins.",
            steps: ["IAG Admin → Users & roles → open a role", "Set workspace View / Create / Edit / Delete", "Optionally customize individual pages in the page matrix", "Save"]
          }
        ]
      }
    ]
  },
  {
    id: "structuring-accounts",
    number: "2",
    title: "Structuring Accounts",
    intro: "Structure accounts for your organization, legal reporting, and management needs.",
    sections: [
      {
        id: "coa",
        title: "2.1 Chart of Accounts",
        articles: [
          {
            id: "design-coa",
            title: "Design a chart of accounts",
            summary: "Five types: Assets, Liabilities, Equity, Income, Expenses. Match tax filings, legal form, and permanence.",
            steps: ["Research local requirements", "Sketch groups and accounts", "Test in a sample business first", "Document posting rules"]
          },
          {
            id: "build-coa",
            title: "Build a chart of accounts",
            summary: "Groups first, totals, enable tabs for automatic accounts, then ordinary accounts. Reorder groups.",
            steps: ["Settings / Accounts → Chart of Accounts", "New Group, New Total, New Account", "Enable tabs that activate control accounts", "Reorder and assign codes"]
          },
          {
            id: "add-ordinary-account",
            title: "Add an ordinary account",
            summary: "Standalone custom accounts on Balance Sheet or P&L — not automatic control accounts.",
            steps: ["Chart of Accounts → New Account", "Name, Code, Group, Cash Flow category, Tax Code, Division", "Create"]
          },
          {
            id: "custom-control-accounts",
            title: "Add custom control accounts",
            summary: "Segregate bank, customer, supplier, inventory, employee, fixed asset, capital, or special sub-ledgers.",
            steps: ["Settings → Control Accounts → New", "Name, Code, Group, Cash Flow", "Assign sub-ledgers to the new control account"]
          },
          {
            id: "account-codes",
            title: "Set account codes",
            summary: "Alphanumeric codes for identification schemes; show on Summary and reports when enabled.",
            steps: ["Edit account or group → Code → Update"]
          },
          {
            id: "delete-account",
            title: "Delete an account",
            summary: "Only if unused, not a control account with ledgers, not auto-activated, and not Retained earnings.",
            steps: ["Edit account → Delete", "If blocked, clear transactions or disable the related tab first"]
          },
          {
            id: "setup-ar",
            title: "Set up accounts receivable",
            summary: "Enable Customers — do not create AR manually.",
            steps: ["Customize → Customers", "Create first customer", "Set starting balances when migrating"]
          },
          {
            id: "setup-ap",
            title: "Set up accounts payable",
            summary: "Enable Suppliers — do not create AP manually.",
            steps: ["Customize → Suppliers", "Create first supplier", "Set starting balances when migrating"]
          }
        ]
      },
      {
        id: "capital",
        title: "2.2 Capital Accounts",
        articles: [
          {
            id: "capital-setup",
            title: "Set up and use capital accounts",
            summary: "Partners, beneficiaries, owners. One capital account per member; inactive when they leave.",
            steps: ["Customize → Capital Accounts", "New Capital Account", "Post contributions, drawings, profit share"]
          },
          {
            id: "capital-subaccounts",
            title: "Use capital subaccounts",
            summary: "Default: Drawings, Funds contributed, Share of profit. Customize under Settings → Capital subaccounts.",
            steps: ["Settings → Capital subaccounts", "Add, rename, or remove", "Post transactions to the right subaccount"]
          }
        ]
      },
      {
        id: "special",
        title: "2.3 Special Accounts",
        articles: [
          {
            id: "special-accounts",
            title: "Use special accounts",
            summary: "Custom subsidiary ledgers under balance-sheet control accounts (trusts, deposits, loans, store credit).",
            steps: ["Customize → Special Accounts", "Create control account if needed", "New Special Account", "Post via control + special on lines"]
          },
          {
            id: "avoid-auto-credits",
            title: "Avoid automatic credit allocations with special accounts",
            summary: "Hold deposits in special accounts until you allocate manually with a negative line on the invoice.",
            steps: ["Create special account per customer/supplier", "Receipt/Payment to Special Accounts", "On invoice, negative line to special account"]
          }
        ]
      },
      {
        id: "common-situations",
        title: "2.4 Common Business Situations",
        articles: [
          {
            id: "simple-equity",
            title: "Simplify equity for sole traders / proprietors",
            summary: "Rename Retained earnings to Owner’s equity; skip Capital Accounts when eligible.",
            steps: ["Chart of Accounts → Edit Retained earnings → Owner’s equity", "Post draws to Owner’s equity", "Use Statement of Changes in Equity for draw totals"]
          },
          {
            id: "self-employed-setup",
            title: "Set up as a self-employed services provider",
            summary: "Typical tabs: Banking, Receipts, Payments, Customers, Quotes, Invoices, Billable Time/Expenses, Fixed Assets, Expense Claims.",
            steps: ["Create business", "Customize tabs", "Add bank account", "Rename Sales / Owner’s equity", "Clear setup dummy records", "Enter customers and go live"]
          }
        ]
      },
      {
        id: "starting-balances",
        title: "2.5 Starting Balances",
        articles: [
          {
            id: "enter-starting",
            title: "Enter starting balances",
            summary: "Migration only. Ordinary accounts, sub-ledgers, unpaid invoices, pending bank txs. Retained earnings auto-balances.",
            steps: ["Edit ordinary BS accounts → Starting balance", "Edit customers, banks, inventory, assets, capital", "Enter unpaid invoices with pre-start dates", "Enter pending bank receipts/payments", "Verify Retained earnings"]
          },
          {
            id: "fix-starting",
            title: "Fix starting balances",
            summary: "Older cash-basis starting balances may need Fix Starting Balances from Retained earnings drill-down.",
            steps: ["Drill into Retained earnings", "Fix Starting Balances", "Review proposed updates carefully", "Check Balance Sheet after"]
          }
        ]
      }
    ]
  },
  {
    id: "customizing",
    number: "3",
    title: "Customizing a Business",
    intro: "Logo, custom fields, footers, and form defaults for branding and workflow.",
    sections: [
      {
        id: "logo",
        title: "3.1 Business Logo",
        articles: [
          {
            id: "business-logo",
            title: "Add or change a business logo",
            summary: "Settings → Business Logo. Prefer ≤1000px per side.",
            steps: ["Settings → Business Logo", "Choose file → Update", "Delete then upload to replace"]
          }
        ]
      },
      {
        id: "custom-fields",
        title: "3.2 Custom Fields",
        articles: [
          {
            id: "use-custom-fields",
            title: "Use custom fields",
            summary: "Text, checkbox, date, number, dropdown, image. Place on records, settings, and line items. Show as columns or on printed docs.",
            steps: ["Settings → Custom Fields → New", "Name, Type, Placement, Position", "Show as column / on printed documents", "Create"],
            notes: ["Copy to carries matching field labels; Form Defaults lose to source content on Copy to."]
          },
          {
            id: "custom-field-image",
            title: "Add an image to a custom field",
            summary: "Store image on the web; put HTML <img src=\"…\"> in a text custom field.",
            steps: ["Define text custom field", "Enter HTML referencing the image URL", "Test PDF/email if on-screen hotlink is blocked"]
          }
        ]
      },
      {
        id: "footers",
        title: "3.3 Footers",
        articles: [
          {
            id: "footers",
            title: "Add static information with footers",
            summary: "Terms, bank details, signatures — static content per form type. HTML supported; multiple footers allowed.",
            steps: ["Settings → Footers → form type → New Footer", "Enter content → Create", "Select footer on the transaction"]
          }
        ]
      },
      {
        id: "form-defaults",
        title: "3.4 Form Defaults",
        articles: [
          {
            id: "form-defaults",
            title: "Set form defaults",
            summary: "Prefill fields, checkboxes, and themes for new forms. Clones and Copy to override defaults (except reference numbering).",
            steps: ["Open module → Form Defaults", "Fill standard fields (skip Date)", "Update"]
          }
        ]
      }
    ]
  },
  {
    id: "program-features",
    number: "4",
    title: "Program Features",
    intro: "Learning tools, common procedures, tax, divisions, projects, PDFs, email, batch ops, attachments, reports, and history.",
    sections: [
      {
        id: "learn",
        title: "4.1 Learn the Program",
        articles: [
          {
            id: "test-business",
            title: "Experiment with a test business",
            summary: "Create a separate Business Profile to try features safely.",
            steps: ["Settings → Business Profiles → Add named Test", "Enable tabs and enter samples", "Delete when done"]
          },
          {
            id: "import-sample",
            title: "Import a sample business",
            summary: "Import a sample .financeiag backup to explore modules and reports.",
            steps: ["Add Business → Import Business", "Choose sample file", "Explore tabs and Reports"]
          },
          {
            id: "search-guides",
            title: "Search the Guides",
            summary: "Use the search box on the Guides page to find articles by title or content.",
            steps: ["Open Guides", "Type keywords in Search", "Open a matching article"]
          },
          {
            id: "pdf-guides",
            title: "Download a PDF version of the Guides",
            summary: "FinaceManagerIAG Guides live in-app and stay aligned with finacemanageriag.io.",
            steps: ["Open Guides in the sidebar for step-by-step help", "Use finacemanageriag.io for the latest product updates"]
          }
        ]
      },
      {
        id: "common-procedures",
        title: "4.2 Common Procedures",
        articles: [
          {
            id: "search-records",
            title: "Search for records",
            summary: "Literal AND search of visible columns; all pages; preserves sort.",
            steps: ["Enter search text → Search", "Clear via yellow header link to restore full list"]
          },
          {
            id: "sort-lists",
            title: "Sort lists and tables",
            summary: "Click column headers; click again to reverse. Works with search.",
            steps: ["Click heading to sort", "Click again for descending"]
          },
          {
            id: "non-inventory",
            title: "Create non-inventory items",
            summary: "Shortcuts for services/goods without stock tracking — standardize names, accounts, prices.",
            steps: ["Settings → Non-inventory Items → New", "Fill when sold / when purchased", "Use Item field on sales and purchase forms"]
          },
          {
            id: "reference-numbers",
            title: "Use reference numbers",
            summary: "Free text or automatic sequencing (highest number + 1). Prefer one style per form type.",
            steps: ["Enter Reference or check Automatic", "Or set under Form Defaults"]
          },
          {
            id: "line-descriptions",
            title: "Show line descriptions on entry forms",
            summary: "Check Line description on receipts, payments, invoices, journals, etc.",
            steps: ["Open form → check Line description", "Enter per-line text"]
          },
          {
            id: "line-discount",
            title: "Apply a discount to a line item",
            summary: "Percentage or exact amount per line on quotes, orders, invoices, credit/debit notes.",
            steps: ["Check Discount → Percentage or Exact amount", "Enter per line"]
          },
          {
            id: "separate-discount",
            title: "Enter a discount as a separate line item",
            summary: "Negative exact-amount discount line posted to a discount/expense account.",
            steps: ["Check Discount → Exact amount", "Add line with amount in Discount field", "Choose account and tax code carefully"]
          },
          {
            id: "clone",
            title: "Clone transactions and reports",
            summary: "Clone duplicates a transaction (reference follows Form Defaults) or a report definition.",
            steps: ["View → Clone", "Edit → Create"]
          },
          {
            id: "copy-to",
            title: "Use the Copy to function",
            summary: "Convert quotes → orders → invoices, and cross sales/purchase workflows. Source content overrides destination defaults.",
            steps: ["View source → Copy to → destination type", "Edit → Create"]
          },
          {
            id: "html-fields",
            title: "Use HTML code in fields",
            summary: "Style text and reference remote images in descriptions and custom fields.",
            steps: ["Enter HTML in the field", "Prefer external image URLs to keep data small"]
          },
          {
            id: "calc-fields",
            title: "Perform calculations in number fields",
            summary: "Enter expressions like 10*1.15 in qty/price fields; result is stored.",
            steps: ["Type expression without =", "Confirm result on the form"],
            notes: ["Does not work in number custom fields."]
          },
          {
            id: "copy-lists",
            title: "Copy lists and reports",
            summary: "Copy to clipboard as TSV for spreadsheets or documents.",
            steps: ["Click Copy to clipboard", "Paste into spreadsheet or word processor"]
          },
          {
            id: "small-screens",
            title: "Use FinaceManagerIAG on small screens",
            summary: "Compact mode minimizes the nav pane; very narrow windows use a horizontal tab bar.",
            steps: ["Toggle compact icon at bottom of window"]
          },
          {
            id: "obscure-screen",
            title: "Obscure onscreen information",
            summary: "Eye icon blurs amounts on list/summary screens for privacy.",
            steps: ["Click eye icon at bottom", "Hover a cell to peek one figure"]
          },
          {
            id: "prev-next",
            title: "Navigate with previous and next arrows",
            summary: "Move through the current filtered/sorted list while viewing a form.",
            steps: ["View a transaction", "Use << < > >> in the top-right"]
          },
          {
            id: "lock-date",
            title: "Set lock date",
            summary: "Prevent changes on or before a date. Admins can unlock temporarily.",
            steps: ["Settings → Lock Date", "Lock accounting periods → enter date → Update"]
          }
        ]
      },
      {
        id: "tax-codes",
        title: "4.3 Tax Codes",
        articles: [
          {
            id: "create-tax-codes",
            title: "Create and use tax codes",
            summary: "Create tax liability accounts first. Localization or custom single/multi-rate codes. Same code offsets collect vs pay.",
            steps: ["Add Tax payable (liability)", "Settings → Tax Codes → New", "Name, Label, Rate, Account", "Apply per line on forms"]
          },
          {
            id: "tax-exclusive-inclusive",
            title: "Tax-exclusive vs tax-inclusive prices",
            summary: "Exclusive adds tax to subtotal; inclusive backs tax out of entered prices.",
            steps: ["Set on each form or Form Defaults", "Match inventory/non-inventory price basis"]
          },
          {
            id: "multi-component-tax",
            title: "Work with multi-component custom tax codes",
            summary: "Separate liability accounts per component when authorities or schedules differ. New code when rates change — never edit used codes.",
            steps: ["Create liability accounts per component", "Edit tax code → assign accounts", "Create new codes for rate changes; inactive old ones"]
          },
          {
            id: "reverse-charge-vat",
            title: "Reverse charge VAT",
            summary: "Zero-rate custom code with Reverse charged checked. Tax Summary shows offsetting amounts; remittance net is usually zero.",
            steps: ["New Tax Code → Zero (0%) → Reverse charged → rate", "Apply on purchase lines", "Use the Tax Summary report for filing"]
          },
          {
            id: "inactive-tax",
            title: "Make tax codes inactive",
            summary: "Hide from dropdowns without deleting history.",
            steps: ["Settings → Tax Codes → Edit → Inactive → Update"]
          },
          {
            id: "partial-personal-tax",
            title: "Adjust tax for partial personal use",
            summary: "Split purchase lines: business portion with tax code; personal portion to equity/draw without tax code.",
            steps: ["Split Unit price by % business/personal", "Tax code only on business line", "Personal line to Owner’s equity / Capital drawings"]
          }
        ]
      },
      {
        id: "divisions",
        title: "4.4 Divisions",
        articles: [
          {
            id: "create-divisions",
            title: "Create and manage divisions",
            summary: "Optional cost centers, locations, or sales reps.",
            steps: ["Settings → Divisions → New", "Inactive when obsolete"]
          },
          {
            id: "divisions-bs",
            title: "Use divisions for the Balance Sheet",
            summary: "Assign banks, customers, inventory, assets, etc. to a division. Interdivisional loan keeps divisional BS balanced.",
            steps: ["Edit account/subaccount → Division", "Reports → Balance Sheet with division columns"]
          },
          {
            id: "divisions-pl",
            title: "Use divisions for the Profit and Loss Statement",
            summary: "Allocate income/expense lines (or split lines) by division.",
            steps: ["Select Division on P&L lines", "Reports → P&L with division columns"]
          },
          {
            id: "division-exceptions",
            title: "Correct missing division selections",
            summary: "Division Exception Report lists income/expense without divisions.",
            steps: ["Reports → Division Exception Report", "Drill Amount → Edit → add Division"]
          }
        ]
      },
      {
        id: "projects",
        title: "4.5 Projects",
        articles: [
          {
            id: "projects",
            title: "Create and use projects",
            summary: "Track income vs direct costs per job. Assign on eligible lines (not AR/AP/inventory control lines).",
            steps: ["Customize → Projects → New Project", "Assign Project on transaction lines", "View project for profitability", "Inactive when complete"]
          }
        ]
      },
      {
        id: "pdfs",
        title: "4.6 PDFs",
        articles: [
          {
            id: "create-pdfs",
            title: "Create PDF files of transactions and reports",
            summary: "View → Print → Save as PDF (OS printer).",
            steps: ["Open transaction or report", "Print → Save as PDF"]
          }
        ]
      },
      {
        id: "emails",
        title: "4.7 Emails",
        articles: [
          {
            id: "email-txns",
            title: "Email transactions and reports",
            summary: "Configure SMTP under Settings → Email, then Email while viewing a document.",
            steps: ["Settings → Email — host, port 587, username, password", "Test email settings", "View doc → Email → Send"]
          },
          {
            id: "email-pdf",
            title: "Email in PDF format",
            summary: "Print to PDF and attach via your mail client, or enable legacy Internal PDF Generator if needed.",
            steps: ["Prefer OS Print to PDF", "Or Settings → Legacy Features → Internal PDF Generator"]
          },
          {
            id: "email-attachments",
            title: "Attach files to emails",
            summary: "Add Attachments to the transaction first, then check them on the Email screen.",
            steps: ["View txn → New Attachment", "Email → check attachments → Send"]
          },
          {
            id: "email-templates",
            title: "Use email templates",
            summary: "Settings → Email Templates with Liquid placeholders like {{reference}}.",
            steps: ["Settings → Email Templates → Edit", "Subject and Body → Update"]
          },
          {
            id: "review-email",
            title: "Review email",
            summary: "Emails button lists sent mail; View shows body and attachments. Cloud/server can track Viewed status.",
            steps: ["Click Emails at top", "View a row"]
          },
          {
            id: "email-viewed",
            title: "Track whether emailed attachments were viewed",
            summary: "Cloud/server only — Status Sent → Viewed when recipient opens the link.",
            steps: ["Email from cloud/server", "Check Status column under Emails"]
          },
          {
            id: "email-troubleshoot",
            title: "Troubleshoot email issues",
            summary: "Update software; use port 587; check provider security settings (Gmail, Yahoo, Office 365).",
            steps: ["Verify Email Settings", "Test email settings", "Try port 587"]
          }
        ]
      },
      {
        id: "batch",
        title: "4.8 Batch Operations",
        articles: [
          {
            id: "batch-create-update",
            title: "Use Batch Create and Batch Update",
            summary: "Spreadsheet paste via clipboard templates. Keep Key column on updates; never drop columns.",
            steps: ["Batch Create → copy template → fill → paste → Next → Batch Create", "Batch Update → copy → edit → paste → Batch Update"],
            notes: ["Back up before batch operations."]
          },
          {
            id: "batch-delete",
            title: "Use the Batch Delete function",
            summary: "Delete unreferenced rows in bulk. Reversible via History but still dangerous.",
            steps: ["Batch Delete → check rows → Delete", "Only current page selection"]
          },
          {
            id: "batch-view",
            title: "Use the Batch View function",
            summary: "Compile selected View records into one printable multi-page view.",
            steps: ["Batch View → select → Batch View", "Print or Save as PDF"]
          }
        ]
      },
      {
        id: "attachments",
        title: "4.9 Attachments",
        articles: [
          {
            id: "attach-docs",
            title: "Attach supporting documentation",
            summary: "Attach to transactions, customers/suppliers, or folders. Stored in the business data file.",
            steps: ["View record → New Attachment or drag-drop", "Manage in Attachments tab"]
          },
          {
            id: "attachment-folders",
            title: "Organize attachments with folders",
            summary: "Folders for period/project docs not tied to one transaction.",
            steps: ["Customize → Folders → New Folder", "View folder → add attachments", "Optional custom fields for Contents"]
          }
        ]
      },
      {
        id: "reports",
        title: "4.10 Reports",
        articles: [
          {
            id: "create-reports",
            title: "Create reports",
            summary: "Reports unlock with tabs. Save definitions (not static files). Clone for similar periods.",
            steps: ["Reports → pick type → New Report", "Dates, options, comparative columns", "Create / Update"]
          },
          {
            id: "collapse-groups",
            title: "Collapse account groups in financial reports",
            summary: "Groups to collapse on P&L or Balance Sheet definitions.",
            steps: ["Edit report → Groups to collapse", "Create"]
          },
          {
            id: "customer-statements",
            title: "Issue customer statements",
            summary: "Unpaid invoices or Transactions statements under Accounts receivable reports.",
            steps: ["Reports → Customer Statements", "Set Date/Period", "View / Print / Email"]
          },
          {
            id: "supplier-statements",
            title: "Issue supplier statements",
            summary: "Unpaid invoices or Transactions for Accounts payable.",
            steps: ["Reports → Supplier Statements", "Set Date/Period", "View"]
          },
          {
            id: "sales-invoice-reports",
            title: "Create sales invoice reports",
            summary: "Totals by Customer, Item, or Custom Field. Credit sales only — not cash sales.",
            steps: ["Enable Sales Invoices", "Reports → Sales Invoice Totals… → New Report"]
          },
          {
            id: "budget",
            title: "Create a budget",
            summary: "P&L Actual vs Budget — income positive, expenses negative.",
            steps: ["Reports → Profit and Loss Statement (Actual vs Budget)", "Enter amounts → Create"]
          },
          {
            id: "forecasts",
            title: "Generate income and expense forecasts",
            summary: "Settings → Forecasts assumptions, then Forecast P&L report. Can Copy to budget.",
            steps: ["Settings → Forecasts", "Reports → Forecast Profit & Loss Statement"]
          },
          {
            id: "quick-pl",
            title: "Prepare a quick profit and loss statement",
            summary: "Journal income credits and expense debits, then run P&L — for banks/accountants when detailed books are not ready.",
            steps: ["Journal Entries with period totals", "Reports → P&L for the year", "Add comparative columns if needed"]
          },
          {
            id: "custom-reports",
            title: "Create custom reports",
            summary: "Visual query builder: Select, Where, Order by, Group by.",
            steps: ["Reports → Custom Reports → New", "Build query → Create"]
          }
        ]
      },
      {
        id: "history",
        title: "4.11 History",
        articles: [
          {
            id: "audit-history",
            title: "Audit transaction history",
            summary: "History button: timestamps, users, actions. Undo specific actions (order-independent). Filter by user/category.",
            steps: ["History at top of window", "View / Undo an action", "Or History on a single transaction"],
            notes: ["Back up before Undo on linked transactions."]
          }
        ]
      }
    ]
  },
  {
    id: "banking",
    number: "5",
    title: "Bank and Cash Accounts",
    intro: "Banks, cash, receipts, payments, transfers, and reconciliations.",
    sections: [
      {
        id: "bank-accounts",
        title: "5.1 Bank and Cash Accounts",
        articles: [
          {
            id: "setup-bank-cash",
            title: "Set up a bank or cash account",
            summary: "Enable Banking. Name, currency, control account, pending option, credit limit.",
            steps: ["Customize → Banking", "New Account", "Configure options → Create"]
          },
          {
            id: "credit-cards",
            title: "Set up credit cards",
            summary: "Contra asset under Cash at bank, or liability via custom control account.",
            steps: ["Create bank account for the card", "Optionally reassign to Current liabilities control account"]
          },
          {
            id: "cleared-pending",
            title: "Track cleared and pending status",
            summary: "Cleared field on bank receipts/payments and inter-account legs.",
            steps: ["Set Cleared same date or later/Pending", "Clear via pending drill-down when bank posts"]
          },
          {
            id: "import-statements",
            title: "Import bank statements",
            summary: "QIF/OFX/QFX/CSV etc. Categorize Uncategorized Receipts/Payments by edit or rules.",
            steps: ["Import bank statement", "Review → Import", "Edit or New Rule → Batch Update"]
          },
          {
            id: "multi-currency-banking",
            title: "Use multiple currencies",
            summary: "Base + foreign currencies; Foreign exchange gains (losses) activates. Optional Currency amount on receipts.",
            steps: ["Set base and foreign currencies", "Denominate banks/customers", "Enter exchange rates"]
          }
        ]
      },
      {
        id: "receipts",
        title: "5.2 Receipts",
        articles: [
          {
            id: "record-receipt",
            title: "Record a receipt",
            summary: "New Receipt into bank/cash; post to income, AR+invoice, capital, or inventory.",
            steps: ["Receipts → New Receipt", "Paid by, Received in, lines → Create"]
          },
          {
            id: "receipt-rules",
            title: "Use receipt rules for imports",
            summary: "Match description/amount/bank and auto-post.",
            steps: ["Settings → Receipt Rules → New", "Or New Receipt Rule while categorizing"]
          },
          {
            id: "cash-sales",
            title: "Make cash sales (without sales invoices)",
            summary: "Immediate payment; no AR. Credits and statements require invoices instead.",
            steps: ["Receipt → post to income / inventory items"]
          },
          {
            id: "customer-deposits",
            title: "Record customer deposits and advances",
            summary: "Receipt to Accounts receivable (no invoice) — applies to next sales invoice automatically.",
            steps: ["Receipt → Customer → Accounts receivable → leave Invoice blank"]
          },
          {
            id: "find-recode-receipts",
            title: "Find and recode receipts",
            summary: "Bulk recode bank receipt lines to new accounts/tax codes.",
            steps: ["Receipts → Find & recode", "Select → Bulk Update"]
          },
          {
            id: "exchange-receipt",
            title: "Exchange inventory with a receipt form",
            summary: "Positive qty for returns in; negative qty for replacements out.",
            steps: ["New Receipt with mixed positive/negative inventory lines"]
          },
          {
            id: "early-pay-discount-receipt",
            title: "Early payment discounts on receipts",
            summary: "Receive reduced amount; create credit note from pending early-payment banner.",
            steps: ["Receipt for amount paid", "Sales Invoices banner → Create credit notes"]
          },
          {
            id: "dishonored-cheques",
            title: "Handle dishonored cheques",
            summary: "Leave Pending, delete, or reverse with negative receipt — depending on bank treatment.",
            steps: ["Choose Pending / Delete / Reverse", "Bank fees as separate payment"]
          },
          {
            id: "receipts-from-statements",
            title: "Create receipts from customer statements",
            summary: "Copy unpaid-invoice statement to New Receipt.",
            steps: ["Reports → Customer Statements (Unpaid)", "View → Copy to → New Receipt"]
          }
        ]
      },
      {
        id: "payments",
        title: "5.3 Payments",
        articles: [
          {
            id: "record-payment",
            title: "Record a payment",
            summary: "New Payment from bank/cash to expenses, AP+invoice, capital, assets, payroll, inventory.",
            steps: ["Payments → New Payment", "Complete → Create"]
          },
          {
            id: "payment-rules",
            title: "Use payment rules for imports",
            summary: "Same pattern as receipt rules for withdrawals.",
            steps: ["Settings → Payment Rules → New"]
          },
          {
            id: "cash-purchases",
            title: "Make cash purchases (without purchase invoices)",
            summary: "Pay immediately; no AP. Credits need purchase invoices.",
            steps: ["Payment → expense / inventory"]
          },
          {
            id: "supplier-deposits",
            title: "Record supplier deposits and advances",
            summary: "Payment to Accounts payable (no invoice) — applies to next purchase invoice.",
            steps: ["Payment → Supplier → Accounts payable → leave Invoice blank"]
          },
          {
            id: "find-recode-payments",
            title: "Find and recode payments",
            summary: "Bulk recode bank payment lines.",
            steps: ["Payments → Find & recode → Bulk Update"]
          },
          {
            id: "exchange-payment",
            title: "Exchange inventory with a payment form",
            summary: "Positive qty for customer returns; negative for replacements given.",
            steps: ["New Payment with mixed inventory signs"]
          },
          {
            id: "pay-refund",
            title: "Pay a refund",
            summary: "Cash-sale refunds: negative receipt (not payment). AR credit refunds: Payment to Accounts receivable.",
            steps: ["Clone/copy original receipt with negative amounts", "Or Payment → Accounts receivable"]
          },
          {
            id: "early-pay-discount-purchase",
            title: "Early payment discounts on purchases",
            summary: "Debit note or adjusted payment with negative discount line.",
            steps: ["Debit note for discount, then pay reduced amount", "Or payment with AP full + negative discount line"]
          },
          {
            id: "payments-from-statements",
            title: "Create payments from supplier statements",
            summary: "Copy unpaid supplier statement to New Payment.",
            steps: ["Reports → Supplier Statements (Unpaid)", "Copy to → New Payment"]
          }
        ]
      },
      {
        id: "transfers",
        title: "5.4 Inter Account Transfers",
        articles: [
          {
            id: "inter-account",
            title: "Transfer money between bank and cash accounts",
            summary: "Inter Account Transfers tab — records only; you still move the money.",
            steps: ["Customize → Inter Account Transfers", "New → from/to, amounts, cleared status"]
          },
          {
            id: "transfers-from-import",
            title: "Post inter account transfers from imported statements",
            summary: "Use a Transfer clearing BS account; categorize both legs to it. Do not also enter Inter Account Transfers.",
            steps: ["Create Transfer clearing asset", "Rules or edit import lines to clearing", "Both legs zero the clearing account"]
          }
        ]
      },
      {
        id: "reconciliations",
        title: "5.5 Bank Reconciliations",
        articles: [
          {
            id: "reconcile",
            title: "Reconcile bank accounts",
            summary: "New Bank Reconciliation with statement balance; fix pending and missing txs until Discrepancy is zero.",
            steps: ["Customize → Bank Reconciliations", "New → date, account, statement balance", "Resolve Not reconciled via drill-down"]
          }
        ]
      }
    ]
  },
  {
    id: "expense-claims",
    number: "6",
    title: "Expense Claims",
    intro: "Business expenses paid with personal funds or statutory allowances.",
    sections: [
      {
        id: "claims",
        title: "6.1 Expense Claims",
        articles: [
          {
            id: "claim-payers",
            title: "Set up expense claim payers",
            summary: "Settings → Expense Claim Payers for directors/others; Members and Employees also qualify.",
            steps: ["Settings → Expense Claim Payers → New"]
          },
          {
            id: "use-claims",
            title: "Use expense claims",
            summary: "Enable tab; New Claim; settle via Payment to Expense claims / Employee clearing, or capital contribution.",
            steps: ["Customize → Expense Claims", "New Expense Claim", "Reimburse with Payment"]
          }
        ]
      }
    ]
  },
  {
    id: "selling",
    number: "7",
    title: "Selling to Customers",
    intro: "Customers through portals — quotes, orders, invoices, credits, fees, delivery, billable time/expenses.",
    sections: [
      {
        id: "customers",
        title: "7.1 Customers",
        articles: [
          {
            id: "enter-customers",
            title: "Enter customers",
            summary: "Required for credit sales, statements, quotes, deposits, billable time. Cash sales can use Other.",
            steps: ["Customize → Customers", "New Customer → Create"]
          },
          {
            id: "edit-customers",
            title: "Edit or add customer information",
            summary: "Codes, addresses, custom fields (e.g. delivery routes).",
            steps: ["Edit customer", "Settings → Custom Fields for Customers"]
          },
          {
            id: "customer-starting",
            title: "Set starting balances for customers",
            summary: "Available credit on customer; unpaid invoices as pre-start sales invoices.",
            steps: ["Edit customer → Available credit", "Enter unpaid invoices with original dates"]
          },
          {
            id: "customer-codes",
            title: "Use customer codes",
            summary: "Optional codes; add {{ recipient.code }} in themes to print.",
            steps: ["Edit customer → Code", "Optionally edit theme"]
          },
          {
            id: "inactive-customers",
            title: "Manage inactive customers",
            summary: "Inactive hides from lists; cannot delete if used.",
            steps: ["Edit → Inactive → Update"]
          }
        ]
      },
      {
        id: "sales-quotes",
        title: "7.2 Sales Quotes",
        articles: [
          {
            id: "create-quotes",
            title: "Create sales quotes",
            summary: "No financial impact. New, Clone, or Copy to. Optional expiry, discounts, custom title.",
            steps: ["Customize → Sales Quotes", "New / Clone / Copy to"]
          },
          {
            id: "quote-status",
            title: "Monitor sales quote status",
            summary: "Active, Expired, Accepted (linked order/invoice), Cancelled.",
            steps: ["Link via Copy to or Quote number on order/invoice", "Cancel obsolete quotes"]
          }
        ]
      },
      {
        id: "sales-orders",
        title: "7.3 Sales Orders",
        articles: [
          {
            id: "create-orders",
            title: "Create sales orders",
            summary: "Internal planning; no GL/inventory impact until invoiced/delivered.",
            steps: ["Customize → Sales Orders", "New / Clone / Copy to"]
          },
          {
            id: "order-status",
            title: "Monitor sales order status",
            summary: "Qty to deliver, Invoiced amount, status progression to Invoiced.",
            steps: ["Track quantity to deliver on lines", "Link invoices via Order number or Copy to"]
          }
        ]
      },
      {
        id: "sales-invoices",
        title: "7.4 Sales Invoices",
        articles: [
          {
            id: "create-invoices",
            title: "Create sales invoices",
            summary: "Increases AR. Standard, Clone, from Customers uninvoiced, or Copy to.",
            steps: ["Sales Invoices → New", "Customer, lines, tax, options → Create"]
          },
          {
            id: "recurring-sales",
            title: "Set up and manage recurring sales invoices",
            summary: "Templates under Settings; create when banner shows pending.",
            steps: ["Settings → Recurring Sales Invoices", "Or Copy to recurring", "Batch Create when due"]
          },
          {
            id: "invoice-status",
            title: "Monitor sales invoice status",
            summary: "Overpaid, due, overdue, paid — automatic.",
            steps: ["Review Status column on Sales Invoices"]
          },
          {
            id: "first-invoice",
            title: "Issue your first invoice to a customer",
            summary: "Business details → enable Customers & Sales Invoices → New Customer → New Invoice.",
            steps: ["Settings → Business Details", "Customize tabs", "New Customer", "New Sales Invoice"]
          },
          {
            id: "early-pay-offer",
            title: "Offer early payment discounts on sales invoices",
            summary: "Check Early payment discount; accounting adjusts when paid early via credit note.",
            steps: ["Check Early payment discount → rate and days"]
          },
          {
            id: "refresh-prices",
            title: "Refresh unit prices on sales invoices",
            summary: "Clear Item and reselect to pull current sales price after Clone/Copy.",
            steps: ["Clear Item field → reselect same item"]
          },
          {
            id: "resolve-overpaid",
            title: "Resolve overpaid status on sales invoices",
            summary: "Edit receipt allocations; leave overpayment unallocated for other/future invoices.",
            steps: ["Drill Balance due → edit receipt lines"]
          },
          {
            id: "auto-credit-allocations",
            title: "Resolve automatic credit allocations",
            summary: "Pre-existing customer credit applies to new invoices. Fix mis-posted receipts/credit notes.",
            steps: ["Review mini-statement / customer drill-down", "Edit allocations"]
          },
          {
            id: "offset-sales-purchase",
            title: "Offset simultaneous sales and purchase invoices",
            summary: "Contra journal, offsetting receipt/payment, or credit+debit notes when same party is customer and supplier.",
            steps: ["Choose journal / receipt-payment / credit+debit method", "Coordinate with the other party"]
          }
        ]
      },
      {
        id: "credit-notes",
        title: "7.5 Credit Notes",
        articles: [
          {
            id: "credit-notes",
            title: "Use credit notes for returns and refunds",
            summary: "Adjusts AR (and inventory). Copy from sales invoice easiest. Pay refund via Payment to AR if needed.",
            steps: ["Customize → Credit Notes", "New or Copy from invoice", "Optional Payment refund"]
          }
        ]
      },
      {
        id: "late-fees",
        title: "7.6 Late Payment Fees",
        articles: [
          {
            id: "late-fees",
            title: "Assess late payment fees",
            summary: "Due date + Late payment fees % on invoice; create from banner. Or manual Late Payment Fees tab.",
            steps: ["Set due date and fee % on invoice", "Create from pending banner", "Or New Late Payment Fee"]
          }
        ]
      },
      {
        id: "delivery-notes",
        title: "7.7 Delivery Notes",
        articles: [
          {
            id: "create-delivery",
            title: "Create delivery notes",
            summary: "Optional packing/delivery docs. When enabled, separates delivery from invoicing for tracked items.",
            steps: ["Customize → Delivery Notes", "New / Clone / Copy to"],
            notes: ["Think carefully before enabling — hard to reverse."]
          },
          {
            id: "use-delivery",
            title: "Use delivery notes",
            summary: "Per-item Track quantity to deliver. Link Order number for fulfillment tracking.",
            steps: ["Edit inventory item → Track quantity to deliver", "Create delivery notes for defined customers"]
          }
        ]
      },
      {
        id: "billable-time",
        title: "7.8 Billable Time",
        articles: [
          {
            id: "record-time",
            title: "Record billable time",
            summary: "Hourly work for customers. Activates Billable time asset and related P&L accounts.",
            steps: ["Customize → Billable Time", "New → customer, rate, hours"]
          },
          {
            id: "time-custom-fields",
            title: "Add billable time details with custom fields",
            summary: "Staff, service type, etc. as columns.",
            steps: ["Settings → Custom Fields → Billable Time"]
          },
          {
            id: "invoice-time",
            title: "Invoice billable time",
            summary: "Customers → Uninvoiced → select → New Sales Invoice.",
            steps: ["Customers → Uninvoiced amount", "Select time → New Sales Invoice"]
          },
          {
            id: "writeoff-time",
            title: "Write off or write down billable time",
            summary: "Status Written-off, edit amount, invoice discount, bad-debt JE, or credit note to Billable time - invoiced.",
            steps: ["Choose before / during / after invoicing approach"]
          }
        ]
      },
      {
        id: "billable-expenses",
        title: "7.9 Billable Expenses",
        articles: [
          {
            id: "record-billable-exp",
            title: "Record billable expenses",
            summary: "Post Payments / PIs / Claims / Journals / Debit notes to Billable expenses + Customer.",
            steps: ["Post line to Billable expenses → Customer → Uninvoiced"]
          },
          {
            id: "invoice-billable-exp",
            title: "Invoice billable expenses",
            summary: "Same Uninvoiced flow as time; markup edits Billable expenses - invoiced only.",
            steps: ["Customers → Uninvoiced → New Sales Invoice"]
          },
          {
            id: "writeoff-billable-exp",
            title: "Write off or write down billable expenses",
            summary: "Repost to expense before invoice; discount on invoice; bad debt or credit to Billable expenses - invoiced after.",
            steps: ["Edit source posting or invoice discount / credit note"]
          }
        ]
      },
      {
        id: "withholding",
        title: "7.10 Withholding Tax Receipts",
        articles: [
          {
            id: "withholding-sales",
            title: "Account for withholding tax on sales invoices",
            summary: "Check Withholding tax on SI; record proof → moves receivable to Withholding tax; JE when applied on tax filing.",
            steps: ["Sales invoice → Withholding tax rate/amount", "Customers → New Receipt for remittance proof", "Journal when applied to tax bill"]
          }
        ]
      },
      {
        id: "portals",
        title: "7.11 Customer Portals",
        articles: [
          {
            id: "customer-portals",
            title: "Establish customer portals",
            summary: "Settings → Customer Portals — view-only quotes/orders/invoices/credits/delivery. Share hyperlink (cloud/server).",
            steps: ["Settings → Customer Portals → New", "Select types → Create", "Share Go to Customer Portal link"],
            notes: ["Treat portal content as potentially public — link is the only access control."]
          }
        ]
      }
    ]
  },
  {
    id: "purchasing",
    number: "8",
    title: "Purchasing from Suppliers",
    intro: "Suppliers, quotes, orders, invoices, debit notes, and goods receipts.",
    sections: [
      {
        id: "suppliers",
        title: "8.1 Suppliers",
        articles: [
          {
            id: "enter-suppliers",
            title: "Enter suppliers",
            summary:
              "Add name, category, contacts, location, email, and optional opening balances per currency.",
            steps: [
              "Purchases → Suppliers → New",
              "Enter name, category, contacts, location, email",
              "Optionally enter Opening balance for each allowed currency",
              "Create",
            ],
          },
          {
            id: "edit-suppliers",
            title: "Edit or add supplier information",
            summary: "Update category, phone contacts, location, and email on the supplier record.",
            steps: ["Edit supplier", "Update fields → Save"],
          },
          {
            id: "supplier-starting",
            title: "Set starting balances for suppliers",
            summary:
              "Enter opening amounts per allowed currency on the supplier (or unpaid opening bills).",
            steps: [
              "Purchases → Suppliers → New / Edit",
              "Enter Opening balance for each currency (UGX, USD, …)",
              "Save — opening bills are posted to Accounts Payable automatically",
            ],
          },
          {
            id: "supplier-codes",
            title: "Use supplier codes",
            summary: "Optional; theme {{ recipient.code }} to print.",
            steps: ["Edit → Code"]
          },
          {
            id: "inactive-suppliers",
            title: "Manage inactive suppliers",
            summary: "Inactive when unused going forward.",
            steps: ["Edit → Inactive"]
          }
        ]
      },
      {
        id: "purchase-quotes",
        title: "8.2 Purchase Quotes",
        articles: [
          {
            id: "purchase-quotes",
            title: "Create purchase quotes or requests for quotation",
            summary: "RFQ unpriced or priced quote. Copy to PO/PI/goods receipt.",
            steps: ["Customize → Purchase Quotes", "New — Request for quotation option if unpriced"]
          }
        ]
      },
      {
        id: "purchase-orders",
        title: "8.3 Purchase Orders",
        articles: [
          {
            id: "purchase-orders",
            title: "Issue purchase orders",
            summary: "No financial/inventory impact until invoiced/received.",
            steps: ["Customize → Purchase Orders", "New / Clone / Copy to"]
          }
        ]
      },
      {
        id: "purchase-invoices",
        title: "8.4 Purchase Invoices",
        articles: [
          {
            id: "create-pi",
            title: "Create purchase invoices",
            summary: "Enter supplier sales invoices; increases AP.",
            steps: ["Purchase Invoices → New", "Or Clone / Copy to"]
          },
          {
            id: "recurring-pi",
            title: "Set up and manage recurring purchase invoices",
            summary: "Like recurring sales — Settings templates + Batch Create.",
            steps: ["Settings → Recurring Purchase Invoices", "Batch Create when due"]
          },
          {
            id: "pi-status",
            title: "Monitor purchase invoice status",
            summary: "Overpaid, due, overdue, paid.",
            steps: ["Review Status column"]
          },
          {
            id: "freight-in",
            title: "Add freight-in to inventory item costs",
            summary: "Manual blank-qty line or Freight-in item for proportional distribution.",
            steps: ["Add freight line on PI", "Or Freight-in for auto distribute"]
          },
          {
            id: "withholding-purchases",
            title: "Withholding tax on purchase invoices",
            summary: "Check Withholding tax; remit via Payment to Withholding tax payable.",
            steps: ["PI → Withholding tax", "Payment → Withholding tax payable"]
          },
          {
            id: "rounding-pi",
            title: "Adjust rounding differences on purchase invoices",
            summary: "Use exact discounts or tweak unit prices to match supplier total.",
            steps: ["Avoid % discount if methods differ", "Enter exact amounts"]
          },
          {
            id: "resolve-overpaid-pi",
            title: "Resolve overpaid status on purchase invoices",
            summary: "Edit payment allocations or debit note links.",
            steps: ["Drill Balance due → fix payment/debit note"]
          },
          {
            id: "offset-pi-si",
            title: "Offset simultaneous sales and purchase invoices",
            summary: "Same three methods as on the sales side.",
            steps: ["Journal / offsetting receipt-payment / credit+debit notes"]
          }
        ]
      },
      {
        id: "debit-notes",
        title: "8.5 Debit Notes",
        articles: [
          {
            id: "debit-notes",
            title: "Use debit notes for supplier returns and refunds",
            summary: "Internal response to supplier credit notes; adjusts AP and inventory.",
            steps: ["Customize → Debit Notes", "New / Copy from PI", "Receipt if cash refund"]
          }
        ]
      },
      {
        id: "goods-receipts",
        title: "8.6 Goods Receipts",
        articles: [
          {
            id: "create-gr",
            title: "Create goods receipts",
            summary: "Optional; separates receiving from purchasing for tracked items.",
            steps: ["Customize → Goods Receipts", "New / Copy to"],
            notes: ["Hard to reverse once used."]
          },
          {
            id: "use-gr",
            title: "Use goods receipts",
            summary: "Per-item Track quantity to receive.",
            steps: ["Edit item → Track quantity to receive", "Create goods receipts from defined suppliers"]
          }
        ]
      }
    ]
  },
  {
    id: "inventory",
    number: "9",
    title: "Inventory",
    intro: "Overview, items, transfers, adjustments, and production orders. Average cost valuation.",
    sections: [
      {
        id: "overview",
        title: "9.1 Overview",
        articles: [
          {
            id: "inv-intro",
            title: "Manage inventory — Introduction",
            summary: "Items, PIs/SIs, cash buy/sell, production, kits, locations, transfers, write-offs, reports. Perpetual average cost.",
            steps: ["Enable Inventory Items", "Purchase and sell with inventory lines", "Review Inventory reports"]
          },
          {
            id: "inv-continuation",
            title: "Manage inventory — Continuation",
            summary: "Credit/debit notes, kits, delivery notes, goods receipts change qty columns (to deliver / to receive / owned).",
            steps: ["Enable Delivery Notes / Goods Receipts only if needed", "Define kits under Settings"]
          },
          {
            id: "inv-conclusion",
            title: "Manage inventory — Conclusion",
            summary: "Locations, transfers, write-offs; Inventory on hand / sales / cost accounts; prefer accrual with inventory.",
            steps: ["Settings → Inventory Locations", "Transfers and Write-offs tabs", "Review BS and P&L effects"]
          }
        ]
      },
      {
        id: "items",
        title: "9.2 Inventory Items",
        articles: [
          {
            id: "create-items",
            title: "Create and manage inventory items",
            summary: "Code, name, prices, accounts, track receive/deliver options.",
            steps: ["Inventory Items → New", "Edit / Inactive when obsolete"]
          },
          {
            id: "inventory-kits",
            title: "Use inventory kits",
            summary: "Sell bundled components without pre-assembly; components reduce stock.",
            steps: ["Settings → Inventory Kits → New", "Use on sales forms like an item"]
          },
          {
            id: "inv-starting",
            title: "Set starting balances for inventory items",
            summary: "Start date + qty and average cost per location.",
            steps: ["Edit item → Starting balance quantity and cost"]
          },
          {
            id: "merge-items",
            title: "Find and merge duplicate inventory items",
            summary: "Find & merge by Item code; keeps most-referenced definition.",
            steps: ["Inventory Items → Find & merge → Merge"]
          }
        ]
      },
      {
        id: "transfers",
        title: "9.3 Inventory Transfers",
        articles: [
          {
            id: "inv-locations",
            title: "Use inventory locations",
            summary: "Settings → Inventory Locations. Default Unspecified until transferred.",
            steps: ["Settings → Inventory Locations → New", "Select Location on forms / delivery / GR"]
          },
          {
            id: "inv-transfers",
            title: "Transfer inventory between locations",
            summary: "Inventory Transfers tab — records movement; physically move stock too.",
            steps: ["Customize → Inventory Transfers", "New → from/to locations"]
          }
        ]
      },
      {
        id: "adjustments",
        title: "9.4 Inventory Adjustments",
        articles: [
          {
            id: "write-off-inv",
            title: "Write off inventory",
            summary: "Loss, damage, samples, internal use — debit expense, reduce Inventory on hand.",
            steps: ["Customize → Inventory Write-offs", "New Write-Off"]
          },
          {
            id: "write-on-inv",
            title: "Write on inventory",
            summary: "Journal debit Inventory on hand + item; credit adjustments income/expense.",
            steps: ["Journal Entries with Inventory on hand line", "Use average cost or write-off cost"]
          }
        ]
      },
      {
        id: "production",
        title: "9.5 Production Orders",
        articles: [
          {
            id: "production-orders",
            title: "Use production orders to manufacture inventory items",
            summary: "Finished items + bill of materials + optional non-inventory costs.",
            steps: ["Production Orders → New", "Finished item, BOM, costs → Create"]
          },
          {
            id: "production-stages",
            title: "Manage production stages",
            summary: "Stage numbers ensure same-day orders cost correctly. Fix alerts via Batch Update.",
            steps: ["Edit items → Production stage", "Or follow Inventory Items alert"]
          },
          {
            id: "insufficient-qty",
            title: "Understand insufficient quantity on a production order",
            summary: "Finished goods costed when inputs owned; Production in progress holds partial costs.",
            steps: ["Watch Status Insufficient Qty → Complete after purchases"]
          },
          {
            id: "production-repairs",
            title: "Use production orders for repairs or improvements",
            summary: "Finished qty 0; BOM consumes parts; costs add to finished item average cost.",
            steps: ["Production order with Finished qty 0", "Parts on BOM + labor as non-inventory cost"]
          }
        ]
      }
    ]
  },
  {
    id: "payroll",
    number: "10",
    title: "Employees and Payroll",
    intro: "Employees, payslip items, payslips, and paying from Employee clearing account.",
    sections: [
      {
        id: "employees",
        title: "10.1 Employees",
        articles: [
          {
            id: "enter-employees",
            title: "Enter employees",
            summary: "Enable Employees; activates Employee clearing account. Third-party payroll may skip this tab.",
            steps: ["Customize → Employees", "New Employee → Create", "Inactive when terminated"]
          },
          {
            id: "pay-employees",
            title: "Pay employees",
            summary: "Payslips do not pay cash — Payment from bank to Employee clearing (+ employee).",
            steps: ["View payslip → New Payment", "Or Employees total → New Payment for bulk"]
          }
        ]
      },
      {
        id: "departments",
        title: "10.1b Departments",
        articles: [
          {
            id: "enter-departments",
            title: "Add departments",
            summary: "HR → Departments is the master list used on employees, drivers, and fleet documents.",
            steps: [
              "HR & Payroll → Departments → New",
              "Enter name, code, head of department, and status",
              "Assign the department on Employees (or Drivers)",
            ],
          },
        ],
      },
      {
        id: "payslips",
        title: "10.2 Payslips",
        articles: [
          {
            id: "payslip-items",
            title: "Set up payslip items",
            summary: "Earnings, Deductions, Contributions — link to expense and liability accounts.",
            steps: ["Settings → Payslip Items", "New earnings / deduction / contribution"]
          },
          {
            id: "issue-payslips",
            title: "Issue payslips",
            summary: "Select employee and items; email if address on file. Still need Payment afterward.",
            steps: ["Payslips → New Payslip → Create"]
          },
          {
            id: "recurring-payslips",
            title: "Set up and manage recurring payslips",
            summary: "Settings → Recurring Payslips; Batch Create from banner.",
            steps: ["Settings → Recurring Payslips → New", "Batch Create when due"]
          }
        ]
      }
    ]
  },
  {
    id: "investments",
    number: "11",
    title: "Investments",
    intro: "Marketable securities — shares, bonds, funds.",
    sections: [
      {
        id: "investments-sec",
        title: "11.1 Investments",
        articles: [
          {
            id: "track-investments",
            title: "Track investments in marketable securities",
            summary: "Enable Investments; create investment; buy/sell via Payments/Receipts. Keep market prices updated.",
            steps: ["Customize → Investments", "New Investment", "Transact via Receipts/Payments"],
            notes: ["Unrealized gains need current Market price on the investment."]
          }
        ]
      }
    ]
  },
  {
    id: "fixed-assets",
    number: "12",
    title: "Fixed Assets",
    intro: "Capitalize tangible assets and record depreciation.",
    sections: [
      {
        id: "fa",
        title: "12.1 Fixed Assets",
        articles: [
          {
            id: "purchase-fa",
            title: "Purchase fixed assets",
            summary: "Create asset then post purchase to Fixed assets, at cost + asset.",
            steps: ["Customize → Fixed Assets", "New Fixed Asset", "Payment / PI / JE to Fixed assets"]
          },
          {
            id: "expense-fa",
            title: "Expense fixed assets",
            summary: "Track exception depreciation (e.g. full expensing) with custom fields for method and recovery period.",
            steps: ["Custom Fields on Fixed Assets for in-service date, method, recovery end"]
          },
          {
            id: "dispose-fa",
            title: "Dispose of fixed assets",
            summary: "Check Disposed fixed asset + date; optional sale receipt before/after.",
            steps: ["Edit asset → Disposed → date", "Post sale receipt if sold"]
          },
          {
            id: "migrate-fa",
            title: "Migrate fixed assets from prior system",
            summary: "Create asset + starting Acquisition cost and Accumulated depreciation.",
            steps: ["New Fixed Asset → Entry type: Opening balance", "Enter cost and accumulated depreciation"]
          }
        ]
      },
      {
        id: "depreciation",
        title: "12.2 Depreciation Entries",
        articles: [
          {
            id: "depreciate",
            title: "Depreciate fixed assets",
            summary: "Depreciation Entries tab — manual amount per asset.",
            steps: ["Customize → Depreciation Entries", "New Depreciation Entry"]
          },
          {
            id: "auto-depreciation",
            title: "Calculate depreciation automatically",
            summary: "Depreciation Calculation Worksheet (declining balance from annual %). Enter rates on assets first.",
            steps: ["Set Depreciation rate on assets", "Reports → Depreciation Calculation Worksheet", "New Depreciation Entry from report"],
            notes: ["Currently declining balance only — not for pure straight-line schemes."]
          }
        ]
      }
    ]
  },
  {
    id: "intangible-assets",
    number: "13",
    title: "Intangible Assets",
    intro: "Patents, licenses, goodwill — capitalize and amortize.",
    sections: [
      {
        id: "ia",
        title: "13.1 Intangible Assets",
        articles: [
          {
            id: "purchase-ia",
            title: "Purchase intangible assets",
            summary: "Create asset; post acquisition to Intangible assets, at cost.",
            steps: ["Customize → Intangible Assets", "New", "Payment / PI / JE"]
          },
          {
            id: "dispose-ia",
            title: "Dispose of intangible assets",
            summary: "Disposed intangible asset + date; optional sale.",
            steps: ["Edit → Disposed → date"]
          },
          {
            id: "migrate-ia",
            title: "Migrate intangible assets from prior system",
            summary: "Starting Acquisition cost and Accumulated amortization.",
            steps: ["New intangible → Entry type: Opening balance", "Enter cost and accumulated amortization"]
          }
        ]
      },
      {
        id: "amortization",
        title: "13.2 Amortization Entries",
        articles: [
          {
            id: "amortize",
            title: "Amortize intangible assets",
            summary: "Amortization Entries tab.",
            steps: ["Customize → Amortization Entries", "New Amortization Entry"]
          },
          {
            id: "auto-amortization",
            title: "Calculate amortization automatically",
            summary: "Amortization Calculation Worksheet from annual % (declining balance).",
            steps: ["Set Amortization rate", "Reports → Amortization Calculation Worksheet", "Post entry from report"]
          }
        ]
      }
    ]
  },
  {
    id: "journals",
    number: "14",
    title: "Journal Entries",
    intro: "Adjusting entries — not for cash receipts or payments.",
    sections: [
      {
        id: "je",
        title: "14.1 Journal Entries",
        articles: [
          {
            id: "make-journals",
            title: "Make journal entries",
            summary: "Debits = credits. Optional tax codes with sale/purchase adjustment designation.",
            steps: ["Journal Entries → New", "Balance lines → Create"]
          },
          {
            id: "recurring-journals",
            title: "Set up and manage recurring journal entries",
            summary: "Settings → Recurring Journal Entries; Batch Create from banner.",
            steps: ["Settings → Recurring Journal Entries", "Batch Create when due"]
          },
          {
            id: "bad-debts",
            title: "Write off bad debts",
            summary: "JE debit Bad debts, credit AR (+ invoice). Handle tax payable vs not-payable cases carefully.",
            steps: ["Add Bad debts expense account", "Journal write-off", "Reverse JE if later recovered"]
          }
        ]
      }
    ]
  },
  {
    id: "advanced",
    number: "15",
    title: "Advanced",
    intro: "Version, application data, users, self-hosting, and support.",
    sections: [
      {
        id: "version",
        title: "15.1 Software Version",
        articles: [
          {
            id: "version-number",
            title: "Determine version number",
            summary: "Shown in gray text at the bottom of screens (and in FinanceIAG about/build info if present).",
            steps: ["Look at the footer version string"]
          }
        ]
      },
      {
        id: "app-data",
        title: "15.2 Application Data",
        articles: [
          {
            id: "manage-app-data",
            title: "Manage application data folder contents",
            summary: "Each business backup is a .financeiag file. Safe to remove obsolete relic files after verifying active businesses.",
            steps: ["Open application data path from Businesses page", "Identify *.financeiag business files", "Remove only confirmed relics"]
          },
          {
            id: "move-app-data",
            title: "Move desktop application data to another folder",
            summary: "Change Folder on Businesses page, then import/move *.financeiag files. Or open backups directly.",
            steps: ["Create new folder", "Change Folder", "Import or move .financeiag files"],
            notes: ["Avoid editing the same cloud-synced file from two PCs at once."]
          },
          {
            id: "reduce-file-size",
            title: "Reduce data file size",
            summary: "Compact via file size link on Businesses page — preserves data.",
            steps: ["Businesses → click file size → compact"]
          },
          {
            id: "open-data-direct",
            title: "Open a data file directly",
            summary: "Open a .financeiag backup from FinaceManagerIAG — separate from the live Businesses list copy.",
            steps: ["Open file from Finder/Explorer", "Do not mix edits with another copy"]
          }
        ]
      },
      {
        id: "users-advanced",
        title: "15.3 Users",
        articles: [
          {
            id: "reset-admin",
            title: "Reset the administrator password",
            summary: "Server: delete password file in app data. Cloud: use customer support page.",
            steps: ["Server: delete password file → login administrator with blank password → set new password", "Cloud: Customer Service password reset"]
          },
          {
            id: "login-logo",
            title: "Display a custom logo on the user login screen",
            summary: "Cloud Upload Logo or server logo.png in app data. Distinct from business form logo.",
            steps: ["Cloud: Upload Logo on cloud home", "Server: place logo.png in application data"]
          }
        ]
      },
      {
        id: "self-hosting",
        title: "15.4 Self-Hosting",
        articles: [
          {
            id: "self-host",
            title: "Self-host a FinaceManagerIAG installation",
            summary: "Server edition on your hardware. Prefer cloud unless you already run servers.",
            steps: ["Follow Installation for your OS at finacemanageriag.io", "Purchase/renew server license for updates", "Update like reinstall"]
          }
        ]
      },
      {
        id: "cloud-support",
        title: "15.5 Cloud edition customer support",
        articles: [
          {
            id: "cloud-support",
            title: "Obtain cloud edition customer support",
            summary: "Cloud Edition home → Customer Service menu; email if needed.",
            steps: ["Open finacemanageriag.io → Customer Service", "Pick the support function"]
          }
        ]
      }
    ]
  },
  {
    id: "fleet",
    number: "16",
    title: "Fleet",
    intro: "Vehicles, drivers, fuel, trips, and maintenance with ledger posting.",
    sections: [
      {
        id: "fleet-setup",
        title: "16.1 Setup",
        articles: [
          {
            id: "fleet-vehicles",
            title: "Register vehicles and link fixed assets",
            summary: "Create each vehicle with plate, odometer, insurance/registration expiry, and optional Fixed asset code (e.g. FA-VAN-01).",
            steps: [
              "Fleet → Vehicles → New",
              "Enter name, plate, driver, odometer",
              "Set insurance and registration expiry",
              "Link fixed asset code if capitalised under Assets",
            ],
          },
          {
            id: "fleet-drivers",
            title: "Maintain the drivers roster",
            summary: "Drivers hold licence details and can link to HR Employees.",
            steps: ["Fleet → Drivers → New", "Enter licence number and expiry", "Optionally link Employee"],
          },
        ],
      },
      {
        id: "fleet-fuel",
        title: "16.2 Fuel",
        articles: [
          {
            id: "fleet-fuel-request",
            title: "Request and approve fuel",
            summary: "Staff submit fuel requests; Accounts Assistant → GM → CEO → Finance approve (no Project Manager — PM is for projects).",
            steps: [
              "Fleet → Fuel Requests → New",
              "Submit → Accounts Assistant desk / Approve on the record",
              "After Paid → Open the request → Fulfill → fuel log",
            ],
            notes: [
              "Fulfill creates a Posted fuel log and posts Dr Fuel Expense / Cr Cash or Bank.",
            ],
          },
          {
            id: "fleet-fuel-log",
            title: "Post a fuel log directly",
            summary: "Enter litres, amount, odometer, and pay-from account. Status Approved or Posted hits the ledger.",
            steps: [
              "Fleet → Fuel Logs → New",
              "Set expense account (Fuel Expense) and bank/cash",
              "Save as Posted",
            ],
          },
        ],
      },
      {
        id: "fleet-ops",
        title: "16.3 Trips & maintenance",
        articles: [
          {
            id: "fleet-trips",
            title: "Approve and complete trips",
            summary: "Trip requests track from/to and odometer. Completing updates the vehicle odometer.",
            steps: ["Create Trip Request", "Approve", "Enter odometer end → Complete trip"],
          },
          {
            id: "fleet-maintenance",
            title: "Complete maintenance with expense posting",
            summary: "When status is Completed with an actual/estimated cost, Motor Vehicle Expense posts against bank or AP.",
            steps: [
              "Create Maintenance Request",
              "Schedule / In progress",
              "Set actual cost and pay-from → Completed",
            ],
          },
          {
            id: "fleet-cost-report",
            title: "Review fleet cost report",
            summary: "Fleet → Fleet Cost Report shows fuel spend, litres, km/L, and maintenance by vehicle.",
            steps: ["Open Fleet Cost Report", "Filter by vehicle if needed"],
          },
        ],
      },
    ],
  },
  {
    id: "pos-guide",
    number: "17",
    title: "Point of Sale",
    intro: "Registers, cash sessions, terminal sales, VAT, till variance, and daily bank deposits.",
    sections: [
      {
        id: "pos-setup",
        title: "17.1 Setup",
        articles: [
          {
            id: "pos-registers",
            title: "Create registers and dining tables",
            summary: "Each register posts tender into a bank/cash account and optional default sales account.",
            steps: [
              "POS → Registers → New",
              "Set Received in (Cash-UGX or till)",
              "Optional: Dining Tables for restaurant mode",
            ],
          },
        ],
      },
      {
        id: "pos-selling",
        title: "17.2 Selling",
        articles: [
          {
            id: "pos-session",
            title: "Open and close a cash session",
            summary: "Open with a float before selling. Close with counted cash; variance posts to Cash Over/Short.",
            steps: [
              "POS Terminal → Open session",
              "Sell tickets",
              "Enter counted cash → Close session",
            ],
          },
          {
            id: "pos-checkout",
            title: "Ring a sale with VAT and tips",
            summary: "Prices are treated as tax-inclusive using Settings → Tax codes (default VAT 18%). Tips post to Tips Received.",
            steps: [
              "Add stock or services to the cart",
              "Optional tip %",
              "Choose tender → Checkout",
            ],
            notes: ["Inventory lines reduce stock and post COGS."],
          },
          {
            id: "pos-daily-close",
            title: "Run daily closing and bank deposit",
            summary: "Daily closing summarises tender totals and deposits cash from the till into Bank-UGX.",
            steps: ["POS Terminal → Daily closing", "Review Daily Closings list"],
          },
        ],
      },
    ],
  },
];

export function findArticle(articleId: string) {
  for (const chapter of GUIDE_CHAPTERS) {
    for (const section of chapter.sections) {
      const article = section.articles.find((a) => a.id === articleId);
      if (article) return { chapter, section, article };
    }
  }
  return null;
}

/** Flat line-by-line index of every guide feature in TOC order. */
export type GuideFeatureLine = {
  index: number;
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  article: GuideArticle;
};

export function getAllGuideFeatures(): GuideFeatureLine[] {
  const lines: GuideFeatureLine[] = [];
  let index = 0;
  for (const chapter of GUIDE_CHAPTERS) {
    for (const section of chapter.sections) {
      for (const article of section.articles) {
        index += 1;
        lines.push({
          index,
          chapterId: chapter.id,
          chapterNumber: chapter.number,
          chapterTitle: chapter.title,
          sectionId: section.id,
          sectionTitle: section.title,
          article,
        });
      }
    }
  }
  return lines;
}

export const GUIDE_FEATURE_COUNT = getAllGuideFeatures().length;
