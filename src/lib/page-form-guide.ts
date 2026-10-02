import { entityDefinitions, type EntityField } from "@/lib/manager-entities";
import { moduleConfigs, NAV_MODULES } from "@/lib/module-data";

export type FormFieldGuide = {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  readOnly: boolean;
  help: string;
};

export type FormGuide = {
  key: string;
  label: string;
  meaning: string;
  requiredFields: FormFieldGuide[];
  fields: FormFieldGuide[];
};

export type PageGuide = {
  id: string;
  label: string;
  href: string;
  meaning: string;
  forms: FormGuide[];
};

/**
 * What each sidebar page is for, in plain language.
 * Keyed loosely so every frontend can share this file even when its module list differs.
 */
const PAGE_MEANING: Record<string, string> = {
  banking:
    "Banking is where the company’s real bank and cash accounts live. Create each account (for example Stanbic Current) and link it to a chart-of-accounts line (for example Bank-UGX). Statements and reconciliations check that the books match the bank. Inter-account transfers move money between those accounts.",
  "receipts-payments":
    "Receipts & Payments records money coming in and money going out. A receipt is cash or bank money received. A payment is cash or bank money paid. Receipt rules and payment rules categorise repeating transactions so they land on the right account without retyping.",
  "expense-claims":
    "Expense Claims is for money staff paid themselves, or amounts paid from an allowance, that the business still needs to record. Payers are the people or accounts that settle the claim. Each claim names the claimant, the expense, and the amount.",
  "general-requests":
    "General Requests are non-project requisitions. A requestor submits the form, then it moves Accounts Assistant → General Manager → CEO → Finance. Use this when the request is not tied to a project payment certificate.",
  "oral-payment-requests":
    "Oral Payment Requests capture a payment that was agreed verbally and still needs a written trail. The approval path is Requestor → Accounts Assistant → General Manager → CEO → Finance. These are separate from project payment requests (IPC).",
  sales:
    "Sales is the customer side of the books. Keep the customer list and their ledgers, then raise quotes, orders, invoices, credit notes, and delivery notes. Billable time and expenses can be charged on. Withholding tax receipts, customer portals, recurring invoices, and revenue contracts also live here.",
  purchases:
    "Purchases is the supplier side. Keep suppliers and their ledgers, then raise quotes, orders, and purchase invoices. Debit notes reverse a supplier charge. Goods receipts record what arrived. Recurring invoices and withholding tax sit on this page too.",
  inventory:
    "Inventory tracks stock and coffee production. Items, kits, and warehouses hold quantities and value. Stock in, transfers, write-offs, and sales move that stock. Green-bean intakes, production orders, roast batches, quality checks, packaging runs, stocktakes, and landed costs follow the product from intake to finished goods.",
  projects:
    "Project Manager is the job file. Open a project, post updates, and read the Gantt schedule. Project managers, material requests, payment requests (IPC), equipment and vehicle requests, document requests, work programs, and variations of work all hang off the project.",
  "contract-manager":
    "Contract Manager is the contractor’s view of work under a project manager. It holds the contractor directory, the invoices they submit, and the ledger of what is owed and paid.",
  fleet:
    "Fleet is the vehicle register. Vehicles and drivers are the master records. Fuel requests and fuel logs, trip requests, and maintenance requests are the day-to-day forms. The map, service reminders, and fleet cost report read from those records and can post costs to the ledger.",
  security:
    "Security covers who is allowed on site. A gate pass authorises movement of people or goods. A visitor pass covers a guest. A security incident records something that went wrong and needs a trail.",
  crm:
    "CRM is the sales pipeline before and beside the invoice. Leads and opportunities track prospects. Contacts are the people. Follow-ups are the next actions. Complaints record a customer problem. Records can link to Sales customers.",
  logistics:
    "Logistics moves goods after they leave the warehouse plan. Shipments and the dispatch board say what is going out. Routes and carriers say how. Proof of delivery confirms it arrived. Vehicles and drivers can link to Fleet.",
  distribution:
    "Distribution is warehouse-to-customer fulfillment. An order is allocated, picked, packed, and put on a delivery run. Returns bring goods back and record their condition.",
  rnd:
    "R&D is product development before full production. Experiments test a change. Formulations are recipes. Sensory panels score taste. Spec sheets lock the standard. Pilot batches try the recipe at small scale. Cost models price it. AI insights summarise results.",
  lab:
    "Lab is the laboratory record. Simulations, requests, samples, and trials say what is being tested. Methods and calibrations say how instruments are used. Results and stability studies store what was measured.",
  qa:
    "Quality Assurance decides whether product can move. Incoming inspections check what arrived. In-process checks watch production. Release decisions and the hold-and-release log say if a batch may ship. Non-conformances and CAPA actions record defects and the fix.",
  production:
    "Maintenance is the machinery workshop. Machines are the register. Work orders raise a job. Preventive schedules say when service is next due. Spare parts are what the job needs. Downtime records a stop, and job cards record the work that was done.",
  benchmark:
    "Work Systems (benchmark) measures how work is done. Define a work system and its KPIs, then run studies of cycle time and productivity. Gap analyses and improvement actions record what is off target and what will change.",
  pos:
    "POS is the point-of-sale till. Locations, products, and services are what you sell. Stock in feeds the till. Registers, cash sessions, tables, and open tickets are the live sale. POS sales, returns, and daily closings close the day and reconcile cash.",
  payroll:
    "HR & Payroll holds people and pay. Employees, departments, sites, blocks, positions, and onboarding are the staff file. Attendance, leave, and holidays feed the pay run. Create Payroll, payroll runs, payslip items, and payslips calculate pay. Statutory remittances record NSSF, PAYE, and similar payments.",
  investments:
    "Investments records marketable securities the business holds — shares, bonds, and funds — with quantities and book values.",
  assets:
    "Fixed Assets is the register of capitalized things the business owns. Tangible assets depreciate. Intangible assets amortize. Each entry posts that periodic cost. Leases record leased assets under the same page.",
  capital:
    "Capital Accounts records owners, partners, and directors. Subaccounts split contributions and drawings. Share-based payments record equity given as pay.",
  accounts:
    "Accounts is the general ledger setup and the journals that post into it. The chart of accounts, control accounts, and special accounts define where amounts land. Journal entries and recurring journals move amounts. Matching entries, provisions, ledgers, and the trial balance check that the books balance.",
  folders:
    "Folders are filing cabinets for documents. Create and organise them here, separate from the History trail and the Deleted Records bin.",
  documents:
    "Documents stores files and the audit trail. Attachments are uploaded files. History lists creates, updates, and deletes and who did them. Deleted Records is the bin for records that were removed.",
  reports:
    "Reports are the financial statements and control listings. Balance sheet, profit and loss, cash flow, trial balance, and equity statements read the ledger. Aged receivables and payables, customer and supplier statements, tax, and inventory value summarise subledgers. Most of these are generated from posted records. Where a form exists, it only stores the report name and the period you want.",
  tracking:
    "Tracking shows live vehicle positions and playback of where a vehicle has been. Positions come from the vehicle records and the telemetry track. This page is a map, not a form you fill in.",
  cms:
    "CMS is website and campaign content: pages, posts, media, categories, menus, banners, and authors. Each form is one piece of content you publish or keep as a draft.",
  "farmer-traceability":
    "Farmer Traceability follows product from farm to lot. Farmers, farms, plots, and crops are the source. Harvest lots, collections, certifications, and trace codes record what was picked, gathered, certified, and how it can be traced.",
};

