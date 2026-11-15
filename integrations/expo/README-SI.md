# NeoClinIQ SI — Super Intelligence

NeoClinIQ's citation-backed original-reference study assistant for the existing Expo/React Native application.

## What is implemented
- `NeoClinIQSIScreen.tsx` — ready-to-mount React Native screen with clinical question entry, secure result request, and source citations.
- `originalReferenceAssistant.ts` — typed API client that forwards the current authenticated Supabase session to the deployed `original-reference-assistant` Edge Function.
- `OriginalReferenceScreen.tsx` — compatibility re-export for older callers.

## Install into the actual mobile app
The native app's source is not in this website repository, so this integration is **not yet wired into TestFlight**. In the actual NeoClinIQ Expo project:

1. Copy `NeoClinIQSIScreen.tsx` and `originalReferenceAssistant.ts` into the app source.
2. Import your existing authenticated Supabase client (the same client used for sign-in and entitlements).
3. Register the screen in the app's existing navigation structure under the label **NeoClinIQ SI — Super Intelligence**.
4. Render `<NeoClinIQSIScreen supabase={supabase} />` within the authenticated learner flow.
5. Build a new iOS TestFlight build and verify access using a paid member and an unauthorized account.

## Guardrails
- Subscriber allowance: 45 valid clinical questions per UTC clock hour, enforced server-side.
- Admin exemption requires trusted Supabase `app_metadata`; it must never be inferred from user-editable profile data.
- No PDF or Drive download URLs should be returned by the backend.
- Source citations are indexed document and passage identifiers.
- Never bundle the service-role key in the client.
- Real clinical decisions require independent verification. This tool is educational and not a clinical decision support substitute.

## Website
The website assistant is at https://neocliniq.maplecanadaramadan.ca/reference-ai.html.
