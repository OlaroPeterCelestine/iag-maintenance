# IAG platform gap — Maintenance

Every maintenance tab is **iag-mes** (`/api/v1/mes` + service `/api/v1`)
except Spare Parts, which is the **warehouse** item master
(`/api/v1/warehouse` + service `/api/v1`). Both are snake_case and re-check
every call against their own permissions, whatever this app decides to show.
The adapters live in `src/lib/iag/records/mes-maintenance.ts` and
`maintenance-extras.ts`.

## Wired

| Tab | Catalog key | Upstream | C | R | U | D | Notes |
|---|---|---|:-:|:-:|:-:|:-:|---|
| Machines | `production:work-centers` | `/assets/:tag` | ✓ | ✓ | ✓ | — | Create resolves `section_id` from `GET /sections` by the section typed on the form, and refuses an unknown one with the list of real sections. Criticality (A–D) and section are set on registration only — `PATCH` has neither. `PATCH` replaces `attrs` whole, so the adapter reads the stored bag and merges before writing. Retire a machine with status **Retired**; there is no delete. **Retired needs iag-mes#4** (migration 012) — until it deploys MES refuses it with a 400. |
| Work Orders | `production:work-orders` | `/work-orders/:num` | ✓ | ✓ | ✓ | — | Blank number → MES assigns `WO-n`. Machine and type are fixed once raised (`WorkOrderPatch` has neither). **Completed** always goes through `POST /:num/complete`, which stamps `completed_at` and advances the PM schedule the order came from; a `PATCH` to `completed` does neither. |
| Job Cards | `production:batch-records` | `/work-orders/:num` (`attrs.job_card`) | ✓ | ✓ | ✓ | — | The work done against one work order. MES has no job-card table, so a card is written onto its work order — one card per order. `attrs` merges one key deep, so the adapter reads the stored card and lays the edit over it. |
| PM Templates | `production:pm-templates` | `/pm-templates/:id` | ✓ | ✓ | ✓ | — | Service, checklist (one step per line) and interval in days. The code is fixed; edits need **iag-mes#5**. |
| Preventive Schedules | `production:pm-schedules` | `/pm-schedules/:id` | ✓ | ✓ | ✓ | — | A template on one machine, unique per pair. Edit moves the next due date only (**iag-mes#5**); MES sets the status from it. MES's preventive sync marks it overdue and raises its work order when due. |
| Spare Parts | `production:spare-parts` | warehouse `/items/:id` (`material_class=spare_part`), `/items/:id/status`, `/spare-compat`, `/stock/summary` | ✓ | ✓ | ✓ | — | The warehouse item master — the register the Inventory app holds stock in. Machine types it fits are `wh_spare_compat` rows, kept exactly in step with the form. `PATCH /items` replaces `attrs` whole, so the adapter merges. Status moves through the status route. **Stock is read, never typed** — receive it in the Inventory app. Retire with Obsolete; there is no delete. Needs `platform.access_warehouse` and `warehouse.view_item` / `add_item` / `change_item` / `change_item_status`. |
| Downtime | `production:downtime-logs` | `/downtime-events` | ✓ | ✓ | — | — | `started_at` is sent as RFC3339 on Kampala time — a bare date is a 400. A stop that is already over is logged with its minutes, sent as `ended_at` — **needs iag-mes#3**; until that deploys MES ignores the key and the event stays open. Otherwise close it with **End downtime**. Minutes read back are worked out from start and end. |
| Reliability | `production:reliability` | `/reliability/summary?days=90` | — | ✓ | — | — | MTBF, MTTR, availability and failures per machine — arithmetic over downtime. |
| Alerts | `production:alerts` | `/alerts` | — | ✓ | — | — | Newest 50. Acknowledge / Resolve on the row menu (`mes.ack_alert`). |
| Recommendations | `production:recommendations` | `/ai/recommendations` | — | ✓ | — | — | Accept / Dismiss (`mes.change_ai`) records the decision; it raises nothing. |
| (picker) | `production:technicians` | `/technicians` | — | ✓ | — | — | **iag-mes#5.** Reads as empty until it deploys. |
| — | `documents:attachments` | finance `/v1/attachments` | — | ✓ | — | — | Read. Uploads go to `/api/attachments`, which is DMS. |

A dash is a verb **the service does not have**, not one this app declined to
wire. The collection read reports the verbs to the browser as `capabilities`,
so a screen draws only the controls its service can honour.

## Row actions

| Tab | Action | Upstream | Offered when |
|---|---|---|---|
| Work Orders | Start work | `POST /work-orders/:num/start` | Draft, Scheduled, Open |
| Work Orders | Complete work order | `POST /work-orders/:num/complete` | any live status |
| Downtime | End downtime | `POST /downtime-events/:id/end` | Open |
| Alerts | Acknowledge | `POST /alerts/:id/ack` | New |
| Alerts | Resolve | `POST /alerts/:id/resolve` | New, Ack, Investigating |
| Recommendations | Accept / Dismiss | `POST /ai/recommendations/:id/accept` · `/dismiss` | Open |

## Pickers

- **Machine** on every form saves the asset **tag**. It used to save the
  machine's name, which MES stores in `asset_tag` and joins on — a name there
  links to nothing.
- **Work order** on a job card, from the Work Orders list (open orders only).
- **PM template** on a schedule, from the PM Templates list.
- **Technician** for a work order's assignee, a job card's technician, a
  machine's responsible technician and downtime's reported-by — from MES
  technicians, and still accepting a typed name.

Fault on downtime is still free text — see below.

## Not wired, and why

- **Deleting PM templates and schedules** — MES has no DELETE.
- **Fault picker** — iag-production `/reason-codes?kind=downtime`, gated on
  `production.view_config`, which maintenance users may not hold.
- **Plants and sections** — `POST /plants`, `POST /plants/:code/sections`. A
  first machine cannot be registered until a section exists.
- **Maintenance calendar, telemetry, KPIs** — `/maintenance/calendar`,
  `/assets/:tag/telemetry`, `/kpis/*`. The calendar is the PM Schedules and Work
  Orders lists side by side; telemetry has no readings in production yet.

## Operations

- **The preventive sync.** It used to live only in `mes-jobs`, which the MES
  image builds but does not start, and production has no sign it ever ran (no
  KPI snapshot, alert or recommendation has been written). **iag-mes#5** runs
  it in the API server every `MES_PM_SYNC_INTERVAL` (default 1h) under an
  advisory lock, so a separate `mes-jobs` cannot double up. Until #5 deploys,
  schedules never raise work orders; `POST /admin/jobs/preventive-maintenance`
  runs it by hand.

## Env

See `.env.example`. **`NEXT_PUBLIC_FRONTEND_ONLY`** defaults to `false` — the
app expects a backend. Only an explicit `true` (at build time) runs it on
localStorage.

Then `IAG_GATEWAY_ORIGIN`, `IAG_ADAPTER_ENABLED` and `IAG_MES_PREFIX`.
