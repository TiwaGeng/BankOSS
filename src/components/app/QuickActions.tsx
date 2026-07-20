import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, Banknote, FileBarChart, ShieldCheck, Receipt, UserPlus, HandCoins } from "lucide-react";
import { toast } from "sonner";

type Kind = "payable" | "receivable" | "banking" | "expense";

const labels: Record<Kind, { title: string; type: "income" | "expense"; category: string }> = {
  payable: { title: "Add Payable (Money you owe / Expense)", type: "expense", category: "payable" },
  receivable: { title: "Add Receivable (Money owed to you / Income)", type: "income", category: "receivable" },
  banking: { title: "Add Banking Entry (Deposit / Withdrawal)", type: "income", category: "banking" },
  expense: { title: "Add Expense", type: "expense", category: "expense" },
};

const schema = z.object({
  amount: z.coerce.number().positive(),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

const QuickActions = () => {
  const { user, hasRole } = useAuth();
  const nav = useNavigate();
  const canPost = hasRole(["admin", "accountant"]);
  const canAddClient = hasRole(["admin", "accountant", "loan_officer"]);
  const canGiveLoan = hasRole(["admin", "loan_officer"]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [bankingType, setBankingType] = useState<"income" | "expense">("income");

  // Audit log: store as transaction with category=audit (no amount entry; use a quick view)
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRows, setAuditRows] = useState<Array<{ id: string; type: string; category: string; amount: number; description: string | null; occurred_at: string; created_at: string }>>([]);

  useEffect(() => {
    if (!auditOpen) return;
    supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => {
      setAuditRows((data ?? []) as never);
    });
  }, [auditOpen]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!kind) return;
    const fd = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = schema.safeParse(fd);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    const meta = labels[kind];
    const type = kind === "banking" ? bankingType : meta.type;
    const { error } = await supabase.from("transactions").insert({
      type, category: meta.category, amount: parsed.data.amount,
      description: parsed.data.description || null, created_by: user!.id,
    } as never);
    if (error) return toast.error(error.message);
    toast.success("Saved successfully");
    setKind(null);
  };

  const btn = "h-9 gap-1.5";
  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b">
      <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6 py-2.5">
        {canPost && <>
          <Button size="sm" variant="outline" className={btn} onClick={() => setKind("payable")}><ArrowUpCircle className="h-4 w-4" /> Add Payable</Button>
          <Button size="sm" variant="outline" className={btn} onClick={() => setKind("receivable")}><ArrowDownCircle className="h-4 w-4" /> Add Receivable</Button>
          <Button size="sm" variant="outline" className={btn} onClick={() => setKind("banking")}><Banknote className="h-4 w-4" /> Add Banking</Button>
          <Button size="sm" variant="outline" className={btn} onClick={() => setKind("expense")}><Receipt className="h-4 w-4" /> Add Expense</Button>
        </>}
        <Button size="sm" variant="outline" className={btn} onClick={() => nav("/reports/daily")}><FileBarChart className="h-4 w-4" /> Daily Report</Button>
        <Button size="sm" variant="outline" className={btn} onClick={() => setAuditOpen(true)}><ShieldCheck className="h-4 w-4" /> Audit</Button>
      </div>

      <Dialog open={!!kind} onOpenChange={(o) => !o && setKind(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{kind ? labels[kind].title : ""}</DialogTitle></DialogHeader>
          {kind && (
            <form onSubmit={submit} className="space-y-3">
              {kind === "banking" && (
                <div className="flex gap-2">
                  <Button type="button" variant={bankingType === "income" ? "default" : "outline"} size="sm" onClick={() => setBankingType("income")}>Deposit</Button>
                  <Button type="button" variant={bankingType === "expense" ? "default" : "outline"} size="sm" onClick={() => setBankingType("expense")}>Withdrawal</Button>
                </div>
              )}
              <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" required /></div>
              <div><Label>Description</Label><Input name="description" /></div>
              <Button type="submit" className="w-full">Save</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Audit — Last 100 transactions</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto text-sm">
            <table className="w-full">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-2">When</th><th className="text-left">Type</th><th className="text-left">Category</th><th className="text-right">Amount</th><th className="text-left">Description</th></tr>
              </thead>
              <tbody>
                {auditRows.length === 0 ? <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No entries</td></tr>
                  : auditRows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="capitalize">{r.type}</td>
                      <td>{r.category}</td>
                      <td className="text-right font-medium">{Number(r.amount).toLocaleString()}</td>
                      <td className="text-muted-foreground">{r.description ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuickActions;