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
}

export function useSubscription() {
  const { user, isSuperAdmin, isPlatformAdmin, businessId } = useAuth();
  const [sub, setSub] = useState<Subscription>({
    status: "loading", days_left: 0, monthly_amount: 0,
    current_period_end: null, grace_end: null, admin_user_id: null,
  });

  const applies = !!user && !isSuperAdmin && (isPlatformAdmin || !!businessId);

  const refresh = async () => {
    if (!applies) {
      setSub((s) => ({ ...s, status: "inactive" }));
      return;
    }
    const { data } = await supabase.rpc("get_my_subscription_status");
    const row = (data ?? [])[0] as any;
    if (!row) {
      setSub({
        status: "inactive", days_left: 0, monthly_amount: 0,
        current_period_end: null, grace_end: null, admin_user_id: null,
      });
      return;
    }
    setSub({
      status: row.status,
      days_left: row.days_left ?? 0,
      monthly_amount: Number(row.monthly_amount ?? 0),
      current_period_end: row.current_period_end,
      grace_end: row.grace_end,
      admin_user_id: row.admin_user_id,
    });
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id, businessId, isSuperAdmin, isPlatformAdmin]);

  return { ...sub, refresh, applies };
}
