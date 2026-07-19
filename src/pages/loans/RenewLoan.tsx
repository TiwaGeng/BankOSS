import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Loan { id: string; principal: number; term_months: number; interest_rate: number; fine: number; client_id: string; notes: string | null; created_at: string; clients?: { full_name: string } | null; }

const parsePerPeriod = (notes: string | null): { schedule: "daily" | "weekly"; amount: number } | null => {
  if (!notes) return null;
  const sch = /schedule:(daily|weekly)/.exec(notes)?.[1] as "daily" | "weekly" | undefined;
  const m = /per_(day|week):([0-9.]+)/.exec(notes);
  if (!sch || !m) return null;
  return { schedule: sch, amount: Number(m[2]) };
};

const RenewLoan = () => {
  const { user, hasRole } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanId, setLoanId] = useState("");
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<number>(1);
  const [rate, setRate] = useState<string>("15");
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");
  const [paidMap, setPaidMap] = useState<Record<string, number>>({});

  const load = async () => {
    const { data } = await supabase
      .from("loans")
      .select("id, principal, term_months, interest_rate, fine, client_id, notes, created_at, clients(full_name)")
      .in("status", ["active", "overdue"])
      .order("created_at", { ascending: false });
    const all = (data ?? []) as Loan[];
    setLoans(all);
    const ids = all.map((l) => l.id);
    if (ids.length) {
      const { data: pays } = await supabase.from("payments").select("loan_id, amount").in("loan_id", ids);
      const m: Record<string, number> = {};
      (pays ?? []).forEach((p) => { m[p.loan_id] = (m[p.loan_id] || 0) + Number(p.amount); });
      setPaidMap(m);
    } else setPaidMap({});
  };
  useEffect(() => { load(); }, []);

  const remainingFor = useMemo(() => (l: Loan) => {
    const total = Number(l.principal) * (1 + Number(l.interest_rate || 0) / 100) + Number(l.fine || 0);
    return Math.max(0, total - (paidMap[l.id] || 0));
  }, [paidMap]);

  if (!hasRole(["admin", "loan_officer"])) return <p className="text-muted-foreground">You don't have permission to renew loans.</p>;

  const selected = loans.find((l) => l.id === loanId);
  const selectedPaid = selected ? (paidMap[selected.id] || 0) : 0;
  const selectedRemaining = selected ? remainingFor(selected) : 0;
  const selectedPP = selected ? parsePerPeriod(selected.notes) : null;
  const selectedTotal = selected ? Number(selected.principal) * (1 + Number(selected.interest_rate || 0) / 100) + Number(selected.fine || 0) : 0;
  const paidPct = selectedTotal > 0 ? (selectedPaid / selectedTotal) * 100 : 0;
  const canRenew = paidPct >= 80;

  const newPrincipal = selected ? Number(selected.principal) : 0;
  const interestOnly = newPrincipal * (Number(rate) / 100);
  const newTotalPayable = newPrincipal + interestOnly + selectedRemaining;
  const days = months * 30;
  const weeks = months * 4;
  const newPerDay = days > 0 ? newTotalPayable / days : 0;
  const newPerWeek = weeks > 0 ? newTotalPayable / weeks : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return toast.error("Pick a loan");
    if (!canRenew) return toast.error(`Client must pay at least 80% of current loan. Currently paid: ${paidPct.toFixed(1)}%`);
    const due = new Date(); due.setMonth(due.getMonth() + months);
    const noteParts = [
      `schedule:${schedule}`,
      schedule === "daily" ? `per_day:${newPerDay.toFixed(2)}` : `per_week:${newPerWeek.toFixed(2)}`,
      `total_payable:${newTotalPayable.toFixed(2)}`,
      `Renewed from loan ${selected.id} — carried unpaid ${selectedRemaining.toFixed(2)} added after ${rate}% on ${newPrincipal.toFixed(2)}`,
    ];
    const { error: e1 } = await supabase.from("loans").update({ status: "renewed" as const }).eq("id", selected.id);
    if (e1) return toast.error(e1.message);
    // Store the new loan with original principal so future renewals re-use it.
    // The notes field carries total_payable which Payments uses for remaining math via initial fine workaround:
    // we add the carried remaining as `fine` so that remaining = principal*(1+rate)+fine = newTotalPayable.
    const { error: e2 } = await supabase.from("loans").insert({
      client_id: selected.client_id,
      principal: newPrincipal,
      interest_rate: Number(rate),
      term_months: months,
      fine: selectedRemaining,
      status: "active" as const,
      given_at: new Date().toISOString().slice(0, 10),
      due_at: due.toISOString().slice(0, 10),
      notes: noteParts.join(" | "),
      created_by: user!.id,
    } as never);
    if (e2) return toast.error(e2.message);
    toast.success("Loan renewed");
    setLoanId(""); load();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="font-display text-3xl font-bold">Renew Loan</h1>
        <p className="text-muted-foreground">Tax is calculated on the original principal first, then the unpaid balance is added.</p>
      </header>
      <Card className="shadow-soft">
        <CardHeader><CardTitle>Renewal</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Active / Overdue Loan (search by client name)</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {selected
                      ? `${selected.clients?.full_name} — principal ${Number(selected.principal).toLocaleString()}, remaining ${remainingFor(selected).toLocaleString()}`
                      : "Type a client name to find a loan…"}
                    <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search client…" />
                    <CommandList>
                      <CommandEmpty>No loan found.</CommandEmpty>
                      <CommandGroup>
                        {loans.map((l) => (
                          <CommandItem
                            key={l.id}
                            value={`${l.clients?.full_name ?? ""} ${l.id}`}
                            onSelect={() => { setLoanId(l.id); setOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", loanId === l.id ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1 truncate">{l.clients?.full_name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">P {Number(l.principal).toLocaleString()} · R {remainingFor(l).toLocaleString()}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selected && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <div className="font-medium mb-1">Current loan details</div>
                <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><strong>{Number(selected.principal).toLocaleString()}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Interest rate</span><strong>{selected.interest_rate}%</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid amount</span><strong>{selectedPaid.toLocaleString()}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remaining unpaid</span><strong>{selectedRemaining.toLocaleString()}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Current {selectedPP?.schedule === "weekly" ? "weekly" : "daily"} payment</span><strong>{selectedPP ? selectedPP.amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</strong></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">% paid</span><strong className={canRenew ? "text-green-600" : "text-destructive"}>{paidPct.toFixed(1)}% {canRenew ? "✓ eligible" : "(need 80%)"}</strong></div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>New Term (months)</Label>
                <Input type="number" min={1} value={months} onChange={(e) => setMonths(Number(e.target.value))} required />
              </div>
              <div>
                <Label>Interest</Label>
                <Select value={rate} onValueChange={setRate}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15%</SelectItem>
                    <SelectItem value="20">20%</SelectItem>
                    <SelectItem value="25">25%</SelectItem>
                    <SelectItem value="30">30%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Payment schedule</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" variant={schedule === "daily" ? "default" : "outline"} onClick={() => setSchedule("daily")}>Every day</Button>
                <Button type="button" variant={schedule === "weekly" ? "default" : "outline"} onClick={() => setSchedule("weekly")}>Every week</Button>
              </div>
            </div>

            {selected && (
              <div className="rounded-lg border bg-primary/5 p-3 text-sm space-y-1">
                <div className="font-medium mb-1">Renewed loan preview</div>
                <div className="flex justify-between"><span className="text-muted-foreground">New principal (same as before)</span><strong>{newPrincipal.toLocaleString()}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">+ Interest ({rate}% on principal)</span><strong>{interestOnly.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                <div className="flex justify-between"><span className="text-muted-foreground">+ Carried unpaid balance</span><strong>{selectedRemaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">New total payable</span><strong className="text-primary">{newTotalPayable.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                {schedule === "daily" ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount to pay every day ({days} days)</span><strong>{newPerDay.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount to pay every week ({weeks} weeks)</span><strong>{newPerWeek.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
                )}
              </div>
            )}

            <Button type="submit" disabled={!selected}>Renew</Button>
          </form>
        </CardContent>
      </Card>

      {loans.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold">Active loans</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {loans.map((l) => {
              const paid = paidMap[l.id] || 0;
              const remaining = remainingFor(l);
              const pp = parsePerPeriod(l.notes);
              return (
                <div key={l.id} className="rounded-lg border bg-card p-3 text-sm shadow-soft">
                  <div className="font-medium">{l.clients?.full_name} — Active Loan</div>
                  <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Principal</span><strong>{Number(l.principal).toLocaleString()}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><strong>{paid.toLocaleString()}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><strong>{remaining.toLocaleString()}</strong></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{pp?.schedule === "weekly" ? "Weekly" : "Daily"} payment</span><strong>{pp ? `${pp.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${pp.schedule === "daily" ? "day" : "wk"}` : "—"}</strong></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default RenewLoan;
