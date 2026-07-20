import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Developer-only: create a platform admin (no business attached).
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
    if (userErr || !userData.user) return json({ error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const callerId = userData.user.id;

    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: callerId });
    if (!isSuper) return json({ error: "Forbidden: developer only" });

    const body = await req.json();
    const email: string = (body.email ?? "").trim().toLowerCase();
    const password: string = body.password ?? "";
    const full_name: string = (body.full_name ?? "").trim();
    const phone: string | null = body.phone ?? null;

    if (!email || !password || password.length < 6 || !full_name) {
      return json({ error: "Invalid input" });
    }

    // Try to find an existing auth user with this email (paginated list).
    let existingId: string | null = null;
    for (let page = 1; page <= 20 && !existingId; page++) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) break;
      const match = list.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (match) existingId = match.id;
      if (list.users.length < 200) break;
    }

    let newUserId: string;
    if (existingId) {
      // Reuse the existing auth user; just (re)set password + promote to platform_admin.
      const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (updErr) return json({ error: `Email already registered; failed to update: ${updErr.message}` });
      newUserId = existingId;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });
      if (createErr || !created.user) return json({ error: createErr?.message ?? "Create failed" });
      newUserId = created.user.id;
    }

    await admin.from("profiles").upsert({ id: newUserId, full_name, phone, business_id: null });
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: newUserId, role: "platform_admin", business_id: null });
    if (roleErr) return json({ error: roleErr.message });

    // Optional subscription setup
    const monthly_amount = Number(body.monthly_amount ?? 0);
    const initial_months = Number(body.initial_months ?? 0);
    if (monthly_amount > 0) {
      const now = new Date();
      const periodEnd = initial_months > 0
        ? new Date(now.getFullYear(), now.getMonth() + initial_months, now.getDate()).toISOString()
        : null;
      await admin.from("subscriptions").upsert({
        admin_user_id: newUserId,
        monthly_amount,
        current_period_end: periodEnd,
      }, { onConflict: "admin_user_id" });
      if (initial_months > 0) {
        await admin.from("subscription_payments").insert({
          admin_user_id: newUserId,
          amount: monthly_amount * initial_months,
          months_requested: initial_months,
          months_granted: initial_months,
          status: "confirmed",
          confirmed_by: callerId,
          confirmed_at: now.toISOString(),
          note: "Initial subscription set by developer",
        });
      }
    }

    return json({ success: true, user_id: newUserId, reused: !!existingId });
  } catch (e) {
    return json({ error: (e as Error).message });
  }
});
