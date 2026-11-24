const text = (value: unknown, limit = 1200) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const hasContent = (value: unknown): boolean => typeof value === "string" ? !!value.trim() :
  Array.isArray(value) ? value.length > 0 : !!value && typeof value === "object" && Object.keys(value).length > 0;

// Publication permission is separate from clinical/reference verification. A profile edit
// invalidates the permission until that precise content version is explicitly published again.
export function isOwnerReviewedPractice(generated: any, profile: any, now = Date.now()): boolean {
  if (!generated || !profile) return false;
  const script = profile.encounter_script;
  const publication = script?.publication;
  const contentTime = Date.parse(publication?.content_updated_at);
  const authorizedTime = Date.parse(publication?.authorized_at);
  const rawAge = profile.patient_identity?.age;
  const age = Number(rawAge);
  const ageProvided = typeof rawAge === "number" || (typeof rawAge === "string" && !!rawAge.trim());
  const checklist = Array.isArray(profile.examiner_checklist) ? profile.examiner_checklist.map((item: any) => ({
    name: text(item?.criterion, 180), max: Number(item?.max),
  })) : [];
  return generated.review_status === "published" && publication?.mode === "owner_reviewed_practice" &&
    publication.active === true && publication.source_verification === "pending" &&
    !!text(publication.authorized_by, 160) && !!text(publication.release_id, 100) &&
    Number.isFinite(contentTime) && contentTime === Date.parse(profile.updated_at) &&
    Number.isFinite(authorizedTime) && authorizedTime >= contentTime && authorizedTime <= now + 60000 &&
    !!text(generated.door_note, 3000) && !!text(profile.patient_identity?.name, 100) &&
    ageProvided && Number.isInteger(age) && age >= 0 && age <= 120 && !!text(profile.patient_identity?.gender, 50) &&
    !!text(script?.opening, 900) && hasContent(profile.clinical_history) &&
    hasContent(script?.hidden_facts) && hasContent(script?.patient_roleplay_rules) &&
    hasContent(script?.medication_status) && hasContent(script?.allergy_status) &&
    !!text(profile.fifth_minute_event?.disclosure, 900) && !!text(profile.fifth_minute_event?.trigger, 300) &&
    checklist.length > 0 && checklist.every((item: any) => item.name && Number.isInteger(item.max) && item.max > 0) &&
    new Set(checklist.map((item: any) => item.name)).size === checklist.length &&
    checklist.reduce((total: number, item: any) => total + item.max, 0) === 15;
}

export function hasVerifiedReferences(profile: any): boolean {
  const references = Array.isArray(profile?.clinical_reference_review) ? profile.clinical_reference_review : [];
  return references.length > 0 && references.every((reference: any) => {
    const locator = reference?.section ?? reference?.page ?? reference?.locator;
    return !!text(reference?.title, 250) &&
      ["verified", "approved"].includes(text(reference?.review_status, 40).toLowerCase()) &&
      (!!text(reference?.source_id, 120) || !!text(reference?.url, 500)) &&
      (!!text(locator, 300) || (typeof locator === "number" && Number.isInteger(locator) && locator > 0));
  });
}
