import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, HandCoins, Receipt } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

const AdminDashboard = () => {
  const [stats, setStats] = useState({ businesses: 0, clients: 0, loans: 0, payments: 0 });

  useEffect(() => {
    (async () => {
      const [b, c, l, p] = await Promise.all([
        supabase.from("businesses").select("*", { count: "exact", head: true }),
        supabase.from("clients").select("*", { count: "exact", head: true }),
        supabase.from("loans").select("*", { count: "exact", head: true }),
        supabase.from("payments").select("*", { count: "exact", head: true }),
      ]);
      setStats({ businesses: b.count ?? 0, clients: c.count ?? 0, loans: l.count ?? 0, payments: p.count ?? 0 });
    })();
  }, []);

  const cards = [
    { label: "Businesses", value: stats.businesses, icon: Building2 },
    { label: "Clients", value: stats.clients, icon: Users },
    { label: "Loans", value: stats.loans, icon: HandCoins },
    { label: "Payments", value: stats.payments, icon: Receipt },
  ];

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
              <CardContent>
                <div className="text-3xl font-bold">{fmt(c.value)}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdminDashboard;
