import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Power } from "lucide-react";

const today = new Date().toISOString().slice(0, 10);

interface Loan { id: string; principal: number; status: string; given_at: string; due_at: string | null; clients?: { full_name: string } | null; }
interface Payment { id: string; amount: number; paid_at: string; loans?: { clients?: { full_name: string } | null } | null; }

const BusinessReports = () => {
  const [overdue, setOverdue] = useState<Loan[]>([]);
  const [todayPays, setTodayPays] = useState<Payment[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: ls } = await supabase.from("loans").select("*, clients(full_name)").or(`status.eq.overdue,and(status.eq.active,due_at.lt.${today})`);
      setOverdue((ls ?? []) as Loan[]);
      const { data: ps } = await supabase.from("payments").select("*, loans(clients(full_name))").eq("paid_at", today);
      const list = (ps ?? []) as Payment[];
      setTodayPays(list);
      setTodayTotal(list.reduce((a, p) => a + Number(p.amount), 0));
    })();
  }, []);

  return (
    <div className="space-y-8">
      <header><h1 className="font-display text-3xl font-bold">Reports</h1><p className="text-muted-foreground">Daily activity & overdue clients</p></header>
      <Card><CardHeader><CardTitle>Daily Report — {today}</CardTitle><p className="text-sm text-muted-foreground">{todayPays.length} payments · {todayTotal.toLocaleString()} collected</p></CardHeader>
        <CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
          <TableBody>{todayPays.length === 0 ? <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No payments today</TableCell></TableRow>
            : todayPays.map((p) => <TableRow key={p.id}><TableCell>{p.loans?.clients?.full_name ?? "—"}</TableCell><TableCell>{Number(p.amount).toLocaleString()}</TableCell></TableRow>)}
          </TableBody></Table></CardContent></Card>
      <Card><CardHeader><CardTitle>Overdue Loans</CardTitle><p className="text-sm text-muted-foreground">{overdue.length} loans need attention</p></CardHeader>
        <CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Principal</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{overdue.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No overdue loans 🎉</TableCell></TableRow>
            : overdue.map((l) => <TableRow key={l.id}><TableCell className="font-medium">{l.clients?.full_name ?? "—"}</TableCell><TableCell>{Number(l.principal).toLocaleString()}</TableCell><TableCell>{l.due_at ?? "—"}</TableCell><TableCell><Badge variant="destructive">{l.status}</Badge></TableCell></TableRow>)}
          </TableBody></Table></CardContent></Card>
    </div>
  );
};

// Developer view: platform admins with subscription remaining and lock buttons
interface AdminSub { id: string; full_name: string | null; phone: string | null; is_active: boolean; payment_enabled: boolean; days_left: number | null; period_end: string | null; business_count: number; }

