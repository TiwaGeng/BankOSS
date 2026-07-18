import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Developer-only: create a business AND its first admin user.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE);
    const callerId = userData.user.id;

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
    const { data: isPlat } = await admin.rpc("has_role", { _user_id: callerId, _role: "platform_admin" });
    if (!isSuper && !isPlat) {
      return new Response(JSON.stringify({ error: "Forbidden: developer or platform admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const business_name: string = (body.business_name ?? "").trim();
    const email: string = (body.email ?? "").trim();
    const password: string = body.password ?? "";
    const full_name: string = (body.full_name ?? "").trim();
    const phone: string | null = body.phone ?? null;

    if (!business_name || !email || !password || password.length < 6 || !full_name) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Create the admin user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? "Create failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const newUserId = created.user.id;

    // 2. Create the business owned by that user
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .insert({ name: business_name, owner_id: newUserId, created_by: callerId })
      .select()
      .single();
    if (bizErr || !biz) {
      // best-effort cleanup
      await admin.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({ error: bizErr?.message ?? "Business create failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Link profile + role to that business
    await admin.from("profiles").upsert({ id: newUserId, full_name, phone, business_id: biz.id });
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: newUserId, role: "admin", business_id: biz.id });
    if (roleErr) {
      return new Response(JSON.stringify({ error: roleErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, business_id: biz.id, admin_user_id: newUserId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