const APP_PAGES: PageGuide[] = [
  {
    id: "dashboard",
    label: "Overview",
    href: "/",
    meaning:
      "Overview is the home page after sign-in. It shows the business summary for the reporting period you set, including balances, so you can see the year at a glance and open a module from here.",
    forms: [],
  },
  {
    id: "guides",
    label: "Guides",
    href: "/guides",
    meaning:
      "Guides is this help library. Feature articles explain how to do a task. Pages & forms, on this same page, explains every sidebar page and every input on its forms, including which data is required.",
    forms: [],
  },
  {
    id: "qna",
    label: "Q&A",
    href: "/qna",
    meaning:
      "Q&A holds short answers for product work: lab trials, coffee production, quality release, packaging, traceability, and costing. It is a reading page, not a data-entry form.",
    forms: [],
  },
  {
    id: "release-notes",
    label: "Release notes",
    href: "/release-notes",
    meaning:
      "Release notes list what shipped in each version of this app, newest first. Use it to see what changed. There is no record form to fill in.",
    forms: [],
  },
  {
    id: "templates",
    label: "Templates",
    href: "/templates",
    meaning:
      "Templates chooses the paper layout for source documents (invoices, receipts, and similar) and the statement layout used when you print or download Trial Balance, profit and loss, Balance Sheet, and ledgers.",
    forms: [],
  },
  {
    id: "comms",
    label: "Comms",
    href: "/comms",
    meaning:
      "Comms is messages inside the workspace: calendar, inbox, email, and SMS. It is for sending and reading messages, not for posting accounting entries.",
    forms: [],
  },
  {
    id: "accounting-documents",
    label: "Accounting documents",
    href: "/accounting-documents",
    meaning:
      "Accounting documents is the printable pack of source documents and control reports — sales, purchases, cash, payroll, inventory, assets, journals, and tax. Open a row to preview. The figures come from records you already saved on the other pages.",
    forms: [],
  },
  {
    id: "payment-requests",
    label: "Approval desks",
    href: "/payment-requests",
    meaning:
      "Approval desks are the queues where approvers review requests that were submitted on the request forms (material, payment, oral, general, and others). Approvers approve, send back for amendment, or reject. Requestors open the same page to see items returned to them. The data is entered on the original request form, not on the desk.",
    forms: [],
  },
  {
    id: "profile",
    label: "Profile",
    href: "/profile",
    meaning:
      "Profile is your own account. Every signed-in user can open it to see their name and change their password. It is not used to edit other people.",
    forms: [],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    meaning:
      "Settings is the workspace setup for administrators: business name and address, base and foreign currency, date and number formats, tax, enabled modules, and reporting preferences. These choices apply to the whole business.",
    forms: [],
  },
  {
    id: "users",
    label: "Users",
    href: "/users",
    meaning:
      "Users is where administrators add people, assign roles, and set which pages each role can view, create, edit, or delete. A role’s page permissions decide who can open the forms described in this guide.",
    forms: [],
  },
  {
    id: "request-emails",
    label: "Request email contacts",
    href: "/request-emails",
    meaning:
      "Request email contacts lists who is emailed when a requisition moves: submit, each approval, reject, amend, and paid. Alerts go to these contacts and to active users whose role sits on that step. CEO, General Manager, and the requestor are always included.",
    forms: [],
  },
  {
    id: "activity-logs",
    label: "Activity logs",
    href: "/activity-logs",
    meaning:
      "Activity logs show how long each person stayed signed in and what they did. Administrators use it as an audit of usage. There is no form to create a log; the system writes the rows.",
    forms: [],
  },
  {
    id: "crash-analytics",
    label: "Crash analytics",
    href: "/crash-analytics",
    meaning:
      "Crash analytics groups application errors by issue, user, and IP address for a recent time window. It is a support view. Users do not type crash records.",
    forms: [],
  },
  {
    id: "system-health",
    label: "System health",
    href: "/system-health",
    meaning:
      "System health shows whether the API, database, and related services are up. It is an administrator status page, not a data-entry form.",
    forms: [],
  },
];


/**
 * Subtitle under the page title. Keyed by module slug and the tab label so
 * two modules can share a name (Customers, Quality Checks) without sharing a sentence.
 */
