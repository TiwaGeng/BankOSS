import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Building2 } from "lucide-react";

interface Biz { id: string; name: string; created_at: string; }

const AdminBusinessesView = () => {
  const { id } = useParams();
  const [items, setItems] = useState<Biz[]>([]);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;
      const [{ data: prof }, { data: biz }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", id).maybeSingle(),
        supabase.from("businesses").select("id, name, created_at").eq("created_by", id).order("created_at", { ascending: false }),
      ]);
      setName(prof?.full_name ?? "Admin");
      setItems((biz ?? []) as Biz[]);
    })();
  }, [id]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/developer/admins"><ArrowLeft className="h-4 w-4 mr-1" /> Back to admins</Link>
      </Button>
      <header>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-7 w-7" /> {name}'s businesses
        </h1>
        <p className="text-muted-foreground">{items.length} business account(s) created by this admin.</p>
      </header>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{new Date(b.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No businesses yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminBusinessesView;
