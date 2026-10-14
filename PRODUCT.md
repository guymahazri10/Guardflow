# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Security teams working a site in shifts (campus-style security). Three roles, enforced by the app:
- **מנהל (manager):** builds, edits and publishes shift boards, manages templates, invites users and sets roles. Works mostly at a desk.
- **אחמ"ש (shift commander):** fills in guard names for the active shift and links names to registered users. Desktop or phone.
- **מאבטח (guard):** reads the live board. Confirmed: mostly on a phone, standing, in quick glances, to see who works where right now. Never edits.

## Product Purpose
Hebrew, RTL, mobile-first web app that keeps shift staffing and post assignments in one place so everyone sees the same board: who is on shift, at which post, now. Success means a guard or commander can answer "who is where right now" at a glance, and a guard learns about an upcoming post change without asking.

## Positioning
A shared board for managing and viewing a security shift, with role-based permissions and a post-change alert shortly before a guard's post changes. Weekly schedule import exists but is limited (see constraints).

## Operating Context
- Shifts: morning 07:00-15:00, afternoon 15:00-23:00, night 23:00-07:00 (Israel time). The live screen picks the active shift from the real clock.
- A board is a set of roles x time blocks x posts. Names are attached per role.
- Guards may have the app installed to the home screen; iOS push works only from an installed app.

## Capabilities and Constraints
- Confirmed in code: live view (now / whole shift), shift setup (names, link to registered user), board editor (draft / publish), shift templates, user management and invites, post-change alert (push + in-app), names reset automatically after a shift ends.
- Limited: weekly schedule import, weekly schedule view and dated assignments sit behind the feature flag `weekly_schedule_import`. Image import is parsed server-side by an external model; PDF is not supported in the UI.
- Positions are free text in many cases and can be long (for example "סידור עמדת קבלה + תדריך"). Names can be long. A shift can have many roles.
- Audience scope is undecided: single organization or a product for several security companies.
- Not verified in this record: end-to-end push delivery on real devices.

## Brand Commitments
Hebrew, RTL, Heebo. Existing logo files stay as they are (black, not recolored). Existing design tokens live in `design.md`, `tailwind.config.js` and `src/constants/colors.ts`; position colors keep their meaning and status never relies on color alone.

## Evidence on Hand
No customers, testimonials, metrics or case studies exist. Do not invent any. Real screenshots exist only with guard names redacted.

## Product Principles
- Who is where, now, is the first thing every screen answers.
- One source of truth for a shift; no screen shows a different version of it.
- Operational clarity beats decoration: names and posts are always on a readable surface.
- Meaning is never carried by color alone.

## Accessibility & Inclusion
Hebrew RTL. Text contrast at least 4.5:1, touch targets at least 44px, visible keyboard focus, reduced motion respected. Measured contrast of the current position badges is below this for most positions.