const RECORD_PAGE_DESCRIPTION: Record<string, string> = {
  "banking|Bank & Cash Accounts": "Each bank or cash account, the chart-of-accounts line it posts to, and its running balance.",
  "banking|Inter Account Transfers": "Money moved from one bank or cash account to another.",
  "banking|Bank Statements": "Statement lines imported or entered so they can be matched to the books.",
  "banking|Reconciliations": "Match the statement to the book balance and clear what agrees.",

  "receipts-payments|Receipts": "Money received into a bank or cash account.",
  "receipts-payments|Payments": "Money paid out of a bank or cash account.",
  "receipts-payments|Receipt Rules": "Rules that categorise repeating receipts onto the right account.",
  "receipts-payments|Payment Rules": "Rules that categorise repeating payments onto the right account.",

  "expense-claims|Expense Claim Payers": "People or accounts that settle staff expense claims.",
  "expense-claims|Expense Claims": "Amounts staff paid themselves that the business still needs to record.",

  "general-requests|General Requests": "A requisition that is not tied to a project, from request through Finance.",
  "oral-payment-requests|Oral Payment Requests": "A payment agreed verbally, written down and sent through approval.",

  "sales|Customers": "The customer directory and the details used on quotes, orders, and invoices.",
  "sales|Customer Ledgers": "What each customer has been invoiced, has paid, and still owes.",
  "sales|Sales Quotes": "Prices offered to a customer before they place an order.",
  "sales|Sales Orders": "Customer orders accepted and waiting to be invoiced or delivered.",
  "sales|Sales Invoices": "Invoices raised to customers, with what is paid and what is still due.",
  "sales|Credit Notes": "A reduction of a customer invoice — a return, a discount, or a correction.",
  "sales|Late Payment Fees": "Fees charged when a customer invoice is paid late.",
  "sales|Delivery Notes": "What was delivered to a customer, against an order or invoice.",
  "sales|Billable Time": "Hours worked for a customer that can be charged on an invoice.",
  "sales|Billable Expenses": "Costs paid for a customer that can be recharged.",
  "sales|Withholding Tax Receipts": "Withholding tax deducted by a customer and recorded against their invoice.",
  "sales|Customer Portals": "What a customer can see and do when they sign in to their portal.",
  "sales|Recurring Sales Invoices": "Invoices that repeat on a schedule for the same customer.",
  "sales|Revenue Contracts": "A contract that spreads revenue across more than one invoice or period.",

  "purchases|Suppliers": "The supplier directory and the details used on orders and purchase invoices.",
  "purchases|Supplier Ledgers": "What each supplier has billed, what has been paid, and what is still owed.",
  "purchases|Purchase Quotes": "Prices received from a supplier before a purchase order.",
  "purchases|Purchase Orders": "Orders sent to a supplier for goods or services.",
  "purchases|Purchase Invoices": "Supplier bills, with what is paid and what is still due.",
  "purchases|Debit Notes": "A reduction of a supplier bill — a return, a short delivery, or a correction.",
  "purchases|Goods Receipts": "What actually arrived against a purchase order.",
  "purchases|Recurring Purchase Invoices": "Supplier bills that repeat on a schedule.",
  "purchases|Withholding Tax": "Withholding tax deducted from a supplier and recorded against their bill.",

  "inventory|Inventory Items": "Stocked products: quantity on hand, location, and value.",
  "inventory|Non-inventory Items": "Items you buy or sell that are not held as stock.",
  "inventory|Inventory Kits": "A sellable set made from several inventory items.",
  "inventory|Stock In": "Goods received into a warehouse, with quantity and cost.",
  "inventory|Inventory Transfers": "Stock moved from one warehouse or location to another.",
  "inventory|Warehouses & Locations": "The places stock is stored.",
  "inventory|Inventory Write-offs": "Stock removed because it is damaged, lost, or expired.",
  "inventory|Inventory Sales": "Stock sold directly from inventory, with quantity and price.",
  "inventory|Green Bean Intakes": "Green coffee received, weighed, and booked into stock.",
  "inventory|Production Orders": "An instruction to turn green beans or materials into a finished product.",
  "inventory|Roast Batches": "A roast run: what went in, what came out, and the yield.",
  "inventory|Quality Checks": "A check on a batch or item before it moves on.",
  "inventory|Packaging Runs": "Finished product packed, labelled, and booked as packed stock.",
  "inventory|Stocktakes": "A count of what is actually on the shelf, compared with the books.",
  "inventory|Landed Costs": "Freight, duty, and other costs added onto the cost of stock.",

  "projects|New Project": "Open a project: contract value, manager, site, and dates.",
  "projects|Project Updates": "Progress notes posted against a project.",
  "projects|Gantt Chart": "The project schedule — phases and dates on a timeline.",
  "projects|Project Managers": "People assigned to run projects.",
  "projects|Material Requests": "Materials a project needs, sent for approval and purchase.",
  "projects|Payment Requests (IPC)": "A project payment certificate, from request through approval and payment.",
  "projects|Equipment & Vehicle Requests": "Equipment or a vehicle a project needs for a period.",
  "projects|Document Requests": "A project document that still needs to be supplied or approved.",
  "projects|Work Programs": "The planned work for a project over a period.",
  "projects|Variations of Work": "A change to the agreed project scope, time, or price.",

  "contract-manager|Contractors": "Contractors working under a project manager.",
  "contract-manager|Contractor Invoices": "Invoices a contractor has submitted against a contract.",
  "contract-manager|Contractor Ledgers": "What is owed to each contractor and what has been paid.",

  "fleet|Vehicles": "The vehicle register: plate, assignment, and status.",
  "fleet|Drivers": "Drivers who can be assigned to vehicles and trips.",
  "fleet|Fuel Requests": "A request to fuel a vehicle, before the fuel is issued.",
  "fleet|Fuel Logs": "Fuel that was issued: vehicle, litres, and cost.",
  "fleet|Trip Requests": "A trip that needs a vehicle and a driver.",
  "fleet|Maintenance Requests": "Work a vehicle needs at the workshop.",
  "fleet|Service Reminders": "Upcoming services based on date or mileage.",
  "fleet|Fleet Cost Report": "Fuel, trips, and maintenance cost for the fleet.",

  "crm|Customers": "Customers this pipeline sells to, linked to the sales customer when one exists.",
  "crm|Leads": "People or companies that might buy, before they are a deal.",
  "crm|Opportunities": "Open deals: stage, value, and the customer they belong to.",
  "crm|Contacts": "People you talk to at a customer or lead.",
  "crm|Follow-ups": "The next call, visit, or email on a lead or deal.",
  "crm|Complaints": "A customer problem, who owns it, and how it was closed.",
  "crm|Quotes": "A price offered from a deal, before it becomes a sales invoice.",
  "crm|Campaigns": "A marketing push aimed at a list of contacts or leads.",
  "crm|Segments": "A saved group of customers or leads you can target again.",

  "logistics|Shipments": "Goods leaving for a customer: what, where, and the current status.",
  "logistics|Dispatch Board": "Shipments ready to leave, and the vehicle or carrier taking them.",
  "logistics|Routes": "The path a delivery follows, and the stops on it.",
  "logistics|Proof of Delivery": "Confirmation that the shipment arrived, and who received it.",
  "logistics|Carriers": "Outside transporters used when a fleet vehicle is not used.",

  "distribution|Distribution Orders": "A customer order allocated from the warehouse for delivery.",
  "distribution|Picking Lists": "What to pick from the shelf for a distribution order.",
  "distribution|Packing Lists": "What was packed into a delivery, after it was picked.",
  "distribution|Delivery Runs": "Orders grouped onto one vehicle or route for the day.",
  "distribution|Stock Allocations": "Stock reserved for an order so it is not sold twice.",
  "distribution|Distribution Returns": "Goods that came back from a customer, and their condition.",

  "rnd|Experiments": "A test of a product change: hypothesis, method, and result.",
  "rnd|Formulations": "A recipe under development — ingredients and quantities.",
  "rnd|Sensory Panels": "Taste or quality scores from a panel on a sample.",
  "rnd|Spec Sheets": "The locked standard a product must meet.",
  "rnd|Pilot Batches": "A small production run of a formulation before full scale.",
  "rnd|Cost Models": "What a formulation costs to make at the planned scale.",
  "rnd|AI Insights": "A summary of experiment results, generated from the records on this page.",

  "lab|Product Simulations": "A modelled trial before a physical sample is run.",
  "lab|Lab Requests": "Work asked of the lab: what to test and for whom.",
  "lab|Lab Samples": "A physical sample received by the lab, and where it came from.",
  "lab|Lab Trials": "A test run on a sample, with the method and the outcome.",
  "lab|Lab Methods": "How a test is performed, so results can be repeated.",
  "lab|Instrument Calibrations": "When an instrument was checked, and whether it passed.",
  "lab|Lab Results": "Measurements recorded against a sample or trial.",
  "lab|Stability Studies": "How a product holds up over time, checked at set intervals.",

  "qa|Quality Checks": "A quality check that decides whether a batch can move.",
  "qa|Incoming Inspections": "Inspection of goods as they arrive, before they are accepted.",
  "qa|In-process Checks": "Checks made while a batch is still in production.",
  "qa|Release Decisions": "Whether a batch is released, held, or rejected.",
  "qa|Non-conformances": "A defect or a result that does not meet the spec.",
  "qa|CAPA Actions": "The corrective or preventive action taken for a non-conformance.",
  "qa|Hold & Release Log": "Batches currently held, and when each was released.",

  "production|Machines": "The machine register: what it is, where it sits, and whether it is running.",
  "production|Work Orders": "A job raised against a machine: the fault, the parts, and who is doing it.",
  "production|Preventive Schedules": "Recurring service, and when it is next due.",
  "production|Spare Parts": "Parts kept for a machine, and how many are on hand.",
  "production|Downtime": "Time a machine was stopped, and why.",
  "production|Job Cards": "The work that was done: hours, parts, and the technician.",

  "benchmark|Work Systems": "A defined way of doing a job, and the standard it should hit.",
  "benchmark|Benchmark Studies": "A study that measures a work system against its standard.",
  "benchmark|KPI Definitions": "The measures used to judge a work system.",
  "benchmark|Cycle Time Studies": "How long one cycle of a job actually takes.",
  "benchmark|Productivity Scores": "Output per person or per hour for a study.",
  "benchmark|Gap Analyses": "Where performance is short of the standard, and by how much.",
  "benchmark|Improvement Actions": "What will change to close a gap.",

  "pos|POS Terminal": "The till: ring up a sale, take payment, and print or send the receipt.",
  "pos|POS Locations": "Shops or stalls where a till operates.",
  "pos|POS Products": "Products sold at the till, with price and stock.",
  "pos|POS Services": "Services sold at the till, with price.",
  "pos|POS Stock In": "Stock received into a till location.",
  "pos|Registers": "The cash registers at a location.",
  "pos|Cash Sessions": "A shift on a register: opening float, sales, and closing cash.",
  "pos|Dining Tables": "Tables that can hold an open ticket.",
  "pos|Open Tickets": "A sale still in progress, not yet paid.",
  "pos|POS Sales": "Completed till sales.",
  "pos|POS Returns": "Till sales that were refunded or reversed.",
  "pos|Daily Closings": "The end-of-day close: sales, cash counted, and the difference.",

  "payroll|Employees": "Staff records used for attendance and pay.",
  "payroll|Departments": "Departments employees belong to.",
  "payroll|Sites": "Sites where people work.",
  "payroll|Blocks": "Blocks or sections inside a site.",
  "payroll|Attendance": "Who was present, late, or absent.",
  "payroll|Leave Requests": "Leave asked for, and whether it was approved.",
  "payroll|Holidays": "Public and company holidays that affect attendance and pay.",
  "payroll|Job Positions": "Roles employees are hired into.",
  "payroll|Onboarding": "Steps still open for a new employee.",
  "payroll|Create Payroll": "Build a pay run from attendance, leave, and employee pay.",
  "payroll|Payroll Runs": "A pay period that has been calculated or paid.",
  "payroll|Payslip Items": "The earning and deduction lines that make up a payslip.",
  "payroll|Payslips": "The payslip issued to an employee for a run.",
  "payroll|Recurring Payslips": "Pay lines that repeat every run for an employee.",
  "payroll|Statutory Remittances": "NSSF, PAYE, and other statutory amounts paid to the authority.",

  "investments|Investments": "Shares, bonds, and funds the business holds, with quantity and book value.",

  "assets|Fixed Assets": "Capitalised assets: cost, location, and book value.",
  "assets|Depreciation Entries": "The periodic depreciation posted for a tangible asset.",
  "assets|Intangible Assets": "Assets without physical form, such as software or a licence.",
  "assets|Amortization Entries": "The periodic amortisation posted for an intangible asset.",
  "assets|Leases": "Leased assets and the payments due on them.",

  "capital|Capital Accounts": "Owners, partners, and directors, and their capital position.",
  "capital|Capital Subaccounts": "Contributions and drawings split out under a capital account.",
  "capital|Share-based Payments": "Equity given to someone as pay.",

  "accounts|Chart of Accounts": "The accounts amounts post to, with type, group, and balance.",
  "accounts|Control Accounts": "Accounts that must agree to a subledger, such as receivables or payables.",
  "accounts|Special Accounts": "Accounts reserved for a specific posting, such as suspense or tax.",
  "accounts|Journal Entries": "A manual journal: debits, credits, and the accounts they hit.",
  "accounts|Recurring Journal Entries": "A journal that repeats on a schedule.",
  "accounts|Matching Entries": "Entries that match an accrual or prepayment to the period it belongs to.",
  "accounts|Provisions": "An amount set aside for a cost that is likely but not yet invoiced.",
  "accounts|Ledgers": "The posted lines on one account.",
  "accounts|Trial Balance": "Every account with its debit and credit, and whether the books balance.",

  "documents|Folders": "Folders documents are filed in.",
  "documents|Attachments": "Files uploaded and linked to a record.",
  "documents|History": "Creates, updates, and deletes, and who made them.",
  "documents|Deleted Records": "Records that were removed and can still be reviewed.",

  "reports|Balance Sheet": "Assets, liabilities, and equity at a date.",
  "reports|Profit & Loss": "Income and expenses for a period.",
  "reports|Accounting Operations": "Operational totals behind the statements for the period.",
  "reports|Management Analysis": "A management view of results, separate from the statutory statements.",
  "reports|Profit & Loss by Class": "Profit and loss split by class or division.",
  "reports|Division Exception Report": "Postings that landed in the wrong division, or in none.",
  "reports|Cash Flow": "Cash in and cash out for a period, by activity.",
  "reports|Cash Flow Indirect": "Cash flow starting from profit and adjusting for non-cash items.",
  "reports|Trial Balance": "The trial balance report for a date.",
  "reports|Ledgers": "Account ledgers printed for a period.",
  "reports|Statement of Changes in Equity": "How equity moved during the period.",
  "reports|Other Comprehensive Income": "Income and expense that sits outside profit.",
  "reports|Budget vs Actual": "Budget compared with what was actually posted.",
  "reports|Forecast P&L": "A projected profit and loss from the forecast figures.",
  "reports|Notes to Financial Statements": "Narrative notes that accompany the statements.",
  "reports|Control Account Reconciliation": "Whether each control account agrees to its subledger.",
  "reports|Bank Reconciliation": "Whether each bank account agrees to its statement.",
  "reports|Integrity Tests": "Checks that the books still balance and controls still tie.",
  "reports|Field Audit Log": "Changes to fields on records, and who made them.",
  "reports|Aged Receivables": "Customer balances split by how long they have been outstanding.",
  "reports|Aged Payables": "Supplier balances split by how long they have been unpaid.",
  "reports|Customer Statements": "A statement of one customer's invoices, receipts, and balance.",
  "reports|Supplier Statements": "A statement of one supplier's bills, payments, and balance.",
  "reports|Tax Summary": "Output tax, input tax, and the net amount for the period.",
  "reports|Inventory Value Summary": "Stock quantity and value by item or location.",

  "cms|Authors": "People who can be named as the author of a page or post.",
  "cms|Banners": "Promotional banners shown on the site, with where they appear.",
  "cms|Categories": "Groups that posts and pages are filed under.",
  "cms|Media": "Images and files uploaded for use on pages and posts.",
  "cms|Menus": "The navigation menus on the site, and the links in each.",
  "cms|Pages": "A website page: title, body, and whether it is published.",
  "cms|Posts": "A news or blog post, with its category and publish state.",

  "contract-manager|Action Items": "A task still open on a contract, and who owns it.",
  "contract-manager|Approval Rules": "Who must approve a contract step, and in what order.",
  "contract-manager|Challenges": "A dispute or problem raised against a contract.",
  "contract-manager|Contract Budgets": "The budget set for a contract, and what has been used.",
  "contract-manager|Contract Clauses": "The clauses that make up a contract.",
  "contract-manager|Contract Milestones": "Dated milestones a contract must hit.",
  "contract-manager|Contract Obligations": "What each party still has to do under a contract.",
  "contract-manager|Contract Payments": "Payments due or made against a contract.",
  "contract-manager|Contract Requisitions": "A request raised under a contract for work or materials.",
  "contract-manager|Contract Templates": "A starting contract that new contracts are copied from.",
  "contract-manager|Contract Variations": "A change to a contract's scope, time, or price.",
  "contract-manager|Contracts": "The contract itself: parties, value, and status.",
  "contract-manager|Progress Reports": "Progress reported against a contract for a period.",

  "distribution|Beats": "The regular route a field rep covers.",
  "distribution|Collections": "Cash or stock collected from an outlet.",
  "distribution|Damage Claims": "A claim for goods damaged on the way to an outlet.",
  "distribution|Distribution Reports": "Sales, visits, and returns summarised for distribution.",
  "distribution|Field Reps": "Representatives who visit outlets and take orders.",
  "distribution|Outlet Returns": "Goods an outlet sent back.",
  "distribution|Outlet Visits": "A visit to an outlet: what was checked and what was ordered.",
  "distribution|Rep Targets": "The sales or visit target set for a field rep.",
  "distribution|Retailers": "Shops and outlets that buy through distribution.",
  "distribution|Schemes": "A promotion or discount offered to outlets.",
  "distribution|Secondary Invoices": "An invoice raised on a secondary sale to an outlet.",
  "distribution|Van Loads": "Stock loaded onto a van for a day's sales.",
  "distribution|Van Reconciliations": "Stock and cash on the van at the end of the day, against what left.",

  "farmer-traceability|Batches": "A batch of produce grouped for sale or export.",
  "farmer-traceability|Buyers": "Buyers who purchase lots from farmers or cooperatives.",
  "farmer-traceability|Certifications": "A certification held by a farmer, farm, or lot.",
  "farmer-traceability|Chain of Custody": "Who held a lot, from farm to buyer.",
  "farmer-traceability|Collections": "Produce collected from farmers into a lot.",
  "farmer-traceability|Cooperative Members": "Farmers who belong to a cooperative.",
  "farmer-traceability|Cooperatives": "A cooperative that groups farmers and their produce.",
  "farmer-traceability|Crops": "Crops grown, and which farm or plot they come from.",
  "farmer-traceability|Custody Events": "One handover of a lot from one holder to the next.",
  "farmer-traceability|Disputes": "A disagreement about a lot, a payment, or a grade.",
  "farmer-traceability|Export Lots": "A lot prepared for export, with its documents.",
  "farmer-traceability|Farmer Payments": "Money paid to a farmer for produce delivered.",
  "farmer-traceability|Farmers": "The farmer register: who grows, and how to reach them.",
  "farmer-traceability|Farmgate Prices": "The price offered at the farm for a crop.",
  "farmer-traceability|Farms": "Farms linked to a farmer.",
  "farmer-traceability|Field Agents": "Agents who visit farms and record collections.",
  "farmer-traceability|Field Inspections": "An inspection of a farm or plot.",
  "farmer-traceability|Harvest Lots": "A lot recorded at harvest, with quantity and grade.",
  "farmer-traceability|Harvest Requests": "A request to harvest a plot.",
  "farmer-traceability|Inventory SKUs": "The product codes traceable lots are sold as.",
  "farmer-traceability|Lab Results": "A lab result recorded against a lot.",
  "farmer-traceability|Marketplace Listings": "A lot listed for buyers.",
  "farmer-traceability|Notices": "A notice sent to farmers or cooperatives.",
  "farmer-traceability|Plots": "Plots on a farm, and what is planted there.",
  "farmer-traceability|Purchase Orders": "An order placed with a farmer or cooperative for a lot.",
  "farmer-traceability|QR Stories": "The story a buyer sees when they scan a lot's code.",
  "farmer-traceability|Rewards": "A reward earned by a farmer.",
  "farmer-traceability|SMS Blasts": "A text message sent to a group of farmers.",
  "farmer-traceability|Sacks": "Individual sacks in a lot, and their weight.",
  "farmer-traceability|Sales Orders": "An order from a buyer for a traceable lot.",
  "farmer-traceability|Stock Sessions": "A session where stock was counted or received.",
  "farmer-traceability|Suppliers": "Suppliers of inputs to farmers.",
  "farmer-traceability|Support Tickets": "A farmer's support request, and how it was closed.",
  "farmer-traceability|Surveys": "A survey answered by farmers or agents.",
  "farmer-traceability|Trace Codes": "The code that follows a lot from farm to buyer.",

  "fleet|Cargo Documents": "Documents that travel with a cargo movement.",
  "fleet|Cargo Movements": "Cargo moved by a vehicle, from where to where.",
  "fleet|Compliance Items": "Licences, insurance, and inspections a vehicle must keep current.",
  "fleet|Deployment Days": "Days a vehicle was deployed, and to which job.",
  "fleet|Diagnostics": "Faults reported by a vehicle.",
  "fleet|Driver Safety Scores": "A driver's safety score from events and inspections.",
  "fleet|Emissions": "Emissions recorded for a vehicle or a period.",
  "fleet|Fleet Notifications": "Alerts sent about vehicles, drivers, or compliance.",
  "fleet|Fleet Tasks": "A task assigned on the fleet, and who it is with.",
  "fleet|Fuel Card Reconciliation": "Fuel-card charges matched to fuel logs.",
  "fleet|HOS Fatigue": "Hours of service and fatigue flags for a driver.",
  "fleet|Inspection Templates": "The checklist used when a vehicle is inspected.",
  "fleet|IoT Devices": "Trackers and sensors fitted to vehicles.",
  "fleet|Journey Plans": "A planned journey: route, driver, and vehicle.",
  "fleet|Map Analytics": "Where vehicles have been, summarised from the map.",
  "fleet|PM Schedules": "Preventive maintenance due by date or mileage.",
  "fleet|Parts": "Parts used or held for fleet maintenance.",
  "fleet|Permit Authorisations": "A permit issued for a vehicle, driver, or load.",
  "fleet|Permit Classes": "The kinds of permit the fleet issues.",
  "fleet|Route And ETA": "A route and the expected arrival time.",
  "fleet|Safety Events": "An incident or near miss involving a vehicle or driver.",
  "fleet|Service Requests": "A request to service a vehicle.",
  "fleet|Tyres": "Tyres fitted to a vehicle, and their condition.",
  "fleet|Vehicle Categories": "Categories vehicles are grouped into.",
  "fleet|Vehicle Inspections": "An inspection carried out on a vehicle.",
  "fleet|Weighbridge": "A weighbridge reading for a vehicle and its load.",

  "folders|Folders": "Folders documents are filed in.",

  "inventory|GL Reconciliation": "Whether inventory value agrees to the general ledger.",
  "inventory|Intake Quality Checks": "A quality check on stock as it is received.",
  "inventory|Inventory Desk": "The queue of inventory work waiting on someone.",
  "inventory|Inventory Value Summary": "Stock quantity and value by item or location.",
  "inventory|Item Groups": "Groups that inventory items belong to.",
  "inventory|Lot Expiry": "Lots that are near or past their expiry date.",
  "inventory|Price Lists": "Selling or cost prices for inventory items.",
  "inventory|Putaway Rules": "Where incoming stock should be put away.",
  "inventory|Reorder Report": "Items at or below the level where they should be reordered.",
  "inventory|Replenishment Requests": "A request to restock an item or a location.",
  "inventory|Stock Ageing": "How long stock has been sitting, by item or lot.",
  "inventory|Stock Ledger": "Every movement in and out of an item.",
  "inventory|Stock Out": "Stock issued out of a warehouse.",
  "inventory|Stock Routes": "The path stock follows between locations.",
  "inventory|Stocktake Variance": "The difference between a count and the book quantity.",
  "inventory|Traceability": "Which lot an item came from, and where it went.",
  "inventory|Write-off Analysis": "Write-offs summarised by reason, item, or period.",

  "logistics|Corridor cargo": "Cargo moving on a corridor, and its current leg.",

  "payroll|Attendance Exceptions": "Attendance that needs a review: missing punch, late, or absent.",
  "payroll|Attendance Summary": "Attendance totals for a person or a period.",
  "payroll|Biometric Enrolments": "Staff enrolled on a biometric terminal.",
  "payroll|Certification Expiry": "Staff certificates that are near or past expiry.",
  "payroll|Contracts": "Employment contracts, and when they end.",
  "payroll|Disciplinary Cases": "A disciplinary case, and where it stands.",
  "payroll|Employee Profiles": "The fuller staff file behind the employee record.",
  "payroll|Flagged Terminals": "Attendance terminals that failed or look wrong.",
  "payroll|Headcount & Turnover": "How many people joined and left.",
  "payroll|Job Applications": "Applications received for an open position.",
  "payroll|Leave Balances": "Leave remaining for each employee.",
  "payroll|Leave Calendar": "Who is on leave, by day.",
  "payroll|Leave Delegations": "Who covers someone's work while they are on leave.",
  "payroll|Leave Policies": "How much leave a group of employees gets.",
  "payroll|Leave Types": "The kinds of leave that can be requested.",
  "payroll|Offboarding": "Steps still open when someone leaves.",
  "payroll|Offer Letters": "An offer made to a candidate.",
  "payroll|Org Chart": "Who reports to whom.",
  "payroll|Overtime": "Overtime hours recorded for pay.",
  "payroll|Payroll Register": "The pay register for a run: everyone, gross, deductions, net.",
  "payroll|Performance Cycles": "A review period performance is measured in.",
  "payroll|Performance Goals": "A goal set for someone in a cycle.",
  "payroll|Performance KPIs": "The measures used in a performance review.",
  "payroll|Performance Reviews": "A review of someone's performance in a cycle.",
  "payroll|Punch log": "Clock-in and clock-out punches from the terminals.",
  "payroll|Route Geofences": "The area a site or route uses for attendance.",
  "payroll|Setup Items": "Reference lists HR uses, such as grades or reasons.",
  "payroll|Shifts": "Shift patterns people are assigned to.",
  "payroll|Training & Development": "Training planned for staff.",
  "payroll|Training Courses": "Courses staff can be enrolled on.",
  "payroll|Training Enrolments": "Who is enrolled on a course, and whether they finished.",

  "purchases|Budgets": "A purchase budget, and how much of it is committed.",
  "purchases|Framework Drawdown": "A call-off against a framework agreement.",
  "purchases|Landed Costs": "Freight, duty, and other costs added onto a purchase.",
  "purchases|Procurement Reports": "Purchases summarised by supplier, status, or period.",
  "purchases|Purchase Requisitions": "An internal request to buy, before a purchase order.",
  "purchases|Purchase Returns": "Goods sent back to a supplier.",
  "purchases|Supplier Contracts": "A contract with a supplier: value, term, and what it covers.",
  "purchases|Supplier Payments": "Payments made to a supplier against their bills.",
  "purchases|Supplier Quotations": "A quotation received from a supplier.",
  "purchases|Supplier Scorecards": "How a supplier is scoring on delivery, quality, and price.",

  "security|Blocked List": "People or vehicles that must not be let in.",
  "security|Gate Check-In/Out": "Who or what passed the gate, and when.",
  "security|Gate Passes": "A pass that authorises movement of people or goods.",
  "security|Material Gate Passes": "A pass for materials leaving or entering the gate.",
  "security|Open Exceptions": "Gate events that still need a decision.",
  "security|Security Incidents": "Something that went wrong on site, and the trail of it.",
  "security|Security Reports": "Incidents, passes, and gate traffic summarised for a period.",
  "security|Standing Passes": "A pass that stays valid until it is revoked or expires.",
  "security|Visitor Passes": "A pass issued to a visitor for a visit.",
  "security|Visitor Pre-Registrations": "A visitor expected before they arrive at the gate.",
};

