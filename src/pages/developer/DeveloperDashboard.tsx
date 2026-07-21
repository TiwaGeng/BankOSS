import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, ShieldCheck, Users, HandCoins, Power, CheckCircle2, XCircle, DollarSign } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

interface Admin { id: string; full_name: string | null; phone: string | null; is_active: boolean; payment_enabled: boolean; }
interface Pending { id: string; admin_user_id: string; amount: number; months_requested: number | null; created_at: string; note: string | null; proof_url: string | null; }

const DeveloperDashboard = () => {
  const [stats, setStats] = useState({ admins: 0, businesses: 0, clients: 0, loans: 0 });
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);

  const load = async () => {
    const [a, b, c, l] = await Promise.all([
      supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "platform_admin"),
      supabase.from("businesses").select("*", { count: "exact", head: true }),
      supabase.from("clients").select("*", { count: "exact", head: true }),
      supabase.from("loans").select("*", { count: "exact", head: true }),
    ]);
    setStats({ admins: a.count ?? 0, businesses: b.count ?? 0, clients: c.count ?? 0, loans: l.count ?? 0 });

    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "platform_admin");
    const ids = (roles ?? []).map((r: any) => r.user_id);
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, phone, is_active, payment_enabled").in("id", ids);
      setAdmins((profs ?? []) as Admin[]);
    } else setAdmins([]);

    const { data: pays } = await supabase.from("subscription_payments").select("*").eq("status", "pending").is("business_id", null).order("created_at", { ascending: false });
    setPending((pays ?? []) as Pending[]);
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (a: Admin) => {
    const { error } = await supabase.rpc("set_platform_admin_active", { _user_id: a.id, _active: !a.is_active });
    if (error) return toast.error(error.message);
    toast.success(a.is_active ? "Deactivated" : "Activated"); load();
  };
  const togglePay = async (a: Admin) => {
    const { error } = await supabase.rpc("set_platform_admin_payment_enabled", { _user_id: a.id, _enabled: !a.payment_enabled });
    if (error) return toast.error(error.message);
    toast.success("Updated"); load();
  };
  const approve = async (id: string) => {
    const { error } = await supabase.rpc("approve_subscription_payment", { _payment_id: id });
    if (error) return toast.error(error.message);
    toast.success("Approved"); load();
  };
  const reject = async (id: string) => {
    const reason = prompt("Reason?") ?? "";
    const { error } = await supabase.rpc("reject_subscription_payment", { _payment_id: id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Rejected"); load();
  };
  const openProof = async (path: string) => {
    const { data } = await supabase.storage.from("subscription-proofs").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const cards = [
    { label: "Platform admins", value: stats.admins, icon: ShieldCheck },
    { label: "Businesses", value: stats.businesses, icon: Building2 },
    { label: "Clients", value: stats.clients, icon: Users },
    { label: "Loans", value: stats.loans, icon: HandCoins },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Developer dashboard</h1>
        <p className="text-muted-foreground">Overview across the entire platform.</p>
      </header>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => { const Icon = c.icon; return (
          <Card key={c.label}>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0"><CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle><Icon className="h-4 w-4 text-muted-foreground" /></CardHeader>
            <CardContent><div className="text-3xl font-bold">{fmt(c.value)}</div></CardContent>
          </Card>
        );})}
      </div>

      <Card>
        <CardHeader><CardTitle>Platform admins</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Payment</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {admins.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No platform admins</TableCell></TableRow> : admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.full_name ?? "—"}</TableCell>
                  <TableCell>{a.phone ?? "—"}</TableCell>
                  <TableCell>{a.payment_enabled ? <Badge>Enabled</Badge> : <Badge variant="secondary">Disabled</Badge>}</TableCell>
                  <TableCell>{a.is_active ? <Badge>Active</Badge> : <Badge variant="destructive">Deactivated</Badge>}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => togglePay(a)}><DollarSign className="h-4 w-4 mr-1" />{a.payment_enabled ? "Disable pay" : "Enable pay"}</Button>
                    <Button size="sm" variant={a.is_active ? "destructive" : "default"} onClick={() => toggleActive(a)}><Power className="h-4 w-4 mr-1" />{a.is_active ? "Deactivate" : "Activate"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pending platform-admin payments ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Months</TableHead><TableHead>Note</TableHead><TableHead>Proof</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {pending.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No pending payments</TableCell></TableRow> : pending.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{fmt(Number(p.amount))}</TableCell>
                  <TableCell>{p.months_requested ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.note ?? "—"}</TableCell>
                  <TableCell>{p.proof_url ? <Button size="sm" variant="link" onClick={() => openProof(p.proof_url!)}>View</Button> : "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" onClick={() => approve(p.id)}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(p.id)}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default DeveloperDashboard;
