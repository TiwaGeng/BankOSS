import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "admin" | "loan_officer" | "accountant" | "viewer";
type EmpType = "field" | "office";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const callerId = userData.user.id;

    const { data: isBizAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    if (!isBizAdmin) return json({ error: "Forbidden: business admin only" });

    const { data: callerProfile } = await admin.from("profiles").select("business_id").eq("id", callerId).maybeSingle();
    const businessId = callerProfile?.business_id;
    if (!businessId) return json({ error: "Your account is not linked to a business yet." });

    const body = await req.json();
    const email: string = (body.email ?? "").trim();
    const password: string = body.password ?? "";
    const full_name: string = (body.full_name ?? "").trim();
    const phone: string | null = body.phone ?? null;
    const role: Role = body.role;
    const employee_type: EmpType | null = (body.employee_type === "field" || body.employee_type === "office") ? body.employee_type : null;
    const validRoles: Role[] = ["admin", "loan_officer", "accountant", "viewer"];

    if (!email || !password || password.length < 6 || !full_name || !validRoles.includes(role) || !employee_type) {
      return json({ error: "Invalid input (email, password ≥6, name, role, work type required)" });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "Create failed" });

    const newUserId = created.user.id;

    await admin.from("profiles").upsert({ id: newUserId, full_name, phone, business_id: businessId, employee_type });

    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: newUserId, role, business_id: businessId });
    if (roleErr) return json({ error: roleErr.message });

    return json({ success: true, user_id: newUserId });
  } catch (e) {
    return json({ error: (e as Error).message });
  }
});