export function descriptionForRecordPage(slug: string, label: string): string | undefined {
  const specific = RECORD_PAGE_DESCRIPTION[`${slug}|${label}`];
  if (specific) return specific;
  return RECORD_PAGE_DESCRIPTION[label];
}

function fieldKind(field: EntityField): string {
  switch (field.type) {
    case "number":
      return "Number";
    case "date":
      return "Date";
    case "email":
      return "Email";
    case "textarea":
      return "Long text";
    case "select":
      return "Choice";
    case "attachments":
      return "Files";
    default:
      return "Text";
  }
}

function fieldHelp(field: EntityField): string {
  if (field.readOnly) {
    const note = field.placeholder ? ` ${field.placeholder}` : "";
    return `Filled by the system after an approver acts. Leave it blank when you create the record.${note}`;
  }

  const parts: string[] = [];
  if (field.placeholder) parts.push(field.placeholder);

  switch (field.type) {
    case "date":
      parts.push("Enter a calendar date (day, month, and year).");
      break;
    case "number":
      parts.push("Enter a number. Money amounts can include commas, for example 1,250,000.");
      break;
    case "email":
      parts.push("Enter an email address, such as name@company.com.");
      break;
    case "textarea":
      parts.push("Write a longer note. Line breaks are kept.");
      break;
    case "attachments":
      parts.push("Upload one or more files (PDF, image, or spreadsheet) that support this record.");
      break;
    case "select":
      if (field.options?.length) {
        const shown = field.options.slice(0, 14);
        const extra =
          field.options.length > shown.length
            ? ` and ${field.options.length - shown.length} more`
            : "";
        parts.push(`Choose one: ${shown.join(", ")}${extra}.`);
      } else {
        parts.push("Choose one option from the list.");
      }
      break;
    default:
      if (!field.placeholder) parts.push(`Short text for ${field.label.toLowerCase()}.`);
      break;
  }

  if (field.required) {
    parts.push("This is required. The record cannot be saved until it is filled.");
  } else {
    parts.push("Optional. Leave it blank if it does not apply.");
  }

  return parts.join(" ");
}

