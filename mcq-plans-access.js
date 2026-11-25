export const MCQ_TIERS=Object.freeze({
  simulator:Object.freeze({label:'MCQ Simulator',cad:700,extensionCad:350}),
  ultra:Object.freeze({label:'MCQ SI Super Intelligence Ultra',cad:1300,extensionCad:650}),
  ultimate:Object.freeze({label:'MCQ SI Super Intelligence Ultimate',cad:1800,extensionCad:900})
});
export const MCQ_CAPABILITIES=Object.freeze(['question_bank','mock_exams','si','library','mastery']);
export function isWebsiteActive(row, now=Date.now()){
  return row?.active===true&&Number.isFinite(Date.parse(row.expires_at))&&Date.parse(row.expires_at)>now;
}
export function isLegacyMcq(row){
  return !!row&&(row.tier==='legacy'||row.tier===null||row.tier===undefined);
}
export function isWebsiteMcqActive(row, now=Date.now()){
  // Existing open-ended entitlements pre-date the fixed-term plans.
  return isWebsiteActive(row,now)||(row?.active===true&&row.expires_at===null&&isLegacyMcq(row));
}
export function canUseMcq(row, capability, now=Date.now()){
  if(!MCQ_CAPABILITIES.includes(capability)||!isWebsiteMcqActive(row,now))return false;
  // An explicit capability contract is authoritative. Do not auto-grant unknown
  // features to new tiers when a server response is empty or incomplete.
  if(Object.prototype.hasOwnProperty.call(row,'capabilities'))return row.capabilities?.[capability]===true;
  // Before rollout the existing server did not identify tiers/capabilities.
  return isLegacyMcq(row)&&(row.expires_at!==null||capability==="si");
}
export function canUseWebsiteSI(entitlements,now=Date.now()){
  if(typeof entitlements?.capabilities?.si==='boolean')return entitlements.capabilities.si;
  return canUseMcq(entitlements?.mcq,'si',now);
}
export function tierCanCheckout(entitlements,tier){
  return Object.hasOwn(MCQ_TIERS,tier)&&entitlements?.checkout?.mcq?.initial_tiers?.[tier]===true
    &&!isWebsiteMcqActive(entitlements?.mcq);
}
export const MCQ_EXTENSION_GRACE_DAYS=42;
export function extensionGraceEnd(row){
  const expires=Date.parse(row?.expires_at);
  return Number.isFinite(expires)?expires+MCQ_EXTENSION_GRACE_DAYS*86400000:NaN;
}
export function tierCanExtend(entitlements,tier,now=Date.now()){
  if(!Object.hasOwn(MCQ_TIERS,tier))return false;
  const row=entitlements?.mcq,checkout=entitlements?.checkout?.mcq;
  const end=extensionGraceEnd(row);
  return row?.tier===tier&&row.extension_used===false&&checkout?.extension_eligible_tier===tier
    &&checkout?.extension_tiers?.[tier]===true&&Number.isFinite(end)&&now<=end;
}
export function tierForQuery(search=location.search){
  const value=new URLSearchParams(search).get('mcq_plan');
  return value&&Object.hasOwn(MCQ_TIERS,value)?value:null;
}
export function isStripeCheckoutUrl(input){
  if(typeof input!=='string')return false;
  try{const url=new URL(input);return url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password&&url.pathname.length>1}
  catch{return false}
}