const DeveloperReports = () => {
  const [rows, setRows] = useState<AdminSub[]>([]);

  const load = async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "platform_admin");
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (!ids.length) { setRows([]); return; }
    const [{ data: profs }, { data: subs }, { data: bizs }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, is_active, payment_enabled").in("id", ids),
      supabase.from("subscriptions").select("admin_user_id, current_period_end").in("admin_user_id", ids).is("business_id", null),
      supabase.from("businesses").select("created_by").in("created_by", ids),
    ]);
    const subMap: Record<string, string> = {};
    (subs ?? []).forEach((s: any) => { subMap[s.admin_user_id] = s.current_period_end; });
    const bizCount: Record<string, number> = {};
    (bizs ?? []).forEach((b: any) => { bizCount[b.created_by] = (bizCount[b.created_by] || 0) + 1; });
    const built: AdminSub[] = (profs ?? []).map((p: any) => {
      const end = subMap[p.id] ? new Date(subMap[p.id]).getTime() : null;
      const grace = end ? end + 5 * 24 * 3600 * 1000 : null;
      const daysLeft = grace ? Math.max(0, Math.ceil((grace - Date.now()) / (24 * 3600 * 1000))) : null;
      return { id: p.id, full_name: p.full_name, phone: p.phone, is_active: p.is_active, payment_enabled: p.payment_enabled, period_end: subMap[p.id] ?? null, days_left: daysLeft, business_count: bizCount[p.id] || 0 };
    });
    setRows(built);
  };
  useEffect(() => { load(); }, []);

  const lockForSubscription = async (id: string) => {
    if (!confirm("Lock this admin for non-payment? Their businesses and employees will also lose access.")) return;
    const { error } = await supabase.rpc("set_platform_admin_active", { _user_id: id, _active: false, _reason: "subscription" });
    if (error) return toast.error(error.message);
    toast.success("Admin locked for non-payment"); load();
  };
  const unlock = async (id: string) => {
    const { error } = await supabase.rpc("set_platform_admin_active", { _user_id: id, _active: true });
    if (error) return toast.error(error.message);
    toast.success("Admin unlocked"); load();
  };

  const paying = rows.filter((r) => r.payment_enabled);

  return (
    <div className="space-y-6">
      <header><h1 className="font-display text-3xl font-bold">Reports</h1><p className="text-muted-foreground">Subscription status of platform admins.</p></header>
      <Card><CardHeader><CardTitle>Platform admins with subscription ({paying.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Businesses</TableHead><TableHead>Period ends</TableHead><TableHead>Days left</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {paying.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No paying admins</TableCell></TableRow>
                : paying.map((r) => {
                  const status = !r.is_active ? "locked" : r.days_left == null ? "inactive" : r.days_left <= 0 ? "expired" : r.days_left <= 5 ? "grace" : "active";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell>{r.business_count}</TableCell>
                      <TableCell>{r.period_end ? new Date(r.period_end).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>{r.days_left ?? "—"}</TableCell>
                      <TableCell><Badge variant={status === "active" ? "default" : status === "locked" || status === "expired" ? "destructive" : "secondary"}>{status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {r.is_active
                          ? <Button size="sm" variant="destructive" onClick={() => lockForSubscription(r.id)}><Power className="h-4 w-4 mr-1" />Lock</Button>
                          : <Button size="sm" onClick={() => unlock(r.id)}><Power className="h-4 w-4 mr-1" />Unlock</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent></Card>
    </div>
  );
};

// Platform admin view: their businesses' subscription activity
const AdminReports = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { (async () => {
    if (!user) return;
    const { data: bizs } = await supabase.from("businesses").select("id, name, monthly_amount, payment_enabled").eq("created_by", user.id);
    const bizIds = (bizs ?? []).map((b: any) => b.id);
    if (!bizIds.length) { setRows([]); return; }
    const { data: pays } = await supabase.from("subscription_payments").select("*").in("business_id", bizIds).order("created_at", { ascending: false });
    const map: Record<string, string> = {};
    (bizs ?? []).forEach((b: any) => { map[b.id] = b.name; });
    setRows((pays ?? []).map((p: any) => ({ ...p, business_name: map[p.business_id] })));
  })(); }, [user]);

  return (
    <div className="space-y-6">
      <header><h1 className="font-display text-3xl font-bold">Reports</h1><p className="text-muted-foreground">Subscription activity across your managed businesses.</p></header>
      <Card><CardHeader><CardTitle>Subscription payments ({rows.length})</CardTitle></CardHeader>
        <CardContent><Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Business</TableHead><TableHead>Amount</TableHead><TableHead>Months</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No subscription activity</TableCell></TableRow>
            : rows.map((r) => <TableRow key={r.id}>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="font-medium">{r.business_name ?? "—"}</TableCell>
                <TableCell>{Number(r.amount).toLocaleString()}</TableCell>
                <TableCell>{r.months_requested ?? r.months_granted}</TableCell>
                <TableCell><Badge variant={r.status === "confirmed" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
              </TableRow>)}
          </TableBody></Table></CardContent></Card>
    </div>
  );
};

const Reports = () => {
  const { isSuperAdmin, isPlatformAdmin } = useAuth();
  if (isSuperAdmin) return <DeveloperReports />;
  if (isPlatformAdmin) return <AdminReports />;
  return <BusinessReports />;
};

export default Reports;
