import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "super_admin" | "platform_admin" | "admin" | "loan_officer" | "accountant" | "viewer";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  businessId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (r: AppRole | AppRole[]) => boolean;
  isSuperAdmin: boolean;
  isPlatformAdmin: boolean;
  isBusinessUser: boolean;
  lockReason: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const LOCK_MESSAGE = "This account has been locked. Contact your admin for help to get back into the system. Thanks.";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockReason, setLockReason] = useState<string | null>(null);

  const loadProfile = async (uid: string) => {
    const [{ data: r }, { data: p }, { data: lock }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("business_id").eq("id", uid).maybeSingle(),
      supabase.rpc("get_effective_lock_status", { _user_id: uid }),
    ]);
    const rolesList = (r?.map((x) => x.role) ?? []) as AppRole[];
    setRoles(rolesList);
    setBusinessId(p?.business_id ?? null);
    const lockRow = (lock ?? [])[0] as { locked: boolean; reason: string | null } | undefined;
    if (lockRow?.locked) {
      const reason = lockRow.reason ?? "manual";
      const isPlatform = rolesList.includes("platform_admin");
      // Platform admin locked for subscription reason: keep signed in, show subscription page.
      if (isPlatform && reason === "subscription") {
        setLockReason("subscription");
      } else {
        setLockReason(null);
        await supabase.auth.signOut();
        try { sessionStorage.setItem("lock_message", LOCK_MESSAGE); } catch { /* noop */ }
      }
    } else {
      setLockReason(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setRoles([]);
        setBusinessId(null);
        setLockReason(null);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadProfile(s.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    roles,
    businessId,
    loading,
    lockReason,
    signOut: async () => { await supabase.auth.signOut(); },
    hasRole: (r) => {
      const arr = Array.isArray(r) ? r : [r];
      return arr.some((x) => roles.includes(x));
    },
    isSuperAdmin: roles.includes("super_admin"),
    isPlatformAdmin: roles.includes("platform_admin"),
    isBusinessUser: !!businessId && !roles.includes("super_admin") && !roles.includes("platform_admin"),
    refresh: async () => { if (user) await loadProfile(user.id); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
