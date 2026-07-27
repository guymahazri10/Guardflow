# Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-width shell (sidebar nav + wider content container) that activates at the `lg` (1024px) breakpoint, with zero change to the existing mobile layout below it.

**Architecture:** Extract the nav-item list + role-filter logic that `BottomNav` already owns into a shared module, build a new `Sidebar` component that consumes it, and wire both into `AppShell` behind Tailwind `lg:` breakpoint classes so exactly one nav renders at any viewport width. Pure CSS/Tailwind responsive switch — no JS viewport detection, no duplicate route trees.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, react-router-dom v6. No test framework exists in this repo (confirmed: no `test` script in `package.json`, no vitest/jest config, no `*.test.*` files) — verification throughout this plan is `npx tsc -b` (typecheck) plus manual browser verification via the Browser pane's `resize_window` tool, matching how every other feature in this codebase has been verified this session.

## Global Constraints

- Below `lg` (1024px): output must be pixel-identical to current mobile layout. Any visual diff at mobile widths is a regression, not a feature.
- RTL layout throughout (`dir="rtl"` is already set on `AppShell`'s root and must stay).
- Sidebar sits on the visual right edge of the screen (the RTL leading edge), matching the approved spec.
- Reuse `AuthContext`'s existing `isAdmin`, `isCommander`, `profile`, `appRole`, `signOut` — do not add new context state.
- Reuse the exact same nav item list and role-filter rules currently in `BottomNav.tsx` — do not fork or duplicate them.
- No changes to any page's internal content/layout (Roster Editor, User Management, Admin Panel, Shift Setup, Shift Live, Profile) — that's phase 2, out of scope here.

---

### Task 1: Extract shared nav items into their own module

**Files:**
- Create: `src/constants/navItems.tsx`
- Modify: `src/components/layout/BottomNav.tsx`

**Interfaces:**
- Produces: `export interface NavItem { to: string; label: string; icon: (active: boolean) => ReactElement; adminOnly?: boolean; editorOnly?: boolean }`, `export const NAV_ITEMS: NavItem[]`, `export function getVisibleNavItems(isAdmin: boolean, isCommander: boolean): NavItem[]` — Task 2 (Sidebar) imports all three from `../../constants/navItems`.

- [ ] **Step 1: Create `src/constants/navItems.tsx` with the extracted data**

Move the `NavItem` interface, `ACTIVE`/`INACTIVE` color constants, and the full `NAV_ITEMS` array verbatim out of `src/components/layout/BottomNav.tsx` (lines 1–74 of that file today), and add a `getVisibleNavItems` helper that wraps the filter logic already in `BottomNav`'s render body:

```tsx
import type { ReactElement } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: (active: boolean) => ReactElement
  adminOnly?: boolean
  editorOnly?: boolean
}

const ACTIVE = '#ffffff'
const INACTIVE = '#6F7782'

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/shift-live',
    label: 'שידור חי',
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    to: '/shift-setup',
    label: 'שיבוץ',
    editorOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    to: '/admin',
    label: 'ניהול',
    adminOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    to: '/users',
    label: 'משתמשים',
    adminOnly: true,
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'פרופיל',
    icon: (active) => (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? ACTIVE : INACTIVE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7" r="4" />
        <path d="M5.5 21a8.38 8.38 0 0 1 13 0" />
      </svg>
    ),
  },
]

export function getVisibleNavItems(isAdmin: boolean, isCommander: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.editorOnly && !isAdmin && !isCommander) return false
    return true
  })
}
```

- [ ] **Step 2: Rewrite `BottomNav.tsx` to consume the shared module instead of owning the data**

Replace the full file with:

```tsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getVisibleNavItems } from '../../constants/navItems';

export default function BottomNav() {
  const { isAdmin, isCommander } = useAuth();
  const visibleItems = getVisibleNavItems(isAdmin, isCommander);

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-3 safe-bottom">
      <div className="max-w-mobile mx-auto flex items-center justify-around bg-white/85 backdrop-blur-md border border-black/[0.06] rounded-full shadow-card-md py-1.5 px-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-1 px-2.5 py-1"
          >
            {({ isActive }) => (
              <>
                <span
                  className={`w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors ${
                    isActive ? 'bg-primary' : ''
                  }`}
                >
                  {item.icon(isActive)}
                </span>
                <span className={`text-[9.5px] ${isActive ? 'font-extrabold text-primary' : 'font-medium text-text-secondary'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
```

The only functional change versus today is `getVisibleNavItems(isAdmin, isCommander)` replacing the inline `.filter(...)`, and `lg:hidden` added to the root `<nav>` so it stops rendering once the sidebar takes over at `lg:` (added now so Task 3 doesn't have to touch this file again).

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification — BottomNav unchanged at mobile width**

Using the Browser pane on the local dev server (`preview_start` with `{name: "guardflow"}` — check `.claude/launch.json` for the exact config name if unsure), log in, resize to the `mobile` preset (375×812), and screenshot `/shift-live`. Confirm the bottom nav pill renders identically to before this change (same icons, same active-state highlight, same position). This can't yet be checked at desktop width since `Sidebar` doesn't exist until Task 2 — for now, just confirm mobile is unaffected and nothing renders in its place at `lg:` widths (bottom nav should simply disappear at 1024px+, with no sidebar yet — that's expected and correct for this task).

- [ ] **Step 5: Commit**

```bash
git add src/constants/navItems.tsx src/components/layout/BottomNav.tsx
git commit -m "$(cat <<'EOF'
Extract nav items into a shared module ahead of desktop sidebar

BottomNav owned the nav item list and role-filter logic inline; the
upcoming desktop Sidebar needs the exact same list and rules, so this
pulls both into constants/navItems.tsx for both to import instead of
forking a second copy. Also adds lg:hidden to BottomNav's root so it
correctly steps aside once the sidebar exists.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Build the `Sidebar` component

**Files:**
- Create: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `getVisibleNavItems(isAdmin, isCommander): NavItem[]` from `src/constants/navItems.tsx` (Task 1); `useAuth()` from `src/contexts/AuthContext.tsx` — specifically `isAdmin`, `isCommander`, `profile`, `appRole`, `signOut`.
- Produces: `export default function Sidebar()` — Task 3 (`AppShell`) renders `<Sidebar />`.

- [ ] **Step 1: Create `src/components/layout/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getVisibleNavItems } from '../../constants/navItems'
import logoFull from '../../assets/logo_full.png'

export default function Sidebar() {
  const { isAdmin, isCommander, profile, appRole, signOut } = useAuth()
  const visibleItems = getVisibleNavItems(isAdmin, isCommander)

  return (
    <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col border-l border-border bg-white">
      <div className="px-5 py-6">
        <img src={logoFull} alt="GuardFlow" className="h-8 w-auto" />
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {visibleItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors">
            {({ isActive }) => (
              <>
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? 'bg-primary' : ''
                  }`}
                >
                  {item.icon(isActive)}
                </span>
                <span className={`text-sm ${isActive ? 'font-extrabold text-primary' : 'font-medium text-text-secondary'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-4 flex flex-col gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{profile?.full_name ?? '—'}</p>
          <p className="text-xs text-text-muted">{appRole ?? ''}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void signOut()
          }}
          className="btn-ghost w-full text-sm"
        >
          התנתקות
        </button>
      </div>
    </aside>
  )
}
```

Notes for the implementer:
- `hidden lg:flex` on the root `<aside>` is what keeps this invisible below `lg:` and makes it a flex column at and above it — this is the other half of the "exactly one nav renders" rule (`BottomNav` got `lg:hidden` in Task 1).
- `border-l` (not `border-r`) is correct even though the sidebar sits on the visual right: the border sits on the sidebar's physical left edge, which is the edge touching the content area, regardless of RTL — RTL affects flex item *order*, not which physical CSS property `border-l`/`border-r` refers to.
- `logoFull` is the same asset `LoginPage.tsx` already imports (`../assets/logo_full.png`) — reused, not a new asset.
- `profile?.full_name` can be `null` for a user who hasn't set one yet (confirmed live in the DB during this session — e.g. an account created via Google with no name set) — the `?? '—'` fallback handles that.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 3: Commit**

Sidebar isn't mounted anywhere yet (that's Task 3), so this step just locks in a typechecked, unused-but-correct component:

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "$(cat <<'EOF'
Add desktop Sidebar component (not yet wired into AppShell)

Mirrors BottomNav's nav items and role filtering (via the shared
constants/navItems module from the previous commit), styled as a fixed
right-side column instead of a floating bottom pill, plus a footer with
the signed-in user's name/role and a sign-out button — sign-out
previously only lived on /profile.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire `Sidebar` into `AppShell` and widen the content container at `lg:`

