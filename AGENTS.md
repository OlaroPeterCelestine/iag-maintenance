<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Repo layout

- UI: this repo (`src/`, Next.js) — https://github.com/OlaroPeterCelestine/iag-erp-web
- Backend (Go Gin API): sibling `../backend/` folder, separate GitHub repo https://github.com/OlaroPeterCelestine/iag-erp-api
- ML / AI (FastAPI): local `ml-service/` folder, separate GitHub repo https://github.com/OlaroPeterCelestine/iag-erp-ml
- Docs: `docs/` (if present)

`../backend/` and `ml-service/` stay on disk for local/Railway workflows but are gitignored from this web repo.
<!-- END:nextjs-agent-rules -->
