import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE);
    const callerId = userData.user.id;

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
    const { data: isPlat } = await admin.rpc("has_role", { _user_id: callerId, _role: "platform_admin" });
    if (!isSuper && !isPlat) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const business_name: string = (body.business_name ?? "").trim();
    const email: string = (body.email ?? "").trim();
    const password: string = body.password ?? "";
    const full_name: string = (body.full_name ?? "").trim();
    const phone: string | null = body.phone ?? null;
    const payment_enabled: boolean = !!body.payment_enabled;
    const monthly_amount: number = Number(body.monthly_amount ?? 0);
    const initial_months: number = Number(body.initial_months ?? 0);

    if (!business_name || !email || !password || password.length < 6 || !full_name) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (payment_enabled && (!monthly_amount || monthly_amount <= 0)) {
      return new Response(JSON.stringify({ error: "Monthly amount required when payment is enabled" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Reuse existing user if email exists
    let newUserId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
    if (createErr) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
      if (!existing) {
        return new Response(JSON.stringify({ error: createErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      newUserId = existing.id;
    } else {
      newUserId = created.user!.id;
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .insert({ name: business_name, owner_id: newUserId, created_by: callerId, payment_enabled, monthly_amount, initial_months })
      .select()
      .single();
    if (bizErr || !biz) {
      return new Response(JSON.stringify({ error: bizErr?.message ?? "Business create failed" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("profiles").upsert({ id: newUserId, full_name, phone, business_id: biz.id });
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await admin.from("user_roles").insert({ user_id: newUserId, role: "admin", business_id: biz.id });
    if (roleErr) {
      return new Response(JSON.stringify({ error: roleErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_enabled && initial_months > 0) {
      const end = new Date(); end.setMonth(end.getMonth() + initial_months);
      await admin.from("subscriptions").insert({
        business_id: biz.id, admin_user_id: newUserId, monthly_amount, current_period_end: end.toISOString(),
      });
    }

    return new Response(JSON.stringify({ success: true, business_id: biz.id, admin_user_id: newUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
