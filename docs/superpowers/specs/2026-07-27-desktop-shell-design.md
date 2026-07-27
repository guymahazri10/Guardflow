# Desktop shell (phase 1 of desktop support)

## Problem

GuardFlow is mobile-first and locked to a 430px-wide column (`max-w-mobile`)
on every authenticated page, with a fixed floating bottom nav. Opened on a
laptop/desktop browser, the app renders as a narrow phone-width strip in the
middle of a wide viewport — usable, but not "made for" a computer.

This is phase 1 of a two-phase project:

- **Phase 1 (this spec):** a shared desktop shell — sidebar nav instead of
  bottom nav, and a wider centered content container — applied uniformly to
  every page, with zero changes to any individual page's internal layout.
- **Phase 2 (future, separate spec):** redesign the internals of the
  data-heavy screens (Roster Editor, User Management, Admin Panel, Shift
  Setup) to actually use the extra width — wider tables, multi-column
  layouts, etc. Out of scope here.

## Goals

- Below `lg` (1024px): pixel-identical to today. No regression risk for the
  mobile experience, which is already correct and should not be touched.
- At `lg` and up: a fixed right-side sidebar (RTL) replaces the floating
  bottom nav, and page content sits in a wider (but still centered, not
  full-bleed) container.
- Pure CSS breakpoint switch (Tailwind `lg:` variants) — no JS viewport
  detection, no duplicate mobile/desktop component trees, no
  flash-of-wrong-layout on load.

## Non-goals

- Redesigning any individual page's internal content/layout (phase 2).
- Changing anything for logged-out routes' *content* beyond minor breathing
  room (Login, Accept Invite) — these never show a sidebar, since there's no
  session/nav to show before auth.
- Changing mobile behavior in any way.

## Design

### Breakpoint

Tailwind's `lg` (1024px). Chosen over `md` (768px) to avoid a cramped
in-between state on tablets/small laptop windows — below 1024px stays the
mobile layout (bottom nav, narrow column), which already works well and
scales down to small tablets fine.

### `AppShell`

Currently:

```tsx
<div dir="rtl" className="min-h-screen bg-background text-text-primary flex flex-col">
  <PositionChangeNotifier />
  <div className="mx-auto flex flex-1 w-full max-w-mobile flex-col pb-20">
    <main className="flex flex-1 flex-col"><Outlet /></main>
  </div>
  <BottomNav />
</div>
```

Becomes: at `lg:`, switch to a horizontal flex layout — fixed-width
`Sidebar` on the right (RTL leading edge) + a content area that grows to
fill the remaining space, internally capped and centered at a wider
max-width than mobile. `BottomNav` gets `lg:hidden`; `Sidebar` gets
`hidden lg:flex`, so exactly one nav renders at any viewport width.

Content container width: `max-w-mobile` below `lg:`, `lg:max-w-3xl` at and
above it (~768px) — a deliberate starting point, not a final answer; phase
2 may widen specific pages further once their internals are redesigned to
use the space.

### `Sidebar` (new component)

- Fixed-width column, `lg:flex` only, right-aligned (RTL).
- Reuses the exact same `NAV_ITEMS` list and role-filtering logic already in
  `BottomNav.tsx` (extract to a shared module rather than duplicating the
  array) — icon + label per row (horizontal), not icon-over-label like the
  mobile pill.
- GuardFlow logo at the top.
- Footer: current user's display name + role badge, plus a sign-out button
  (new — sign-out currently only lives on `/profile`; adding it here too is
  a deliberate scope addition the user asked for, using the existing
  `signOut` from `AuthContext`).

### Login / Accept Invite

No sidebar (pre-auth, no nav to show). On `lg:` and up, the existing
centered card gets a bit more breathing room (padding/max-width tweak) so
it doesn't look tiny in a wide viewport — cosmetic only, no structural
change.

### Testing

- Resize the browser pane through mobile (375px), tablet (768px), and
  desktop (1280px+) presets on each authenticated route plus Login, to
  confirm: exactly one nav renders at each width, no layout shift/overlap
  at the `lg` boundary, and the mobile view is pixel-identical to before
  the change.
- Verify role-based nav filtering still holds in the sidebar (guard sees
  fewer items than admin), matching current `BottomNav` behavior.
