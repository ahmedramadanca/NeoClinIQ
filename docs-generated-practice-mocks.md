# Additional MCQ timed practice mocks

The original owner-reviewed mock stays at /mcq-mock.html, with its existing service,
storage and attempts unchanged. Active paid website MCQ subscribers can use the
new portal card or /mcq-generated-mock.html to choose one of 20 additional forms
or pick an unstarted form at random. The 20 fixed form compositions are intentionally
prebuilt so that Clinical Care questions are not reused between forms. Other
competency pools can repeat across forms; no form has a repeated question.

Each form uses the May 2026 PEBC Part I domain weights as practice quotas:
100 Clinical Care, 40 Distribution, 22 Knowledge and Expertise, 8 Communication
and Collaboration, 6 Leadership and Stewardship, and 24 Professionalism.
Competency tags for generated practice are preliminary; neither these forms nor
scores are official PEBC examinations or intended to guide clinical care.

The catalog only exposes form metadata. A signed-in eligible learner can start
or resume their own attempt; server time owns the 4-hour 20-minute deadline.
Answer keys, feedback and source filenames are only returned after submission
or expiry. Sources aren't linked or downloaded by the site.

Operational sequence: apply isolated migration, prepare/test all 20 draft
forms without changing the original, deploy the authenticated generated-mock
endpoint, stage the code-only site routes, then activate and confirm the complete
generated cohort. Do not change the existing mock endpoint or try to release a
partial generated cohort. Public pages may describe the product; the exam page
and service remain noindex.
