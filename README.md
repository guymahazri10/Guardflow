# GuardFlow (Phase 1 Foundation)

GuardFlow is being rebuilt from scratch. This repository currently contains **Phase 1: project foundation only**.

## Project purpose

GuardFlow is intended to help manage shift operations with a clear separation between:
- shift structure templates
- daily staffing assignments

## Tech stack

- React
- Vite
- TypeScript
- Tailwind CSS
- React Router v6
- TanStack Query
- Supabase JavaScript client
- RTL Hebrew-first layout

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file:
   ```bash
   cp .env.example .env
   ```
3. Fill in `.env` values.
4. Run dev server:
   ```bash
   npm run dev
   ```

## Environment variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Phase plan

- **Phase 1 (current):** Foundation scaffolding, routes, placeholders, DB drafts.
- **Phase 2:** Auth and role model wiring.
- **Phase 3:** Shift workflow and staffing interactions.
- **Phase 4:** Admin and roster editing behaviors.
- **Phase 5:** Hardening, QA, and deployment.

## Important architecture rule

- `roster_boards` stores **schedule structure only** (columns, rows, notes, metadata).
- `shift_staffing` stores **daily guard names only** by `shift_id + shift_date`.
- Guard names must **never** be stored in `roster_boards`.
