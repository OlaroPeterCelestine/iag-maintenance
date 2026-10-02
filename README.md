# IAG Maintenance

Machinery maintenance: the machine register, work orders, preventive schedules, spare parts, downtime, and job cards. Same shell as the other IAG web apps.

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

A workshop desk for plant and machinery. Machines are the register. Work orders raise a job. Preventive schedules say when service is next due. Spare parts list what a machine needs. Downtime records a stop. Job cards record the work that was done.

Records use the same storage keys as Production (`work-centers`, `production-orders`, `production-plans`, `bill-of-materials`, `downtime-logs`, `batch-records`) so they save through the existing API.