function toFieldGuide(field: EntityField): FormFieldGuide {
  return {
    key: field.key,
    label: field.label,
    kind: fieldKind(field),
    required: Boolean(field.required) && !field.readOnly,
    readOnly: Boolean(field.readOnly),
    help: fieldHelp(field),
  };
}

function formMeaning(pageLabel: string, label: string, fields: FormFieldGuide[]): string {
  const required = fields.filter((field) => field.required);
  if (fields.length === 0) {
    return `${label} is listed on ${pageLabel} but has no data-entry fields. It is a view or a tool, not a form you fill in.`;
  }
  if (required.length === 0) {
    return `${label} is a form on ${pageLabel}. No field is marked required. Fill what applies, then save.`;
  }
  const names = required.map((field) => field.label).join(", ");
  return `${label} is a form on ${pageLabel}. Required data before you can save: ${names}. Every other field is optional.`;
}

export function buildPageFormGuide(): PageGuide[] {
  const modules: PageGuide[] = NAV_MODULES.map((nav) => {
    const config = moduleConfigs[nav.slug];
    const forms: FormGuide[] = entityDefinitions(nav.slug).map((definition) => {
      const fields = definition.fields.map(toFieldGuide);
      return {
        key: definition.key,
        label: definition.label,
        meaning: formMeaning(nav.label, definition.label, fields),
        requiredFields: fields.filter((field) => field.required),
        fields,
      };
    });
    return {
      id: nav.slug,
      label: nav.label,
      href: nav.href,
      meaning:
        PAGE_MEANING[nav.slug] ??
        config?.description ??
        `${nav.label} is a workspace page. Its forms are listed below.`,
      forms,
    };
  });

  return [...modules, ...APP_PAGES];
}

