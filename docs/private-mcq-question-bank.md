# Private subscriber question bank: deployment notes

This code-only patch is an unpublished implementation. It contains no NotebookLM
questions, learner sessions, credentials, or SI Library objects. The 200-question
mock is unchanged and separate. No item is published by the migration.

## Where learners find the bank

- Public PEBC MCQ navigation opens the public informational page, then the Learning Portal.
- The portal's **MCQ Question Bank** card and MCQ Library button only appear when
  the bank API confirms an eligible active, paid website MCQ subscription and
  at least one released item.
- **96-Day MCQ Mastery Plan → Practise this day’s session topics** passes the
  selected day's published planner chapter integers as repeated `planner`
  parameters. The private chapter mapping resolves the topics. An unmapped scope
  never falls back to all topics. A catch-up day links to the full bank.
- The practice route is `/mcq-question-bank.html` with noindex/noarchive.
  Only the public informational route belongs in the sitemap.

## Release order (staging first)

1. Compare the five existing HTML files in this overlay to the site's current
   main branch and merge the specific changes if main has moved. Keep the current
   branded assets and `mcq-mock.css`.
2. In an isolated Supabase staging environment, confirm the existing website
   Stripe entitlement, payment/reconciliation, and indexed SI catalog schema.
   Apply the migration. Deploy `website-mcq-bank` with the staging URL/proxy and
   allowed website origin. If the edge gateway does not support current Supabase
   signing keys, use the existing verified-token deployment pattern; the function
   itself always checks the bearer token with Supabase Auth before database access.
3. Load the 161 chapters and all 4,919 original questions with restricted
   operator access, leaving every row unreleased. Load observed filenames into
   the private quiz roster keyed by set ID. Keep questions, options, answer keys
   and feedback identical to the source; source lists are not answer-specific
   citations or an independent clinical review.
4. Validate all 191 roster mappings. The database requires the exact approved
   filenames for the matching saved set. An approved roster takes precedence
   over indexed-catalog fallback. Publish all 4,919 together only after staging
   tests, not one module or one quiz at a time. Preserve unclassified competency
   labels and keep the 200-question mock separate.
5. Deploy code-only website changes. Test signed-out, unrelated entitlement,
   expired/reconciled transaction, paid/released, day-topic links and phone
   viewport with approved staging accounts. The deployment does not grant or
   modify any entitlement.

## Data/API contract

- `private.mcq_bank_chapters`: code, module_number, module_title,
  chapter_title, and optional planner_chapter_numbers integer[].
- `private.mcq_bank_items`: one stable NCQ item ID, chapter code, kind, stem,
  options `[{id,text}]`, correct_option_ids, option_rationales keyed by option
  ID, or expected_answer plus answer_rationale for written self-check;
  competency_domain, competency_code and competency_status; exact approved
  reference_titles (text[]) and released (false by default).
- `website-mcq-bank`: POST actions status, catalog, list and answer. List returns
  a bounded page without answer keys, rationales, references or file IDs. Answer
  returns feedback after choice selection. Written drafts remain on the page and
  are never sent to the API. Both responses are authorization checked and
  non-cacheable. RLS and RPC grants keep internal tables private.
- Exact PEBC codes follow the [May 2026 blueprint](https://pebc.ca/pharmacists/qualifying-examination/preparing-for-the-examination/examination-blueprint/).
  Preliminary item mappings are labelled; unmapped items stay unclassified.

## Revert

Set released=false for all affected items (do not delete the private corpus).
The Portal, Library, and plan then hide their subscriber-practice buttons. If
needed, revert the code-only website commit and disable the edge function.
Preserve existing billing, mock and learner-plan data. Do not drop database
objects containing material without an approved retention and backup plan.
