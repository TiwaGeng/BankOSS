import { useEffect, useState } from "react";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Client { id: string; full_name: string; last_name: string | null; phone: string | null; }

const schema = z.object({
  client_id: z.string().uuid(),
  principal: z.coerce.number().positive().max(1e10),
  interest_rate: z.coerce.number().min(0).max(100),
  term_months: z.coerce.number().int().min(1).max(360),
});

const GiveLoan = () => {
  const { user, hasRole } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(params.get("client") ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [principal, setPrincipal] = useState<number>(0);
  const SERVICE_FEE = 10000;
  const [rate, setRate] = useState<string>("15");
  const [months, setMonths] = useState<number>(1);
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");
  const [activeClientIds, setActiveClientIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from("clients").select("id, full_name, last_name, phone").order("full_name").then(({ data }) => setClients((data ?? []) as Client[]));
    supabase.from("loans").select("client_id").in("status", ["active", "overdue"]).then(({ data }) => {
      setActiveClientIds(new Set((data ?? []).map((l: { client_id: string }) => l.client_id)));
    });
  }, []);

  if (!hasRole(["admin", "loan_officer", "accountant"])) return <p className="text-muted-foreground">You don't have permission to give loans.</p>;

  const totalPayable = principal * (1 + Number(rate) / 100);
  const clientReceives = Math.max(0, principal - SERVICE_FEE);
  const days = months * 30;
  const weeks = months * 4;
  const perDay = days > 0 ? totalPayable / days : 0;
  const perWeek = weeks > 0 ? totalPayable / weeks : 0;
  const selected = clients.find((c) => c.id === clientId);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = schema.safeParse({ client_id: clientId, principal, interest_rate: Number(rate), term_months: months });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    if (parsed.data.principal <= SERVICE_FEE) {
      return toast.error(`Principal must be greater than the service fee (${SERVICE_FEE.toLocaleString()} Frw)`);
    }
    if (activeClientIds.has(parsed.data.client_id)) {
      return toast.error("This client already has an active loan. Renew the existing loan instead.");
    }
    const due = new Date(); due.setMonth(due.getMonth() + parsed.data.term_months);
    const noteParts = [
      `schedule:${schedule}`,
      schedule === "daily" ? `per_day:${perDay.toFixed(2)}` : `per_week:${perWeek.toFixed(2)}`,
      `total_payable:${totalPayable.toFixed(2)}`,
      `service_fee:${SERVICE_FEE}`,
      `client_received:${clientReceives.toFixed(2)}`,
    ];
    const { error } = await supabase.from("loans").insert({
      ...parsed.data,
      service_fee: SERVICE_FEE,
      status: "active" as const,
      given_at: new Date().toISOString().slice(0, 10),
      due_at: due.toISOString().slice(0, 10),
      notes: noteParts.join(" | "),
      created_by: user!.id,
    } as never);
    if (error) return toast.error(error.message);
    toast.success("Loan created");
    nav("/loans");
  };

  const eligible = clients.filter((c) => !activeClientIds.has(c.id));

  return (
    <div className="space-y-6 grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Give Loan</h1>
        <p className="text-muted-foreground">Issue a new loan to a client</p>
      </header>
      <Card className="shadow-soft">
        <CardHeader><CardTitle>Loan details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label>Pick client</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between">
                    {selected ? `${selected.full_name}${selected.last_name ? " " + selected.last_name : ""}${selected.phone ? " · " + selected.phone : ""}` : "Search and pick a client…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type a name or phone…" />
                    <CommandList>
                      <CommandEmpty>No client found.</CommandEmpty>
                      <CommandGroup>
                        {clients.map((c) => {
                          const label = `${c.full_name}${c.last_name ? " " + c.last_name : ""}${c.phone ? " · " + c.phone : ""}`;
                          return (
                            <CommandItem key={c.id} value={label} onSelect={() => { setClientId(c.id); setPickerOpen(false); }}>
                              <Check className={cn("mr-2 h-4 w-4", clientId === c.id ? "opacity-100" : "opacity-0")} />
                              {label}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Principal</Label>
                <Input type="number" step="0.01" required value={principal || ""} onChange={(e) => setPrincipal(Number(e.target.value))} />
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
              <div>
                <Label>Months</Label>
                <Input type="number" min={1} value={months} onChange={(e) => setMonths(Number(e.target.value))} required />
              </div>
            </div>
            <div>
              <Label>Payment schedule</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" variant={schedule === "daily" ? "default" : "outline"} onClick={() => setSchedule("daily")}>Every day</Button>
                <Button type="button" variant={schedule === "weekly" ? "default" : "outline"} onClick={() => setSchedule("weekly")}>Every week</Button>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Service fee (kept at office)</span><strong>{SERVICE_FEE.toLocaleString()}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Client receives</span><strong>{clientReceives.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total payable</span><strong>{totalPayable.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              {schedule === "daily" ? (
                <div className="flex justify-between"><span className="text-muted-foreground">Amount to pay every day ({days} days)</span><strong>{perDay.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">Amount to pay every week ({weeks} weeks)</span><strong>{perWeek.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
              )}
            </div>
            <Button type="submit">Save Loan</Button>
          </form>
        </CardContent>
      </Card>
      </div>

      <Card className="shadow-soft">
        <CardHeader><CardTitle>Eligible clients ({eligible.length})</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">Scroll and pick — no active loan</p>
          <div className="max-h-[480px] overflow-auto rounded-md border divide-y">
            {eligible.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">No eligible clients</p>
            ) : eligible.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClientId(c.id)}
                className={cn(
                  "w-full text-left p-3 hover:bg-muted/60 transition-colors flex items-center justify-between gap-2",
                  clientId === c.id && "bg-primary/10"
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.full_name}{c.last_name ? ` ${c.last_name}` : ""}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.phone ?? "—"}</p>
                </div>
                {clientId === c.id ? <Check className="h-4 w-4 text-primary shrink-0" /> : <span className="text-xs font-medium text-primary shrink-0">Give loan</span>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GiveLoan;