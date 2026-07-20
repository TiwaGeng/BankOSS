import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Users, HandCoins, AlertTriangle, Wallet, Send, Plus, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));
const today = () => new Date().toISOString().slice(0, 10);

interface Client { id: string; full_name: string; last_name: string | null; phone: string | null; }

const Dashboard = () => {
  const nav = useNavigate();
  const { businessId } = useAuth();
  const [stats, setStats] = useState({ clients: 0, activeLoans: 0, overdue: 0, collected: 0 });
  const [todayPayments, setTodayPayments] = useState(0);
  const [todayLoansOut, setTodayLoansOut] = useState(0);
  const [todayServiceFees, setTodayServiceFees] = useState(0);
  const [todayIncome, setTodayIncome] = useState(0);
  const [todayExpenses, setTodayExpenses] = useState(0);
  const [noLoanClients, setNoLoanClients] = useState<Client[]>([]);
  const [adminPhone, setAdminPhone] = useState<string>("");

  const [reportOpen, setReportOpen] = useState(false);
  const [startBal, setStartBal] = useState("");
  const [endBal, setEndBal] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const t = today();
      const [{ count: clients }, loansRes, payRes, todayLoansRes, allClientsRes, activeLoansRes, txTodayRes] = await Promise.all([
        supabase.from("clients").select("*", { count: "exact", head: true }),
        supabase.from("loans").select("status, principal"),
        supabase.from("payments").select("amount, paid_at"),
        supabase.from("loans").select("principal, service_fee, given_at").eq("given_at", t),
        supabase.from("clients").select("id, full_name, last_name, phone").order("full_name"),
        supabase.from("loans").select("client_id").in("status", ["active", "overdue", "renewed"]),
        supabase.from("transactions").select("type, amount, occurred_at").eq("occurred_at", t),
      ]);
      const loans = loansRes.data ?? [];
      const pays = payRes.data ?? [];
      setStats({
        clients: clients ?? 0,
        activeLoans: loans.filter((l) => l.status === "active").length,
        overdue: loans.filter((l) => l.status === "overdue").length,
        collected: pays.reduce((a, p) => a + Number(p.amount), 0),
      });
      const todayPay = pays.filter((p) => p.paid_at === t).reduce((a, p) => a + Number(p.amount), 0);
      const todayLoans = todayLoansRes.data ?? [];
      const loansOut = todayLoans.reduce((a, l: any) => a + Number(l.principal), 0);
      const fees = todayLoans.reduce((a, l: any) => a + Number(l.service_fee ?? 0), 0);
      const txs = (txTodayRes.data ?? []) as { type: "income" | "expense"; amount: number }[];
      const income = txs.filter((t) => t.type === "income").reduce((a, t) => a + Number(t.amount), 0);
      const expenses = txs.filter((t) => t.type === "expense").reduce((a, t) => a + Number(t.amount), 0);
      setTodayPayments(todayPay);
      setTodayLoansOut(loansOut);
      setTodayServiceFees(fees);
      setTodayIncome(income);
      setTodayExpenses(expenses);

      const withLoans = new Set((activeLoansRes.data ?? []).map((l: { client_id: string }) => l.client_id));
      setNoLoanClients(((allClientsRes.data ?? []) as Client[]).filter((c) => !withLoans.has(c.id)));

      // Admin phone lookup for WhatsApp report (business owner)
      if (businessId) {
        const { data: biz } = await supabase.from("businesses").select("owner_id, created_by").eq("id", businessId).maybeSingle();
        const ownerId = biz?.owner_id ?? biz?.created_by;
        if (ownerId) {
          const { data: prof } = await supabase.from("profiles").select("phone").eq("id", ownerId).maybeSingle();
          if (prof?.phone) setAdminPhone(prof.phone);
        }
      }
    })();
  }, [businessId]);

  // Cash at hand = client payments + service fees collected + manual income − loans disbursed − expenses
  const cashAtHand = useMemo(
    () => todayPayments + todayServiceFees + todayIncome - todayLoansOut - todayExpenses,
    [todayPayments, todayServiceFees, todayIncome, todayLoansOut, todayExpenses],
  );

  const cards = [
    { label: "Total Clients", value: fmt(stats.clients), icon: Users },
    { label: "Active Loans", value: fmt(stats.activeLoans), icon: HandCoins },
    { label: "Overdue", value: fmt(stats.overdue), icon: AlertTriangle },
    { label: "Collected (all)", value: fmt(stats.collected), icon: Wallet },
  ];

  const buildReport = () => {
    return [
      `📊 Daily Report — ${today()}`,
      ``,
      `Starting balance: ${fmt(Number(startBal) || 0)}`,
      `Ending balance:   ${fmt(Number(endBal) || 0)}`,
      ``,
      `Loans given to clients: ${fmt(todayLoansOut)}`,
      `Payments from clients:  ${fmt(todayPayments)}`,
      `Service / charge fees:  ${fmt(todayServiceFees)}`,
      `Other income:           ${fmt(todayIncome)}`,
      `Expenses:               ${fmt(todayExpenses)}`,
      ``,
      `💰 Cash in:   ${fmt(todayPayments + todayServiceFees + todayIncome)}`,
      `💸 Cash out:  ${fmt(todayLoansOut + todayExpenses)}`,
      `🏦 Cash at hand: ${fmt(cashAtHand)}`,
    ].join("\n");
  };

  const sendReport = async () => {
    setSending(true);
    const text = buildReport();
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    // sanitize phone for wa.me (digits only, drop leading 00 / +)
    const digits = adminPhone.replace(/[^\d]/g, "").replace(/^0+/, "");
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    toast.success(adminPhone ? `Report opened to admin (${adminPhone})` : "Report ready — pick a contact in WhatsApp");
    setSending(false);
    setReportOpen(false);
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Snapshot of your business today</p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="shadow-soft">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm text-muted-foreground font-medium">{label}</CardTitle>
              <Icon className="h-5 w-5 text-gold" />
            </CardHeader>
            <CardContent><p className="font-display text-3xl font-bold">{value}</p></CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => nav("/clients/book")}>
          <BookOpen className="h-4 w-4 mr-2" /> Client book
        </Button>
      </div>

      {/* Today summary + send report */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Today — {today()}</CardTitle>
          <Button onClick={() => setReportOpen(true)} className="animate-pulse">
            <Send className="h-4 w-4 mr-2" /> Send report
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Loans given (cash out)</p>
              <p className="font-display text-2xl font-bold">{fmt(todayLoansOut)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Payments received</p>
              <p className="font-display text-2xl font-bold">{fmt(todayPayments)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Service / charge fees</p>
              <p className="font-display text-2xl font-bold">{fmt(todayServiceFees)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Income added</p>
              <p className="font-display text-2xl font-bold">{fmt(todayIncome)}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Expenses</p>
              <p className="font-display text-2xl font-bold">{fmt(todayExpenses)}</p>
            </div>
            <div className="rounded-lg border bg-primary/10 p-4">
              <p className="text-sm text-muted-foreground">Cash at hand (remaining in office)</p>
              <p className="font-display text-2xl font-bold">{fmt(cashAtHand)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clients without loans */}
      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Clients without active loans ({noLoanClients.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/2">Client</TableHead>
                  <TableHead className="w-1/3">Phone</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {noLoanClients.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">All clients currently have a loan</TableCell></TableRow>
                ) : noLoanClients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium truncate">{c.full_name}{c.last_name ? ` ${c.last_name}` : ""}</TableCell>
                    <TableCell className="truncate">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => nav(`/loans/new?client=${c.id}`)}>
                        <Plus className="h-4 w-4 mr-1" /> Give loan
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send daily report to admin</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {adminPhone ? (
              <p className="text-sm text-muted-foreground">
                Will open WhatsApp to admin: <strong>{adminPhone}</strong>
              </p>
            ) : (
              <p className="text-sm text-destructive">Admin phone number is not set on their profile — WhatsApp will open with no recipient.</p>
            )}
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Loans given</span><strong>{fmt(todayLoansOut)}</strong></div>
              <div className="flex justify-between"><span>Payments received</span><strong>{fmt(todayPayments)}</strong></div>
              <div className="flex justify-between"><span>Service fees</span><strong>{fmt(todayServiceFees)}</strong></div>
              <div className="flex justify-between"><span>Income</span><strong>{fmt(todayIncome)}</strong></div>
              <div className="flex justify-between"><span>Expenses</span><strong>{fmt(todayExpenses)}</strong></div>
              <div className="flex justify-between border-t pt-1 mt-1"><span>Cash at hand</span><strong>{fmt(cashAtHand)}</strong></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Starting balance</Label><Input type="number" value={startBal} onChange={(e) => setStartBal(e.target.value)} placeholder="0" /></div>
              <div><Label>Ending balance</Label><Input type="number" value={endBal} onChange={(e) => setEndBal(e.target.value)} placeholder="0" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button onClick={sendReport} disabled={sending}>
              <Send className="h-4 w-4 mr-2" /> {sending ? "Sending…" : "Send via WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