**Files:**
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `Sidebar` default export from `src/components/layout/Sidebar.tsx` (Task 2).

- [ ] **Step 1: Rewrite `AppShell.tsx`**

```tsx
import { Outlet } from 'react-router-dom'
import BottomNav from './layout/BottomNav'
import Sidebar from './layout/Sidebar'
import { PositionChangeNotifier } from './PositionChangeNotifier'

export function AppShell() {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-text-primary flex flex-col lg:flex-row">
      <PositionChangeNotifier />

      <Sidebar />

      <div className="mx-auto flex flex-1 w-full max-w-mobile flex-col pb-20 lg:max-w-3xl lg:pb-8 lg:px-8 lg:py-8">
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
```

What changed versus today, and why each change is safe at mobile widths:
- `flex-col lg:flex-row` on the root: below `lg:`, this is unchanged (`flex-col`, exactly as before). At `lg:` and up, children lay out horizontally so `Sidebar` sits beside the content column instead of stacking above it.
- `<Sidebar />` added: renders `null`-equivalent below `lg:` (its own root has `hidden` as the base class), so it has zero effect on mobile.
- `lg:max-w-3xl lg:px-8 lg:py-8` added to the content wrapper: below `lg:`, `max-w-mobile` and `pb-20` still apply exactly as before (Tailwind only adds the `lg:` rules on top, at that breakpoint and up) — this widens the container and swaps the mobile-only bottom-nav clearance (`pb-20`) for ordinary padding once the bottom nav isn't showing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 3: Visual verification — mobile unaffected**

