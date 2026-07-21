import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";
import { Building2, ShieldAlert, Plus, MessageCircle, CreditCard, Power } from "lucide-react";
import { Link } from "react-router-dom";

const schema = z.object({
  business_name: z.string().trim().min(2).max(100),
  full_name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  password: z.string().min(6).max(72),
});

interface Business {
  id: string; name: string; owner_id: string | null; created_by: string | null;
  created_at: string; payment_enabled: boolean; monthly_amount: number;
  initial_months: number; is_active: boolean;
}
interface OwnerProfile { id: string; phone: string | null; full_name: string | null; }

const Businesses = () => {
  const { user, isSuperAdmin, isPlatformAdmin } = useAuth();
  const allowed = isSuperAdmin || isPlatformAdmin;
  const [items, setItems] = useState<Business[]>([]);
  const [owners, setOwners] = useState<Record<string, OwnerProfile>>({});
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string>>({});
  const [adminPayEnabled, setAdminPayEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    business_name: "", full_name: "", email: "", phone: "", password: "",
    payment_enabled: false, monthly_amount: 0, initial_months: 1,
  });

  const load = async () => {
    setLoading(true);
    const { data: bizList } = await supabase
      .from("businesses")
      .select("id, name, owner_id, created_by, created_at, payment_enabled, monthly_amount, initial_months, is_active")
      .order("created_at", { ascending: false });
    const list = (bizList ?? []) as Business[];
    setItems(list);
    const ownerIds = list.map((b) => b.owner_id).filter(Boolean) as string[];
    if (ownerIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, phone, full_name").in("id", ownerIds);
      const map: Record<string, OwnerProfile> = {};
      (profs ?? []).forEach((p: any) => { map[p.id] = p; });
      setOwners(map);
    }
    if (user) {
      const { data: me } = await supabase.from("profiles").select("payment_enabled").eq("id", user.id).maybeSingle();
      setAdminPayEnabled(!!me?.payment_enabled);
      if (me?.payment_enabled) setForm((f) => ({ ...f, payment_enabled: true }));
    }
    setLoading(false);
  };

  useEffect(() => { if (allowed) load(); /* eslint-disable-next-line */ }, [allowed]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast({ title: "Invalid", description: parsed.error.issues[0].message, variant: "destructive" });
    if (form.payment_enabled && (!form.monthly_amount || form.monthly_amount <= 0)) {
      return toast({ title: "Missing amount", description: "Enter a monthly subscription amount.", variant: "destructive" });
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-business", {
      body: {
        business_name: parsed.data.business_name, email: parsed.data.email, password: parsed.data.password,
        full_name: parsed.data.full_name, phone: parsed.data.phone || null,
        payment_enabled: adminPayEnabled ? form.payment_enabled : false,
        monthly_amount: form.monthly_amount, initial_months: form.initial_months,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      return toast({ title: "Failed", description: (data as any)?.error ?? error?.message ?? "Could not create", variant: "destructive" });
    }
    toast({ title: "Business created", description: `${parsed.data.business_name} is ready.` });
    setForm({ business_name: "", full_name: "", email: "", phone: "", password: "", payment_enabled: adminPayEnabled, monthly_amount: 0, initial_months: 1 });
    load();
  };

  const toggleActive = async (b: Business) => {
    const { error } = await supabase.rpc("set_business_active", { _business_id: b.id, _active: !b.is_active });
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: b.is_active ? "Deactivated" : "Activated" });
    load();
  };

  const whatsappTo = (phone: string | null, msg?: string) => {
    if (!phone) return toast({ title: "No phone number saved for this owner." });
    const digits = phone.replace(/[^\d]/g, "").replace(/^0+/, "");
    const text = msg ?? "";
    window.open(`https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank");
  };

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <Card><CardContent className="p-8 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <h2 className="text-xl font-semibold">Restricted</h2>
          <p className="text-sm text-muted-foreground">Only developers and platform admins can manage business accounts.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2"><Building2 className="h-7 w-7" /> Business accounts</h1>
        <p className="text-muted-foreground">Create a business and its first admin. That admin then adds their own staff.</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New business</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Business name</Label><Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} required /></div>
            <div className="space-y-2"><Label>Owner full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
            <div className="space-y-2"><Label>Owner email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div className="space-y-2"><Label>Owner phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-2"><Label>Temporary password</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>

            {adminPayEnabled && (
              <>
                <div className="lg:col-span-3 border-t pt-4 flex items-center gap-3">
                  <Switch checked={form.payment_enabled} onCheckedChange={(v) => setForm({ ...form, payment_enabled: v })} />
                  <div>
                    <Label className="cursor-pointer">Enable subscription payment for this business</Label>
                    <p className="text-xs text-muted-foreground">When enabled, this business must pay a monthly subscription. You (platform admin) approve each payment.</p>
                  </div>
                </div>
                {form.payment_enabled && (
                  <>
                    <div className="space-y-2"><Label>Monthly amount</Label><Input type="number" min={0} value={form.monthly_amount} onChange={(e) => setForm({ ...form, monthly_amount: Number(e.target.value) })} required /></div>
                    <div className="space-y-2">
                      <Label>Initial months paid</Label>
                      <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.initial_months} onChange={(e) => setForm({ ...form, initial_months: Number(e.target.value) })}>
                        {[0, 1, 2, 3, 6, 9, 12].map((m) => <option key={m} value={m}>{m === 0 ? "None (start as unpaid)" : `${m} month${m > 1 ? "s" : ""}`}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex items-end lg:col-start-3">
              <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Creating…" : "Create business"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>All businesses ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-muted-foreground text-sm">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => {
                  const owner = b.owner_id ? owners[b.owner_id] : undefined;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{owner?.full_name ?? "—"}</TableCell>
                      <TableCell>{owner?.phone ?? "—"}</TableCell>
                      <TableCell>
                        {b.payment_enabled ? <Badge variant="default">{new Intl.NumberFormat().format(Number(b.monthly_amount))}/mo</Badge> : <Badge variant="secondary">Free</Badge>}
                      </TableCell>
                      <TableCell>
                        {b.is_active ? <Badge variant="default">Active</Badge> : <Badge variant="destructive">Deactivated</Badge>}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {b.payment_enabled && adminPayEnabled && (
                          <Button asChild size="sm" variant="outline"><Link to={`/admin/businesses/${b.id}/billing`}><CreditCard className="h-4 w-4 mr-1" />Billing</Link></Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => whatsappTo(owner?.phone ?? null)}><MessageCircle className="h-4 w-4" /></Button>
                        <Button size="sm" variant={b.is_active ? "destructive" : "default"} onClick={() => toggleActive(b)}><Power className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No businesses yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Businesses;
