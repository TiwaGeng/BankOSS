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
import { CreditCard, Upload, RefreshCw } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

interface PaymentRow {
  id: string; amount: number; months_requested: number | null; months_granted: number;
  status: string; proof_url: string | null; note: string | null; paid_at: string; created_at: string;
}

const Subscription = () => {
  const { user, isPlatformAdmin, isBusinessUser } = useAuth();
  const sub = useSubscription();
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // If a business user (not admin), redirect back — this page is only for admins
  useEffect(() => {
    if (sub.status === "loading" || !user) return;
    if (isPlatformAdmin) {
      const suggested = sub.monthly_amount * months;
      if (!amount) setAmount(String(suggested || ""));
    }
  }, [sub.monthly_amount, months, isPlatformAdmin, user, sub.status, amount]);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("subscription_payments")
      .select("*")
      .eq("admin_user_id", user.id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as PaymentRow[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!months || months <= 0) return toast.error("Choose number of months");
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
        admin_user_id: user.id,
        amount: amt,
        months_requested: months,
        months_granted: 0,
        status: "pending",
        proof_url: proofUrl,
        note: note || null,
      });
      if (error) throw error;
      toast.success("Payment submitted — waiting for developer confirmation");
      setNote(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!isPlatformAdmin && !isBusinessUser) {
    return <p className="text-muted-foreground">Subscription is managed at the admin level.</p>;
  }

  const isAdmin = isPlatformAdmin;
  const statusLabel = sub.status === "active" ? "Active" : sub.status === "grace" ? "In 5-day grace" : sub.status === "expired" ? "Expired" : "Inactive";
  const statusVariant = sub.status === "active" ? "default" : sub.status === "grace" ? "secondary" : "destructive";

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <CreditCard className="h-7 w-7" /> Subscription
        </h1>
        <p className="text-muted-foreground">Manage your BankOS subscription and upload payment proof.</p>
      </header>

      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Current status</CardTitle>
          <Button variant="ghost" size="sm" onClick={sub.refresh}><RefreshCw className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground">Status</p>
              <p className="font-semibold text-lg mt-1"><Badge variant={statusVariant as any}>{statusLabel}</Badge></p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground">Monthly amount</p>
              <p className="font-semibold text-lg mt-1">{fmt(sub.monthly_amount)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground">Current period ends</p>
              <p className="font-semibold text-lg mt-1">{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "—"}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground">Days remaining (incl. 5-day grace)</p>
              <p className="font-semibold text-lg mt-1">{sub.days_left}</p>
            </div>
          </div>
          {sub.status === "grace" && (
            <p className="text-sm text-amber-600 mt-4">⚠️ Your subscription has ended. You have a 5-day grace period — please pay to keep access.</p>
          )}
          {sub.status === "expired" && (
            <p className="text-sm text-destructive mt-4">Your subscription has expired and the grace period is over. Pay to restore access.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="shadow-soft">
          <CardHeader><CardTitle>Submit a payment</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Number of months</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={months}
                  onChange={(e) => { const m = Number(e.target.value); setMonths(m); setAmount(String(sub.monthly_amount * m)); }}
                >
                  {[1, 2, 3, 6, 9, 12].map((m) => (
                    <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Amount paid</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <Label>Payment proof (screenshot / receipt)</Label>
                <Input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="MoMo reference, sender name, etc." />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  <Upload className="h-4 w-4 mr-2" /> {busy ? "Submitting…" : "Submit payment"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-soft">
        <CardHeader><CardTitle>Payment history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Months</TableHead>
              <TableHead>Status</TableHead><TableHead>Note</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No payments yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{fmt(Number(r.amount))}</TableCell>
                  <TableCell>{r.months_requested ?? r.months_granted}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "confirmed" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
                  </TableCell>
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
