import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SubStatus = "active" | "grace" | "expired" | "inactive" | "loading";

export interface Subscription {
  status: SubStatus;
  days_left: number;
  monthly_amount: number;
  current_period_end: string | null;
  grace_end: string | null;
  admin_user_id: string | null;
  business_id: string | null;
  applies: boolean;
}

export function useSubscription() {
  const { user, isSuperAdmin } = useAuth();
  const [sub, setSub] = useState<Subscription>({
    status: "loading", days_left: 0, monthly_amount: 0,
    current_period_end: null, grace_end: null, admin_user_id: null, business_id: null, applies: false,
  });

  const refresh = async () => {
    if (!user || isSuperAdmin) {
      setSub((s) => ({ ...s, status: "inactive", applies: false }));
      return;
    }
    const { data } = await supabase.rpc("get_my_subscription_status");
    const row = (data ?? [])[0] as any;
    if (!row) {
      setSub({ status: "inactive", days_left: 0, monthly_amount: 0, current_period_end: null, grace_end: null, admin_user_id: null, business_id: null, applies: false });
      return;
    }
    setSub({
      status: row.status,
      days_left: row.days_left ?? 0,
      monthly_amount: Number(row.monthly_amount ?? 0),
      current_period_end: row.current_period_end,
      grace_end: row.grace_end,
      admin_user_id: row.admin_user_id,
      business_id: row.business_id ?? null,
      applies: true,
    });
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id, isSuperAdmin]);

  return { ...sub, refresh };
}
