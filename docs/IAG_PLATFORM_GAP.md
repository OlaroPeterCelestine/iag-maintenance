# IAG platform gap — Maintenance

Every maintenance tab is **iag-mes** (`/api/v1/mes` + service `/api/v1`).
MES is snake_case and re-checks every call against its own permissions,
whatever this app decides to show. The adapters live in
`src/lib/iag/records/mes-maintenance.ts`.

## Wired

| Tab | Catalog key | Upstream | C | R | U | D | Notes |
|---|---|---|:-:|:-:|:-:|:-:|---|
| Machines | `production:work-centers` | `/assets/:tag` | ✓ | ✓ | ✓ | — | Create resolves `section_id` from `GET /sections` by the section typed on the form, and refuses an unknown one with the list of real sections. Criticality (A–D) and section are set on registration only — `PATCH` has neither. `PATCH` replaces `attrs` whole, so the adapter reads the stored bag and merges before writing. Retire a machine with status **Retired**; there is no delete. **Retired needs iag-mes#4** (migration 012) — until it deploys MES refuses it with a 400. |
| Work Orders | `production:work-orders` | `/work-orders/:num` | ✓ | ✓ | ✓ | — | Blank number → MES assigns `WO-n`. Machine and type are fixed once raised (`WorkOrderPatch` has neither). **Completed** always goes through `POST /:num/complete`, which stamps `completed_at` and advances the PM schedule the order came from; a `PATCH` to `completed` does neither. |
| Job Cards | `production:batch-records` | `/work-orders/:num` (`attrs.job_card`) | ✓ | ✓ | ✓ | — | The work done against one work order. MES has no job-card table, so a card is written onto its work order — one card per order. `attrs` merges one key deep, so the adapter reads the stored card and lays the edit over it. |
| PM Templates | `production:pm-templates` | `/pm-templates` | ✓ | ✓ | — | — | Service, checklist (one step per line) and interval in days. |
| Preventive Schedules | `production:pm-schedules` | `/pm-schedules` | ✓ | ✓ | — | — | A template on one machine, unique per pair. MES's hourly preventive job marks it overdue and raises its work order when due. |
| Downtime | `production:downtime-logs` | `/downtime-events` | ✓ | ✓ | — | — | `started_at` is sent as RFC3339 on Kampala time — a bare date is a 400. A stop that is already over is logged with its minutes, sent as `ended_at` — **needs iag-mes#3**; until that deploys MES ignores the key and the event stays open. Otherwise close it with **End downtime**. Minutes read back are worked out from start and end. |
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

## Pickers

- **Machine** on every form saves the asset **tag**. It used to save the
  machine's name, which MES stores in `asset_tag` and joins on — a name there
  links to nothing.
- **Work order** on a job card, from the Work Orders list (open orders only).
- **PM template** on a schedule, from the PM Templates list.

Technician, reported-by and fault are still free text — see below.

## Not wired, and why

- **Spare Parts** — no tab. No service owns a parts register, and the tab used
  to write iag-production BOMs (the table production recipes and the Inventory
  app's kits share). Needs an owner decision: iag-inventory items tagged as
  spares, or a new MES table.
- **Editing or deleting PM templates and schedules** — MES has `GET` and `POST`
  only.
- **Technician picker** — `ListTechnicians` exists in MES and `mes_technicians`
  is populated, but no route registers the handler.
- **Fault picker** — iag-production `/reason-codes?kind=downtime`, gated on
  `production.view_config`, which maintenance users may not hold.
- **Plants and sections** — `POST /plants`, `POST /plants/:code/sections`. A
  first machine cannot be registered until a section exists.
- **Read-only reporting** — `/reliability/summary` (MTBF, MTTR, availability,
  downtime Pareto), `/maintenance/calendar`, `/alerts` (ack, resolve),
  `/ai/recommendations` (accept, dismiss), `/assets/:tag/telemetry`, `/kpis/*`.

## Operations

- **The preventive job.** `mes-jobs` (built into the MES image) runs
  `preventive-maintenance-sync` hourly — but the image's entrypoint is the API
  server. Unless Railway runs `mes-jobs` as its own service, schedules never
  raise work orders. It can be triggered by hand with
  `POST /admin/jobs/preventive-maintenance` (`mes.admin.write`).

## Env

See `.env.example`. **`NEXT_PUBLIC_FRONTEND_ONLY`** defaults to `true`, so a
deployment that does not set it to `false` runs on localStorage and never
reaches MES. It is inlined at build time — changing it needs a redeploy.

Then `IAG_GATEWAY_ORIGIN`, `IAG_ADAPTER_ENABLED` and `IAG_MES_PREFIX`.
