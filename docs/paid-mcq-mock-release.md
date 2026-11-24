# Paid NeoClinIQ MCQ mock: draft checklist

**Not deployed.** Apply the SQL migration or deploy the endpoint only after securing qualified review, provenance and verification for all 200 items. No seed content is included. The synthetic test bank must never be imported into production. This is independent PEBC-style practice, not official PEBC material or a pass prediction.

- Entitlement requires an active, unexpired website MCQ subscription with the Stripe website source and a matching positive fulfilled MCQ payment. Complimentary, founder-test, OSCE-only and expired access do not qualify. An existing active authorized paid test account or a synthetic isolated staging account is needed for full integration verification.
- A 260-minute absolute server deadline begins at Start; dashboard status does not start an attempt. One attempt per learner per released form/version; refresh/retry resumes it. A save must replace the complete answer/flag snapshot and be received and validated before the authoritative deadline. At expiry the result reflects the last on-time snapshot. The browser never receives keys, rationales or source metadata before submission or expiry.
- Score all 200 independently from any official scoring process. Student feedback can display correct, wrong and unanswered counts and the rationale for the correct and selected answer. SI Library citation labels are plain title strings only. No document IDs, links, locators, storage paths, paid source extracts, or export routes are exposed.
- Blueprint counts: Clinical Care 100; Distribution 40; Knowledge & Expertise 22; Communication & Collaboration 8; Leadership & Stewardship 6; Professionalism 24. [Official competency blueprint](https://pebc.ca/wp-content/uploads/pdfs/Qual%20EN/Pharmacist_Qualifying_Exam_Blueprint.pdf). Do not reproduce recalled, leaked or published PEBC questions; original or licensed questions only. Confirm current exam specifications before release.

## Private curation template

Prepare these fields in the secure curation workspace, not in this repository or a public spreadsheet:

- **Form:** internal version, plain display name and final qualified reviewer ID/date.
- **Each item:** position (1–200), competency slug, provenance (`original` or `licensed`), private provenance note (authorship or license evidence), item reviewer ID and date, original stem, four distinct unambiguous options in display order, one 1-based correct index, one general rationale, and four order-matched option rationales.
- **Source evidence per item:** one to five indexed SI Library document IDs, the exact catalogue titles in matching order, and exact private page or section locators in matching order. The SQL release guard verifies each ID/title pair against the indexed SI catalogue. Independently verify that each exact locator supports the rationale and wording; title mapping alone is not clinical review. No real patient identifying information.
- Interleave competencies across positions. The released question and option order, answers and evidence titles are immutable; if correction is needed create a new reviewed form/version under a separately planned rollout.

## Pre-launch testing

Run the synthetic local database and Edge tests with Node 24+: `npm install --no-save @electric-sql/pglite@0.3.15`, then `node --test tests/mcq-mock-db.test.mjs tests/mcq-mock-edge.test.mjs` in an isolated scratch copy. Prepare staging access independently; keep Edge gateway JWT validation on, use an explicit staging website origin, test typed authentication and actual PostgreSQL database role/RLS permissions, then check parallel requests through two real sessions. Verify expired/revoked access, refresh, an abandoned attempt, save/submit races, rejection of unknown item IDs, and exact result redaction against the live transport using synthetic assets. Production status must remain unavailable until all gates pass.