export function pageFormGuideStats(pages: PageGuide[]) {
  const forms = pages.reduce((count, page) => count + page.forms.length, 0);
  const required = pages.reduce(
    (count, page) =>
      count + page.forms.reduce((inner, form) => inner + form.requiredFields.length, 0),
    0,
  );
  return { pages: pages.length, forms, required };
}

/** One short line under a form input. Common keys are specific; everything else still gets a line. */
const FIELD_KEY_HINT: Record<string, string> = {
  name: "The name shown in lists and on documents.",
  code: "A short code used to find this record.",
  reference: "Your reference. Leave blank if the system should assign one.",
  title: "The role this person holds, for example Accountant.",
  jobTitle: "The role this person holds, for example Accountant.",
  email: "An email address, such as name@company.com.",
  phone: "A phone number, with the country code if it is not local.",
  mobile: "A mobile number, with the country code if it is not local.",
  address: "Street, town, or site.",
  notes: "Anything else worth keeping with this record.",
  description: "A short note about this record.",
  status: "Where this record stands.",
  currency: "The currency amounts on this record are in.",
  amount: "The money amount.",
  date: "The date this record applies to.",
  owner: "The person responsible. Leave blank to assign it to yourself.",
  party: "The customer, supplier, or other person this record is about.",
  customer: "The customer this record belongs to.",
  supplier: "The supplier this record belongs to.",
  project: "The project this record belongs to.",
  quantity: "How many.",
  rate: "The rate, as a percent or a price per unit.",
};

export function fieldInputHint(field: {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
}): string {
  const written = field.placeholder?.trim();
  if (written) return written;
  if (field.readOnly) return "Filled in by the system.";
  const known = FIELD_KEY_HINT[field.key];
  if (known) return known;
  const name = field.label.replace(/\s*\*$/, "").trim();
  const lower = name.toLowerCase();
  switch (field.type) {
    case "date":
      return `The date for ${lower}.`;
    case "number":
      return `A number for ${lower}.`;
    case "email":
      return "An email address, such as name@company.com.";
    case "textarea":
      return `A longer note for ${lower}.`;
    case "select":
      return `Choose ${lower}.`;
    case "attachments":
      return "A file that supports this record.";
    default:
      return `${name} for this record.`;
  }
}