Using the Browser pane, log in, resize to `mobile` preset (375×812), and screenshot each authenticated route (`/shift-live`, `/shift-setup`, `/admin`, `/users`, `/profile`, whichever the logged-in role can reach). Confirm every screen is pixel-identical to before Task 3 — same bottom nav, same content width, no sidebar visible.

- [ ] **Step 4: Visual verification — desktop shows the sidebar correctly**

Resize to the `desktop` preset (1280×800) and screenshot `/shift-live`. Confirm:
- The sidebar renders fixed on the right edge with the GuardFlow logo, nav items, and the user's name/role + sign-out button at the bottom.
- The bottom nav pill is gone (no duplicate nav).
- Page content is centered in a wider column than the mobile 430px, not full-bleed edge-to-edge.
- Clicking each visible sidebar nav item navigates correctly and highlights the active item (blue circle behind the icon, bold blue label).

- [ ] **Step 5: Visual verification — role-based filtering matches `BottomNav`'s existing behavior**

Still at the `desktop` preset: log in as (or check via the seeded test accounts from earlier in this session — `guy97735@gmail.com` is `מנהל`, `ran78771@gmail.com` is `אחמ"ש`, the `guymah@wix.com` / `guy-test` account is `מאבטח`) each of the three roles in turn, and confirm the sidebar shows exactly the same set of items that `BottomNav` shows that role today: guard sees שידור חי + פרופיל only; אחמ"ש additionally sees שיבוץ; מנהל sees all five.

- [ ] **Step 6: Visual verification — tablet width shows exactly one nav, no overlap**

Resize to the `tablet` preset (768×1024) — below the `lg:` (1024px) cutoff, so this must still show the mobile bottom-nav layout, not the sidebar. Confirm no visual glitch at this in-between width (no partially-visible sidebar, no double nav).

- [ ] **Step 7: Test sign-out from the sidebar**

At `desktop` preset, click "התנתקות" in the sidebar footer. Confirm it signs out and redirects to `/login`, matching the existing sign-out behavior already used on `/profile`.

- [ ] **Step 8: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "$(cat <<'EOF'
Wire the desktop sidebar into AppShell

AppShell now switches from a stacked mobile column to a sidebar + content
row at the lg breakpoint (1024px), widens the content container from
430px to a centered ~768px, and drops the mobile-only bottom-nav bottom
padding once BottomNav itself is hidden at that width. Below lg, output
is unchanged — Sidebar renders nothing there and every mobile class stays
exactly as it was.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Desktop breathing room on Login and Accept Invite

