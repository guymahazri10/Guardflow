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

## Supabase setup

1. Create a new Supabase project from the Supabase dashboard.
2. Open the project settings and copy the project URL into `.env`:
   ```bash
   VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
   ```
3. Copy the public anon key into `.env`:
   ```bash
   VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"
   ```
4. In the Supabase SQL editor, run the contents of `supabase/schema.sql`.
5. After the schema finishes successfully, run the contents of `supabase/rls.sql` in the same SQL editor.

Do not commit real Supabase keys or other secrets.

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
