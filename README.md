# IAG Maintenance

Machinery maintenance: the machine register, work orders, job cards, preventive schedules, PM templates, and downtime. Same shell as the other IAG web apps.

**Dev port:** `3140`

**Version:** `1.0.0` — [changelog](./CHANGELOG.md)

## Run

```bash
cd maintenance
npm install
npm run dev
```

Open `http://127.0.0.1:3140`. Sign in with a platform account. The sidebar opens on Maintenance.

## What this app is

A workshop desk for plant and machinery. Machines are the register. Work orders raise a job, and job cards record the work done against it. PM templates describe a service; preventive schedules put one on a machine, and MES raises a work order when it falls due. Downtime records a stop.

Every tab saves to iag-mes through the gateway — see [docs/IAG_PLATFORM_GAP.md](docs/IAG_PLATFORM_GAP.md) for the mapping and what is not wired yet. Set `IAG_GATEWAY_ORIGIN` (and the other `IAG_*` values in `.env.example`). The app expects a backend by default; `NEXT_PUBLIC_FRONTEND_ONLY=true` at build time gives a browser-only demo that never reaches MES.

There is no Spare Parts tab yet: no service owns a parts register.
