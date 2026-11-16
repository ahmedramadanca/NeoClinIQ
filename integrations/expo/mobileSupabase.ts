/**
 * NeoClinIQ mobile identities are in their OWN Supabase project.
 * Website users remain in the website project and do not carry over.
 * Use this client for all mobile login, sign-up, recovery, and mobile purchase checks.
 * Never use service_role keys in an app.
 */
import {createClient} from "@supabase/supabase-js";
export const MOBILE_SUPABASE_URL = "https://kejjcltjhlpcjvvfauij.supabase.co";
export const MOBILE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QjgB76XGpX9jQomzD8-Iqg_8NPlSXtw";
export const MOBILE_PASSWORD_RECOVERY_URL = "neocliniq://reset-password";

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Pass the Expo app's existing secure/persistent storage implementation. */
export function createNeoClinIQMobileAuth(storage: AsyncStorageLike) {
  return createClient(MOBILE_SUPABASE_URL, MOBILE_SUPABASE_PUBLISHABLE_KEY, {
    auth: {storage, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, flowType:"pkce"},
  });
}
export type NeoClinIQMobileAuthClient = ReturnType<typeof createNeoClinIQMobileAuth>;

export async function requestMobilePasswordReset(client: NeoClinIQMobileAuthClient, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) throw new Error("Enter a valid mobile account email address.");
  const {error} = await client.auth.resetPasswordForEmail(normalized, {
    redirectTo: MOBILE_PASSWORD_RECOVERY_URL,
  });
  if (error) throw new Error(error.message);
  return true; // Network request succeeded; delivery is not guaranteed.
}

export async function readActiveMobileEntitlement(client: NeoClinIQMobileAuthClient) {
  const {data:{user},error:userError} = await client.auth.getUser();
  if (userError || !user) return null;
  const {data,error} = await client.from("mobile_entitlements")
    .select("program,active,store,product_id,expires_at")
    .eq("user_id",user.id).eq("active",true).maybeSingle();
  if (error) throw error;
  if (!data || (data.expires_at && Date.parse(data.expires_at) <= Date.now())) return null;
  return data; // Read-only: only trusted backend/payment webhooks grant entitlement.
}
