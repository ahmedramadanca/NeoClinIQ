# Mapped OSCE station release checklist

Mapped stations use first-party, deterministic scripted turns. They do not send case material or candidate responses to an AI service. Candidate text is typed, never sent to a speech-recognition service; device-local synthesis is optional. The learner receives a case-specific self-review checklist, not an AI grade. The legacy preview endpoints remain unchanged.

A mapped station is not playable until a reviewer has individually approved it, validated its references with exact locations, and passed playability QA. An approved clinical profile must also have a valid clinical-review audit trail, a door note, a participant profile, a minute-five event and a rubric totalling 15. The guard expects the existing human-review status `approved` and authoring-queue stage `ready`. The authoring worker cannot publish ordinary generated drafts.

During QA author or confirm `encounter_script.approved_interactive_turns`, each an object with `cues` (alternative words/phrases a candidate may use), `reply` (learner-facing authored participant text) and optional `after_curve: true`. Confirm `encounter_script.approved_fallback_reply` is a safe participant response when no cue matches. Test that cues for medically important concepts cover common synonyms without unrelated disclosures; test the curve both before and after five minutes. References need a `title`, `source_id` or `url`, `section`, `page` or `locator`, and explicit `review_status` of `verified` or `approved`. Do not mark a station ready until its actual content has been approved and tested. The scripted mode does not show raw case files or private internal references to learners.

The edge route uses the website's existing OSCE entitlement and per-user session table. It verifies eligibility again on setup and all in-session steps, and requires matching case and attempt timestamps. Use synthetic fixtures or an isolated QA project, never promote a production learner draft simply to test.

Checks: from the repository root, run `node --test tests/osce-mapped-endpoint.test.mjs tests/osce-mapped-ui.test.mjs` using Node 24+.
