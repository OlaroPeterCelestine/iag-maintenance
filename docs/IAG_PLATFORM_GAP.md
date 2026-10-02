# IAG platform gap — Production

Two services own this tab. Both are snake_case, and both re-check every call
with their own permissions regardless of what this app decides to show.

- **iag-mes** — `/api/v1/mes` + service `/api/v1`
- **iag-production** — `/api/v1/production` + service `/api/v1`

## Wired

| Catalog key | Upstream | C | R | U | D | Notes |
|---|---|:-:|:-:|:-:|:-:|---|
| `production:production-orders` | iag-production `/production-orders`, create at `/production-orders/schedule` | ✓ | ✓ | — | — | The collection POST is a legacy event verb that persists nothing. No update verb upstream: `running` and `completed` are derived from the order's runs by `DeriveOrderStatus`, which is why a run sends `po_num`. |
| `production:roast-batches` | iag-production `/production-runs` | ✓ | ✓ | — | — | Stage moves through the `advance` and `complete` row actions, not a flat PATCH. `process` is fixed at `roast` — it is a CHECK-constrained stage kind, not a recipe name — and the recipe the operator names keeps its own place in `attrs`, as iag-inventory does for the same screen. Addressed by UUID: every verb parses `:id` with `uuid.Parse`. |
| `production:packaging-runs` | iag-production `/packaging-runs/:businessId` | ✓ | ✓ | ✓ | — | Edited while it runs — the pack count is not known when it is scheduled and the lot code is assigned at the line. `pack_size_kg` is **kilograms**. |
| `production:production-plans` | iag-production `/schedule-blocks` | ✓ | ✓ | — | — | GET and POST only. The service answers a window and defaults it to a fortnight, so the adapter sends an explicit `from`/`to`. |
| `production:bill-of-materials` | iag-production `/boms/:businessId` | ✓ | ✓ | ✓ | ✓ | Header keyed on the code plus real lines; the form's one `components` field is parsed into them. Same table as the Inventory app's kits. |
| `production:yield-reports` | iag-production `/production-runs` | — | ✓ | — | — | Arithmetic over a run — kilos in, kilos out. Correct the run, not the report. |
| `production:batch-records` | iag-mes `/work-orders/:num` | ✓ | ✓ | ✓ | — | CMMS work orders, not a second ledger — production orders live on iag-production. `asset_tag` is NOT NULL. Figures with no typed column ride in `attrs`. |
| `production:downtime-logs` | iag-mes `/downtime-events` | ✓ | ✓ | — | — | No item PATCH. Closing one is the `end` row action. |
| `production:work-centers` | iag-mes `/assets/:tag` | ✓ | ✓ | ✓ | — | Create resolves `section_id` from `GET /sections`. Status is `running\|idle\|down\|pm\|maint`; the adapter maps it by hand because neither case transform round-trips `maint` or `pm`. |
| `documents:attachments` | finance `/v1/attachments` | — | ✓ | — | — | Read. Uploads go to `/api/attachments`, which is DMS. |

A dash is a verb the **service does not have**, not one this app declined to
wire. The collection read reports all four to the browser as `capabilities`, so
a screen draws exactly the controls its own service can honour.

## Row actions

Verbs that are not a field on the record, declared by the adapter and rendered
on the row menu:

| Entity | Action | Upstream | Offered when |
|---|---|---|---|
| `roast-batches` | Start roast | `POST /production-runs/:id/advance` | status open / scheduled |
| `roast-batches` | Complete run | `POST /production-runs/:id/complete` | any live status |
| `downtime-logs` | End downtime | `POST /downtime-events/:id/end` | status open |

`advance` writes `to_stage` and `stage_idx` with no COALESCE guard, so the
action sends a real body — an empty one would blank the run's stage. `complete`
is safe empty: every optional column goes through `COALESCE(NULLIF(...))`.

`route-output` and `ccp-readings` are deliberately not here: both need an
argument the row menu has nowhere to collect.

## Not wired, and why

Roughly sixty endpoints on iag-production have no screen in this app. They fall
into three groups:

- **Masters** — `/products`, `/machines`, `/grades`, `/reason-codes`,
  `/process-routes`, `/operators`, `/shifts`, `/ccp-limits`. Worth wiring as
  form pickers before anything else: every reference on these forms is free
  text today, including `greenLot`, which the service hard-validates against
  supply chain, so a typo is a refused create.
- **Run capture** — `/production-runs/:id/outputs`, `/materials`, `/time-log`,
  `/measurements`. A run's actual figures. The batch-record form collects
  approximations of several of these into `attrs`; these are the typed
  versions.
- **Performance** — all of `/kpis/*`, `/measures`, `/reliability`. No screen.

Only `workCenter` has a picker, and it reads MES assets. iag-production keeps
its own `prod_machines`, fed by MES asset events, so the two agree as long as
the bus is running.

## Env

See `.env.example`. The switch that matters most is **`NEXT_PUBLIC_FRONTEND_ONLY`**:
it defaults to `true`, so a deployment that does not set it to `false`
explicitly runs the whole app on localStorage and never reaches any of the
above. It is inlined at build time — changing it needs a redeploy.

Then `IAG_GATEWAY_ORIGIN`, `IAG_ADAPTER_ENABLED`, `IAG_MES_PREFIX`,
`IAG_PRODUCTION_PREFIX`, `IAG_DMS_PREFIX`, and `GO_API_KEY` for the unmapped
passthrough.
