import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, MessageCircle } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

const BusinessBilling = () => {
  const { id } = useParams();
  const [biz, setBiz] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [sub, setSub] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    const { data: b } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
    setBiz(b);
    if (b?.owner_id) {
      const { data: p } = await supabase.from("profiles").select("full_name, phone").eq("id", b.owner_id).maybeSingle();
      setOwner(p);
    }
    const { data: s } = await supabase.from("subscriptions").select("*").eq("business_id", id).maybeSingle();
    setSub(s);
    const { data: pays } = await supabase.from("subscription_payments").select("*").eq("business_id", id).order("created_at", { ascending: false });
    setRows(pays ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const approve = async (paymentId: string) => {
    setBusy(paymentId);
    const { error } = await supabase.rpc("approve_subscription_payment", { _payment_id: paymentId });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Payment approved");
    // WhatsApp notify
    if (owner?.phone) {
      const d = owner.phone.replace(/[^\d]/g, "").replace(/^0+/, "");
      const msg = encodeURIComponent(`✅ Your subscription payment for ${biz?.name ?? "your business"} has been approved.`);
      window.open(`https://wa.me/${d}?text=${msg}`, "_blank");
    }
    load();
  };
  const reject = async (paymentId: string) => {
    const reason = prompt("Reason for rejection?") ?? "";
    setBusy(paymentId);
    const { error } = await supabase.rpc("reject_subscription_payment", { _payment_id: paymentId, _reason: reason });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Payment rejected");
    if (owner?.phone) {
      const d = owner.phone.replace(/[^\d]/g, "").replace(/^0+/, "");
      const msg = encodeURIComponent(`❌ Your subscription payment for ${biz?.name ?? "your business"} was rejected. ${reason ? `Reason: ${reason}` : ""}`);
      window.open(`https://wa.me/${d}?text=${msg}`, "_blank");
    }
    load();
  };
  const openProof = async (path: string) => {
    const { data } = await supabase.storage.from("subscription-proofs").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  if (!biz) return <div className="text-muted-foreground">Loading…</div>;

  const now = Date.now();
  const end = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
  const status = !end ? "inactive" : now <= end ? "active" : now <= end + 5 * 24 * 3600 * 1000 ? "grace" : "expired";

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Button asChild variant="ghost" size="sm"><Link to="/admin/businesses"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link></Button>
        <h1 className="font-display text-3xl font-bold mt-2">{biz.name} — Billing</h1>
        <p className="text-muted-foreground">Owner: {owner?.full_name ?? "—"} {owner?.phone && <>· {owner.phone}</>}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Status</CardTitle></CardHeader><CardContent><Badge variant={status === "active" ? "default" : status === "expired" ? "destructive" : "secondary"}>{status}</Badge></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Monthly amount</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{fmt(Number(biz.monthly_amount))}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Period ends</CardTitle></CardHeader><CardContent><p className="text-lg font-semibold">{sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Payment history</CardTitle>
          {owner?.phone && (
            <Button variant="outline" size="sm" onClick={() => {
              const d = owner.phone.replace(/[^\d]/g, "").replace(/^0+/, "");
              window.open(`https://wa.me/${d}`, "_blank");
            }}><MessageCircle className="h-4 w-4 mr-1" />Message owner</Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Months</TableHead>
              <TableHead>Status</TableHead><TableHead>Proof</TableHead><TableHead>Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No payments yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{fmt(Number(r.amount))}</TableCell>
                  <TableCell>{r.months_requested ?? r.months_granted}</TableCell>
                  <TableCell><Badge variant={r.status === "confirmed" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell>{r.proof_url ? <Button variant="link" size="sm" onClick={() => openProof(r.proof_url)}>View</Button> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.note ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {r.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => approve(r.id)} disabled={busy === r.id}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => reject(r.id)} disabled={busy === r.id}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                      </>
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

export default BusinessBilling;
