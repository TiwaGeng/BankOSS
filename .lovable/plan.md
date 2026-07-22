# Implementation Plan

Big change spanning routing, RLS, locking cascade, subscription notifications, validation, and role-scoped reports.

## 1. Role-based login routing

- After sign-in in `Auth.tsx` (and on `AuthProvider` hydration in `App.tsx`):
  - `super_admin` → `/developer` (DeveloperDashboard)
  - `platform_admin` → `/admin` (AdminDashboard)
  - Business users (admin / loan_officer / accountant / viewer) → `/dashboard`
- Guard `/dashboard` so super_admin & platform_admin are redirected away (they should not see business "today summary").

## 2. Account locking (cascade)

Rules:
- Super admin can lock a platform_admin → that admin AND every business they created AND all employees of those businesses get locked.
- Platform admin can lock a business → all employees of that business get locked.
- Business admin can lock individual employees of their business.
- Locked user login shows: **"This account has been locked. Contact your admin for help to get back into the system. Thanks."** on the Auth page (sign them out immediately after showing message).
- Exception: if a platform_admin is locked *only because their subscription expired* (developer chose "lock for non-payment"), on login they still land on a stripped Dashboard with a **"Make subscription"** / **Continue** / **Cancel** dialog — allowed to reach only `/subscription` until paid.

Implementation:
- Reuse existing `profiles.is_active` and `businesses.is_active`.
- Add `profiles.locked_reason` text nullable (`'manual' | 'subscription'`).
- Add DB function `public.get_effective_lock_status(_user_id)` returning `{ locked: bool, reason: text }` that checks:
  1. `profiles.is_active = false` for that user
  2. If business user: `businesses.is_active = false` for their `business_id`
  3. If business user: their creating platform_admin's `profiles.is_active`
- `useAuth` calls this after session load; if locked → sign out + set `lockMessage`, except `reason='subscription'` on a platform_admin (keep them signed in, force `/subscription`).
- `AppLayout` already blocks expired subs — extend for the lock reason branching.

## 3. Business admin subscription page visibility

- Already gated by `useSubscription().applies`. Verify nav item + `/subscription` route only show when `applies` is true. If a business has `payment_enabled=false`, hide entirely.

## 4. Subscription payment notifications to platform admin

When a business admin uploads a subscription payment proof (`Subscription.tsx`):
- After insert, look up the platform_admin who created that business (`businesses.created_by`) → their profile phone.
- In-app: insert a row in a new `notifications` table (`user_id`, `title`, `body`, `read_at`, `link`). Show unread count + dropdown in `AppLayout` header for platform_admin & super_admin.
- WhatsApp: open `wa.me/<phone>?text=...` in a new tab with a prefilled message: *"Business <name> submitted a subscription payment of <amount> for <months> month(s). Review in the billing page."*
- On `approve_subscription_payment` RPC success, also open WhatsApp to the business admin phone confirming activation and insert a notification for that admin.

## 5. Client duplicate validation

- DB: add unique index on `clients (business_id, lower(full_name), lower(coalesce(last_name,'')), coalesce(phone,''))` — allow same first name alone but block full match.
- DB: also add validation that phone (when provided) is unique per business — separate unique partial index `where phone is not null`.
- `NewClient.tsx` and `ManageClients.tsx`: pre-check with a `.select` before insert/update, show clear toast; also handle unique-violation error (`23505`) gracefully.
- Client-side phone regex: digits, +, spaces, dashes; min 7 digits.

## 6. Role-scoped Reports

- **Super admin (`/developer` reports section)**: show only platform admin data (list of platform admins, their subscription status, businesses count, revenue collected). No client/loan data.
- **Platform admin (`/admin` reports & audit)**: show only their created businesses' subscription activity + payments they approved. No visibility into clients/loans/employees of those businesses.
- **Developer daily report**: replace current content with rows of platform admins with subscription-enabled: `name`, `business count`, `days_left`, `status (active/grace/expired)`, `Lock` button. Locking sets `profiles.is_active=false` with `locked_reason='subscription'`.

## 7. Business name visibility

- Developer & Platform admin dashboards + tables: always show business name column and the owning platform admin name.

## 8. Guardrails

- Add zod schemas everywhere new form submits happen.
- Update RLS: locked users should not be able to write. Add helper `public.is_user_active(auth.uid())` used in `WITH CHECK` on client-facing writes.

## Technical breakdown

**Migration (single SQL):**
- `alter table profiles add column locked_reason text;`
- `create unique index clients_unique_full_identity on public.clients (business_id, lower(full_name), lower(coalesce(last_name,'')), coalesce(phone,''));`
- `create unique index clients_unique_phone on public.clients (business_id, phone) where phone is not null and phone <> '';`
- `create table public.notifications (id uuid pk, user_id uuid not null, title text, body text, link text, read_at timestamptz, created_at timestamptz default now());` + GRANTs + RLS (`user_id = auth.uid()`).
- `create or replace function public.is_account_locked(_uid uuid) returns table(locked bool, reason text) security definer ...` cascading through business + creator.
- `create or replace function public.notify(_user_id uuid, _title text, _body text, _link text) returns void security definer ...` for edge/RPC use.
- Update `approve_subscription_payment` to insert notification for business owner.

**Frontend files touched:**
- `src/hooks/useAuth.tsx` — post-login lock check + redirect target.
- `src/pages/Auth.tsx` — display lock message from redirect state.
- `src/App.tsx` — role-based default routes, guards for `/dashboard`.
- `src/components/app/AppLayout.tsx` — notifications bell, hide `/subscription` when not applicable.
- `src/pages/Subscription.tsx` — after upload, trigger platform admin WhatsApp + notification.
- `src/pages/admin/BusinessBilling.tsx` — WhatsApp on approve, notification on approve.
- `src/pages/clients/NewClient.tsx` + `ManageClients.tsx` — dupe validation, phone regex.
- `src/pages/developer/DeveloperDashboard.tsx` + reports — subscription-focused view, lock button.
- `src/pages/admin/AdminDashboard.tsx` + reports/audit — scoped to businesses they created.
- `src/pages/Employees.tsx` — activate/deactivate toggle for business admin.
- `src/pages/Businesses.tsx` — already has activate/deactivate; ensure it cascades employees via `is_account_locked`.
- New `src/components/app/NotificationsBell.tsx`.

Approve to proceed and I'll ship it end-to-end.
