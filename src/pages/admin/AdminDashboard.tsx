import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, XCircle, Clock, MessageCircle, CreditCard } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

interface Row { id: string; name: string; is_active: boolean; payment_enabled: boolean; monthly_amount: number; owner_id: string | null; owner_phone: string | null; owner_email: string | null; owner_name: string | null; sub_status: "active" | "grace" | "expired" | "inactive" | "none"; }

const AdminDashboard = () => {
  const { user } = useAuth();
  const [payEnabled, setPayEnabled] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total: 0, active: 0, subscribed: 0, expired: 0, pending: 0 });

  useEffect(() => { (async () => {
    if (!user) return;
    const { data: me } = await supabase.from("profiles").select("payment_enabled").eq("id", user.id).maybeSingle();
    setPayEnabled(!!me?.payment_enabled);

    const { data: bizList } = await supabase
      .from("businesses").select("id, name, is_active, payment_enabled, monthly_amount, owner_id")
      .order("created_at", { ascending: false });
    const list = (bizList ?? []) as any[];
    const ownerIds = list.map((b) => b.owner_id).filter(Boolean);
    const { data: profs } = ownerIds.length ? await supabase.from("profiles").select("id, phone, full_name").in("id", ownerIds) : { data: [] as any[] };
    const profMap: Record<string, any> = {};
    (profs ?? []).forEach((p: any) => { profMap[p.id] = p; });

    // subscription status per business
    const { data: subs } = await supabase.from("subscriptions").select("business_id, current_period_end").not("business_id", "is", null);
    const subMap: Record<string, string> = {};
    (subs ?? []).forEach((s: any) => {
      const end = new Date(s.current_period_end).getTime();
      const now = Date.now();
      const grace = end + 5 * 24 * 3600 * 1000;
      subMap[s.business_id] = now <= end ? "active" : now <= grace ? "grace" : "expired";
    });

    const { data: pendingPays } = await supabase.from("subscription_payments").select("id, business_id").eq("status", "pending").not("business_id", "is", null);
    const pendingCount = (pendingPays ?? []).length;

    const built: Row[] = list.map((b) => ({
      id: b.id, name: b.name, is_active: b.is_active, payment_enabled: b.payment_enabled, monthly_amount: Number(b.monthly_amount),
      owner_id: b.owner_id, owner_phone: b.owner_id ? profMap[b.owner_id]?.phone ?? null : null,
      owner_email: null, owner_name: b.owner_id ? profMap[b.owner_id]?.full_name ?? null : null,
      sub_status: b.payment_enabled ? ((subMap[b.id] as any) ?? "inactive") : "none",
    }));
    setRows(built);
    setTotals({
      total: built.length,
      active: built.filter((r) => r.is_active).length,
      subscribed: built.filter((r) => r.payment_enabled && r.sub_status === "active").length,
      expired: built.filter((r) => r.payment_enabled && (r.sub_status === "expired" || r.sub_status === "grace")).length,
      pending: pendingCount,
    });
  })(); }, [user]);

  const cards = payEnabled
    ? [
        { label: "Total businesses", value: totals.total, icon: Building2 },
        { label: "Total subscriptions", value: totals.subscribed, icon: CheckCircle2 },
        { label: "Failed / expired", value: totals.expired, icon: XCircle },
        { label: "Pending approvals", value: totals.pending, icon: Clock },
      ]
    : [
        { label: "Total businesses", value: totals.total, icon: Building2 },
        { label: "Active", value: totals.active, icon: CheckCircle2 },
        { label: "Deactivated", value: totals.total - totals.active, icon: XCircle },
      ];

  const whatsapp = (phone: string | null) => {
    if (!phone) return;
    const d = phone.replace(/[^\d]/g, "").replace(/^0+/, "");
    window.open(`https://wa.me/${d}`, "_blank");
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Admin dashboard</h1>
        <p className="text-muted-foreground">Overview across the businesses you manage.</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-3xl font-bold">{fmt(c.value)}</div></CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Business</TableHead><TableHead>Owner</TableHead><TableHead>Phone</TableHead>
              {payEnabled && <TableHead>Subscription</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={payEnabled ? 5 : 4} className="text-center text-muted-foreground py-6">No businesses yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name} {!r.is_active && <Badge variant="destructive" className="ml-2">Deactivated</Badge>}</TableCell>
                  <TableCell>{r.owner_name ?? "—"}</TableCell>
                  <TableCell>{r.owner_phone ?? "—"}</TableCell>
                  {payEnabled && (
                    <TableCell>
                      {r.sub_status === "none" ? <Badge variant="secondary">Free</Badge>
                        : r.sub_status === "active" ? <Badge>Active</Badge>
                        : r.sub_status === "grace" ? <Badge variant="secondary">Grace</Badge>
                        : r.sub_status === "expired" ? <Badge variant="destructive">Expired</Badge>
                        : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                  )}
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => whatsapp(r.owner_phone)}><MessageCircle className="h-4 w-4" /></Button>
                    {payEnabled && r.payment_enabled && (
                      <Button asChild size="sm" variant="outline"><Link to={`/admin/businesses/${r.id}/billing`}><CreditCard className="h-4 w-4 mr-1" />Billing</Link></Button>
                    )}
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

export default AdminDashboard;