**Files:**
- Modify: `src/pages/LoginPage.tsx:54`
- Modify: `src/pages/AcceptInvitePage.tsx:50`, `:58`, `:69`

**Interfaces:** None — purely a className tweak on existing markup, no new props or exports.

- [ ] **Step 1: Widen the Login card container at `lg:`**

In `src/pages/LoginPage.tsx`, line 54 currently reads:

```tsx
    <section dir="rtl" className="mx-auto flex min-h-[80vh] w-full max-w-mobile items-center px-6 py-8">
```

Change to:

```tsx
    <section dir="rtl" className="mx-auto flex min-h-[80vh] w-full max-w-mobile items-center px-6 py-8 lg:max-w-md lg:py-16">
```

- [ ] **Step 2: Widen all three Accept Invite states at `lg:`**

In `src/pages/AcceptInvitePage.tsx`, there are three `<section>` roots (loading, invalid-link, and the real form) at lines 50, 58, and 69. Each currently has `max-w-mobile` with no `lg:` override. Apply the same `lg:max-w-md` to each:

Line 50 (loading state) — change:
```tsx
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center justify-center px-4 text-text-secondary">
```
to:
```tsx
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center justify-center px-4 text-text-secondary lg:max-w-md">
```

Line 58 (invalid link state) — change:
```tsx
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile flex-col items-center justify-center px-4 text-center gap-3">
```
to:
```tsx
      <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile flex-col items-center justify-center px-4 text-center gap-3 lg:max-w-md">
```

Line 69 (the real password-set form) — change:
```tsx
    <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center px-4 py-8">
```
to:
```tsx
    <section dir="rtl" className="mx-auto flex min-h-[70vh] w-full max-w-mobile items-center px-4 py-8 lg:max-w-md lg:py-16">
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 4: Visual verification**

Using the Browser pane:
- Resize to `mobile` (375×812), screenshot `/login`. Confirm unchanged from before this task.
- Resize to `desktop` (1280×800), screenshot `/login`. Confirm the card is noticeably less cramped than a raw 430px box in a 1280px viewport, still centered, no layout break.
- Navigate to an accept-invite URL (or at minimum confirm via the invalid-link state, which needs no real invite token — visiting `/accept-invite` while logged out or with a bad/expired link renders that state) at both `mobile` and `desktop` presets and confirm the same before/after behavior.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx src/pages/AcceptInvitePage.tsx
git commit -m "$(cat <<'EOF'
Give Login and Accept Invite more breathing room on wide screens

Both pages are only reachable pre-auth, so they never show the new
sidebar — this is a standalone cosmetic tweak so their cards don't look
like a stray 430px box floating in a 1280px viewport. Mobile is
unaffected; only the lg: max-width/padding change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full cross-route, cross-width regression pass

**Files:** None modified — verification only.

- [ ] **Step 1: Deploy or run the full app locally with all four prior commits in place**

If verifying against the local dev server, ensure `preview_start` is pointed at it and you're logged in as a `מנהל` (the highest-privilege role, so every route is reachable).

- [ ] **Step 2: Walk every authenticated route at `mobile` (375×812)**

For each of `/shift-live`, `/shift-setup`, `/admin`, `/roster-editor`, `/users`, `/profile`: screenshot and confirm it looks identical to how it looked before this whole plan started (bottom nav visible, `max-w-mobile` content, no sidebar).

- [ ] **Step 3: Walk every authenticated route at `desktop` (1280×800)**

Same route list. For each: confirm the sidebar renders on the right with the correct nav items highlighted for the current route, the bottom nav is absent, and the page content sits in the wider `lg:max-w-3xl` column without any overlap, clipping, or horizontal scroll on the page body.

- [ ] **Step 4: Confirm `/login` and `/accept-invite` (invalid-link state) at both widths**

Per Task 4's verification, re-confirm both still look correct after all other changes landed on top.

- [ ] **Step 5: Run the full typecheck one final time**

Run: `npx tsc -b`
Expected: no output (clean).

- [ ] **Step 6: No commit for this task** — it's a verification-only pass. If any regression is found, fix it as a small follow-up commit referencing which task's change caused it, then re-run this task's steps.
