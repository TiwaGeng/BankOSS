import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CreditCard, Upload, RefreshCw, Lock } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

interface PaymentRow {
  id: string; amount: number; months_requested: number | null; months_granted: number;
  status: string; proof_url: string | null; note: string | null; paid_at: string; created_at: string;
}

const Subscription = () => {
  const { user, businessId, isPlatformAdmin } = useAuth();
  const sub = useSubscription();
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sub.status === "loading") return;
    if (sub.applies && sub.monthly_amount && !amount) setAmount(String(sub.monthly_amount * months));
  }, [sub.monthly_amount, sub.applies, sub.status, months, amount]);

  const load = async () => {
    if (!user) return;
    let q = supabase.from("subscription_payments").select("*").order("created_at", { ascending: false });
    if (sub.business_id) q = q.eq("business_id", sub.business_id);
    else q = q.eq("admin_user_id", user.id).is("business_id", null);
    const { data } = await q;
    setRows((data ?? []) as PaymentRow[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, sub.business_id, sub.applies]);

  if (sub.status === "loading") return <p className="text-muted-foreground">Loading…</p>;

  if (!sub.applies) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <Card><CardContent className="p-8 text-center space-y-3">
          <Lock className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">Subscription not required</h2>
          <p className="text-sm text-muted-foreground">Your account is not enabled for paid subscription.</p>
        </CardContent></Card>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    setBusy(true);
    try {
      let proofUrl: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("subscription-proofs").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        proofUrl = path;
      }
      const { error } = await supabase.from("subscription_payments").insert({
        admin_user_id: user.id, amount: amt, months_requested: months, months_granted: 0,
        status: "pending", proof_url: proofUrl, note: note || null,
        business_id: sub.business_id ?? (isPlatformAdmin ? null : businessId),
      });
      if (error) throw error;
      toast.success("Payment submitted — waiting for approval");
      // Notify platform admin via WhatsApp
      if (sub.business_id) {
        const { data: biz } = await supabase.from("businesses").select("name, created_by").eq("id", sub.business_id).maybeSingle();
        if (biz?.created_by) {
          const { data: adminProf } = await supabase.from("profiles").select("phone").eq("id", biz.created_by).maybeSingle();
          if (adminProf?.phone) {
            const digits = adminProf.phone.replace(/[^\d]/g, "").replace(/^0+/, "");
            const msg = encodeURIComponent(`Hi, ${biz.name} has submitted a subscription payment of ${amt} for ${months} month(s). Please review it in the billing page.`);
            window.open(`https://wa.me/${digits}?text=${msg}`, "_blank");
          }
        }
      }
      setNote(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
      await load();

    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  const statusLabel = sub.status === "active" ? "Active" : sub.status === "grace" ? "In 5-day grace" : sub.status === "expired" ? "Expired" : "Inactive";
  const statusVariant = sub.status === "active" ? "default" : sub.status === "grace" ? "secondary" : "destructive";

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2"><CreditCard className="h-7 w-7" /> Subscription</h1>
        <p className="text-muted-foreground">Manage your BankOS subscription and upload payment proof.</p>
      </header>

      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Current status</CardTitle>
          <Button variant="ghost" size="sm" onClick={sub.refresh}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-4"><p className="text-muted-foreground">Status</p><p className="font-semibold text-lg mt-1"><Badge variant={statusVariant as any}>{statusLabel}</Badge></p></div>
            <div className="rounded-lg border p-4"><p className="text-muted-foreground">Monthly amount</p><p className="font-semibold text-lg mt-1">{fmt(sub.monthly_amount)}</p></div>
            <div className="rounded-lg border p-4"><p className="text-muted-foreground">Current period ends</p><p className="font-semibold text-lg mt-1">{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "—"}</p></div>
            <div className="rounded-lg border p-4"><p className="text-muted-foreground">Days remaining (incl. grace)</p><p className="font-semibold text-lg mt-1">{sub.days_left}</p></div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle>Submit a payment</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Number of months</Label>
              <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={months} onChange={(e) => { const m = Number(e.target.value); setMonths(m); setAmount(String(sub.monthly_amount * m)); }}>
                {[1, 2, 3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div><Label>Amount paid</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="sm:col-span-2"><Label>Payment proof</Label><Input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <div className="sm:col-span-2"><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="MoMo reference, sender name, etc." /></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}><Upload className="h-4 w-4 mr-2" /> {busy ? "Submitting…" : "Submit payment"}</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader><CardTitle>Payment history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Months</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No payments yet</TableCell></TableRow> : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{fmt(Number(r.amount))}</TableCell>
                  <TableCell>{r.months_requested ?? r.months_granted}</TableCell>
                  <TableCell><Badge variant={r.status === "confirmed" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Subscription;
