# Procura

RFP and bidding platform for Quince sourcing & procurement. Prototype.

## Running it locally

You need **Docker Desktop** running and **Node 20+**. Both are already installed
on this machine.

```bash
cd procura
npm install          # first time only
npm run db:up        # starts MySQL 8.4 in Docker (port 3307)
npm run db:migrate   # creates the tables
npm run seed         # loads styles, vendors, bids   [F2 — not built yet]
npm run dev          # http://localhost:3000
```

Open <http://localhost:3000>. The landing page shows a green badge for the
database when the whole chain is live.

### If something is wrong

| Symptom | Fix |
|---|---|
| "The database is not reachable" | `npm run db:up`. If Docker Desktop is not running, launch it first. |
| Port 3000 in use | `PORT=3001 npm run dev` |
| Port 3307 in use | Change the host port in `docker-compose.yml` and the port in `.env` to match |
| Want to inspect the data | `npm run db:studio` opens Prisma Studio at <http://localhost:5555> |
| Start completely fresh | `npm run db:down && docker volume rm procura_procura-mysql-data && npm run db:up && npm run db:migrate` |

### The commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run db:up` / `db:down` | Start / stop MySQL |
| `npm run db:studio` | Browse the database in a GUI |
| `npm run db:migrate` | Apply schema changes |
| `npm run seed` | Load seed data |
| `npm test` | Unit tests for `domain/` |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint:ui` | Quince Core audit against the running app |

`npm run lint:ui` needs the dev server up. It proves the linter can fail before
trusting a pass — an empty run and a clean run look identical otherwise.

## How it is built

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, CSR | Quince frontend guardrail; carries into V1 and V2 |
| Language | TypeScript | Domain logic ports to Kotlin cleanly |
| UI | Quince Core v3.2 | Tokens, 33 components, its own linter |
| API | Route handlers under `/app/api/*` | The contract Spring Boot reimplements at V1 |
| ORM | Prisma 7 | Schema maps directly to JPA entities |
| DB | MySQL 8.4 in Docker | Same engine as RDS — deletes a migration step |
| Auth | None; Vendor View impersonation | Okta arrives in V1 |

### Five rules that keep the V1 migration cheap

1. **MySQL, not Postgres.** Schema carries over untouched.
2. **No Prisma call ever appears in a component.** Every read and write goes
   through `/app/api/*`. That API surface *is* the contract.
3. **`domain/` has no framework imports.** Pure functions — cost chain,
   guardrails, scoring. Ports to Kotlin almost line for line.
4. **OpenAPI entry alongside every route handler**, written as it is written.
5. **App Router + CSR**, matching the Quince frontend guardrail.

### Design system

Quince Core is vendored in two places:

- `public/ds/` — CSS, fonts, icons, served statically and linked in `layout.tsx`
- `src/ds/components/` — the React bindings

Both come from `~/.claude/skills/quince-core-design-system`. Two local changes,
both marked `PROCURA CHANGE` in the source:

- `Icon.tsx` imports glyph data from `src/ds/icons/glyphs.ts` instead of reading
  `window.QICONS`, which does not exist during SSR
- every binding carries `'use client'`

Rules when writing UI: compose from components (never restyle a div to resemble
one), Tier-2 semantic tokens only, no hex literals, no invented tokens, icons by
their exact snake_case name from the 180-glyph set.

## Deploying

Local only for now, but built cloud-ready — the database URL and every tuning
constant are env-driven, and product images are hotlinked from a public CDN.
Deploying is a hosted-MySQL connection string, not a refactor.

## Where things are

```
procura/
├── src/
│   ├── app/
│   │   ├── api/          the service boundary
│   │   ├── AppShell.tsx  nav + header
│   │   └── layout.tsx    design system load order
│   ├── domain/           pure TypeScript, no framework imports
│   ├── ds/               vendored Quince Core
│   └── lib/db.ts         the only place Prisma is constructed
├── prisma/schema.prisma
├── scripts/
│   ├── lint-ui.mjs       Quince Core audit
│   ├── shot.mjs          screenshot a route
│   └── seed/             Excel + CSV -> DB
└── docker-compose.yml
```
