import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const PRICES: Record<string, {price:string;amount:number}> = {
 "mcq:initial": {price:"price_1UbXhAJcwpCPYZ6lurjLxMMo",amount:150000},
 "mcq:extension": {price:"price_1UbXipJcwpCPYZ6lYOqJvbe2",amount:75000},
 "osce:initial": {price:"price_1UbXlRJcwpCPYZ6lStJdV7hG",amount:180000},
 "osce:extension": {price:"price_1UbXmWJcwpCPYZ6lA8OIeyP3",amount:90000}
};
const reply = (s:string,status=200) => new Response(s,{status,headers:{"Content-Type":"text/plain; charset=utf-8"}});
type StripeEvent={id:string;type:string;livemode:boolean;data:{object:Record<string,any>}};
async function verified(body:string,header:string){
 const parts=header.split(",").map(s=>s.trim());
 const timestamp=parts.find(s=>s.startsWith("t="))?.slice(2);
 const signatures=parts.filter(s=>s.startsWith("v1=")).map(s=>s.slice(3).toLowerCase());
 if(!timestamp||!signatures.length||!/^\d+$/.test(timestamp))return false;
 const t=Number(timestamp);if(!Number.isSafeInteger(t)||Math.abs(Date.now()/1000-t)>300)return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(webhookSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"."+body)));
 const expected=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
 return signatures.some(sig=>{
  if(!/^[0-9a-f]{64}$/.test(sig))return false;
  let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^sig.charCodeAt(i);
  return difference===0;
 });
}
async function stripeGet(path:string){
 const r=await fetch("https://api.stripe.com/v1"+path,{headers:{Authorization:"Bearer "+stripeKey}});
 if(!r.ok)throw Error("Stripe API returned "+r.status);
 return await r.json();
}
async function rpc(name:string,args:Record<string,unknown>){
 if(!db)throw Error("Supabase unavailable");
 const {data,error}=await db.rpc(name,args);
 if(error)throw Error(name+": "+error.message);
 return data;
}
const audit=(e:StripeEvent,status:string,details:Record<string,unknown>={})=>rpc("record_website_stripe_event",{
 p_event_id:e.id,p_event_type:e.type,p_object_id:e.data?.object?.id??null,p_status:status,p_details:details
});
async function reconcile(key:string,type:string,reason:string,e:StripeEvent,details:Record<string,unknown>={},ids:{sessionId?:string;intentId?:string;userId?:string}={}){
 return rpc("record_website_reconciliation",{
  p_case_key:key,p_case_type:type,p_reason:reason,p_session_id:ids.sessionId??null,
  p_payment_intent_id:ids.intentId??null,p_user_id:ids.userId??null,p_stripe_event_id:e.id,p_details:details
 });
}
async function handleCheckout(e:StripeEvent){
 const id=e.data?.object?.id;
 if(typeof id!=="string"||!id.startsWith("cs_"))throw Error("Invalid session");
 const s=await stripeGet("/checkout/sessions/"+encodeURIComponent(id));
 if(s.id!==id||s.mode!=="payment"||s.status!=="complete"||s.payment_status!=="paid"){
  await audit(e,"ignored",{reason:"Session not paid"});return;
 }
 const m=s.metadata??{},userId=m.user_id,program=m.program,purchaseType=m.purchase_type,intentId=s.payment_intent;
 const expected=PRICES[program+":"+purchaseType];
 if(!expected||m.platform!=="website"||typeof userId!=="string"||
 !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)||
 typeof intentId!=="string"||!intentId.startsWith("pi_"))throw Error("Invalid checkout metadata");
 const items=await stripeGet("/checkout/sessions/"+encodeURIComponent(id)+"/line_items?limit=10");
 const line=items.data?.[0];
 const correct=items.has_more===false&&items.data?.length===1&&line?.price?.id===expected.price&&
 line?.quantity===1&&line?.amount_total===expected.amount&&s.currency?.toLowerCase()==="cad"&&
 s.amount_subtotal===expected.amount&&s.amount_total===expected.amount&&
 (s.total_details?.amount_discount??0)===0&&(s.total_details?.amount_tax??0)===0&&
 (!m.price_id||m.price_id===expected.price);
 if(!correct){
  await reconcile("payment-mismatch:"+id,"payment_mismatch","Checkout amount or price mismatch",e,
   {expected_price:expected.price,expected_amount:expected.amount,actual_amount:s.amount_total},
   {sessionId:id,intentId,userId});
  await audit(e,"needs_review",{reason:"Price or amount mismatch"});return;
 }
 const payment={p_user_id:userId,p_program:program,p_purchase_type:purchaseType,
  p_session_id:id,p_payment_intent_id:intentId,p_price_id:expected.price,
  p_amount_cents:expected.amount,p_currency:"cad"};
 // Intake and fulfillment RPCs must be idempotent and transactional in the database.
 await rpc("record_verified_website_payment",payment);
 try{await rpc("fulfill_website_payment",payment)}
 catch(err){
  const reason=String(err);
  await reconcile("fulfillment:"+id,"fulfillment_failed",reason,e,{program,purchase_type:purchaseType},{sessionId:id,intentId,userId});
  const {error}=await db!.from("website_payment_intake").update({processing_status:"needs_review"}).eq("stripe_checkout_session_id",id);
  if(error)throw error;
  await audit(e,"needs_review",{reason});return;
 }
 const {error}=await db!.from("website_payment_intake").update({processing_status:"fulfilled"}).eq("stripe_checkout_session_id",id);
 if(error)throw error;
 await audit(e,"processed",{session_id:id,program,purchase_type:purchaseType});
}
async function handleFinancial(e:StripeEvent){
 const obj=e.data?.object??{};
 const intentId=typeof obj.payment_intent==="string"?obj.payment_intent:null;
 if(!intentId){await audit(e,"needs_review",{reason:"Missing payment intent"});return}
 const {data:payment,error}=await db!.from("website_payment_intake")
  .select("user_id,stripe_checkout_session_id").eq("stripe_payment_intent_id",intentId).limit(1).maybeSingle();
 if(error)throw error;
 if(!payment){await audit(e,"ignored",{reason:"Not a recorded website payment"});return}
 const type= e.type==="charge.refunded"?"refund_succeeded":
  e.type==="charge.dispute.created"?"dispute_opened":"dispute_closed";
 await reconcile(e.type+":"+e.id,type,"Financial event requires manual entitlement review",e,
  {stripe_object_id:obj.id,dispute_status:obj.status??null,amount_refunded:obj.amount_refunded??null,amount:obj.amount??null,currency:obj.currency??null},
  {sessionId:payment.stripe_checkout_session_id,intentId,userId:payment.user_id});
 // DO NOT automatically revoke access: partial refunds, dispute outcomes and
 // prior extensions require policy-aware handling. Flag for reconciliation.
 await audit(e,"needs_review",{case_type:type,payment_intent_id:intentId});
}
Deno.serve(async request=>{
 if(request.method!=="POST")return reply("Method not allowed",405);
 if(!stripeKey||!webhookSecret||!db)return reply("Server configuration error",500);
 const signature=request.headers.get("stripe-signature");
 if(!signature)return reply("Missing Stripe signature",400);
 const raw=await request.text();
 if(!await verified(raw,signature))return reply("Invalid Stripe signature",400);
 let event:StripeEvent|undefined;
 try{
  event=JSON.parse(raw);
  if(!event||typeof event.id!=="string"||typeof event.type!=="string"||event.livemode!==true)
   return reply("Invalid live Stripe event",400);
  switch(event.type){
   case "checkout.session.completed":
   case "checkout.session.async_payment_succeeded":await handleCheckout(event);break;
   case "charge.refunded":
   case "charge.dispute.created":
   case "charge.dispute.closed":await handleFinancial(event);break;
   default:await audit(event,"ignored",{reason:"Unsupported event"});
  }
  return reply("Event processed",200);
 }catch(error){
  console.error("Webhook failure",{event_id:event?.id??null,event_type:event?.type??null,error:String(error)});
  return reply("Processing failed; retry required",500);
 }
});
