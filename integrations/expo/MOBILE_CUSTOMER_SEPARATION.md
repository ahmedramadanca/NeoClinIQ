# NeoClinIQ: separate website and mobile customer populations

## Current production state

- **Website identity and website AI:** `uxnqoglkqptnslsdowxn`. Existing website account passwords and website entitlements remain unchanged.
- **Mobile identity and mobile purchases:** `kejjcltjhlpcjvvfauij`. Independent Auth user registry; `mobile_customer_profiles` and `mobile_entitlements` tables have RLS. No mobile users or purchases were migrated automatically.
- **Private clinical reference index:** remains on website backend, never exposed to client.
- **Mobile AI bridge:** `https://uxnqoglkqptnslsdowxn.supabase.co/functions/v1/mobile-original-reference-assistant`, deployed with gateway JWT checking disabled **deliberately** so the function can validate mobile-project bearer tokens internally with `mobileAuth.auth.getUser(jwt)`. It then checks `mobile_entitlements` through mobile-project RLS. No authenticated mobile token/active purchase means NO reference retrieval.
- **Website AI endpoint:** `original-reference-assistant`, unchanged. Website sessions do not work for the mobile endpoint.
- **Subscriptions:** `mobile_entitlements` can be populated only from trusted purchase reconciliation (Apple/Google/RevenueCat) using secure backend credentials. Client has SELECT-only access. Never make INSERT/UPDATE policies for users.

## Required Expo client changes before Build 10

1. Use `mobileSupabase.ts` to create the **only** Supabase Auth client used for *all* mobile login, sign-up, session, password recovery and purchase checks. Supply the existing React Native persistent storage adapter (do not instantiate a new client per screen).
2. Replace old usage of `askOriginalReferences` in the SI screen with `askMobileOriginalReferences` and pass the new mobile client. Do not send website JWTs to the mobile endpoint.
3. New mobile subscribers must create their own **mobile accounts**, including existing website customers. Same email is allowed because the Auth projects are independent. No website account password is copied.
4. In the **mobile** Supabase dashboard, configure SMTP, reset email templates, and allow the recovery redirect `neocliniq://reset-password`. Implement native deep-link password update using `auth.updateUser({password})` only after a verified recovery session. Do not claim email delivery solely because `resetPasswordForEmail` returns no error.
5. Wire real Apple/Google purchase verification or RevenueCat webhooks to an authenticated **server-side** entitlement writer in the mobile project. `mobile_entitlements` is initially empty and the bridge correctly denies unsubscribed users.
6. Test: website identity rejected on mobile; mobile identity rejected on website; unentitled mobile account denied AI; entitled mobile account allowed AI with citations; subscriptions are platform-specific; password recovery returns to the app; signed-out access denied. Then build and submit the next EAS TestFlight version.

## Security and release notes

Do not switch existing Build 9 in place: it was compiled against the original project. Build 9 is NOT migrated. There is currently no direct connection to the user's Windows `App.tsx` from GitHub. Prepare and apply these modules in local source then compile + submit a new build. Do not claim active mobile purchases until purchase webhook reconciliation is configured and tested.
