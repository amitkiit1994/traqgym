import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMeasurements } from "@/lib/actions/measurements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LogMeasurementForm } from "./log-form";
import { WeightChart } from "./weight-chart";

function getBmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: "Underweight", color: "text-status-expiring" };
  if (bmi < 25) return { label: "Normal", color: "text-status-active" };
  if (bmi < 30) return { label: "Overweight", color: "text-status-grace" };
  return { label: "Obese", color: "text-status-expired" };
}

export default async function MemberMeasurementsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);
  const measurements = await getMeasurements(userId);

  const last5 = measurements.slice(0, 5);
  const latestBmi = measurements.find((m) => m.bmi !== null);

  // Chart data (chronological order, last 20 entries)
  const chartData = [...measurements]
    .reverse()
    .slice(-20)
    .filter((m) => m.weight !== null)
    .map((m) => ({
      date: new Date(m.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      weight: m.weight!,
      bmi: m.bmi ?? undefined,
    }));

  function fmt(date: string) {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Body Measurements</h1>

      {/* BMI Status */}
      {latestBmi && latestBmi.bmi !== null && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Current BMI:</span>
          <span className="text-lg font-bold">{latestBmi.bmi}</span>
          <Badge variant="outline" className={getBmiCategory(latestBmi.bmi).color}>
            {getBmiCategory(latestBmi.bmi).label}
          </Badge>
        </div>
      )}

      <LogMeasurementForm userId={userId} />

      {/* Weight/BMI Trend Chart */}
      {chartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Weight Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <WeightChart data={chartData} />
          </CardContent>
        </Card>
      )}

      {/* Weight Trend (text) */}
      {last5.filter((m) => m.weight !== null).length > 0 && chartData.length < 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Weight Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {last5
                .filter((m) => m.weight !== null)
                .map((m, idx, arr) => {
                  let arrow = "";
                  if (idx < arr.length - 1 && arr[idx + 1].weight !== null) {
                    const diff = m.weight! - arr[idx + 1].weight!;
                    if (diff > 0) arrow = " (+)";
                    else if (diff < 0) arrow = " (-)";
                    else arrow = " (=)";
                  }
                  return (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <span>{fmt(m.date)}</span>
                      <span className="font-medium">{m.weight} kg{arrow}</span>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Records */}
      <Card>
        <CardHeader>
          <CardTitle>All Records</CardTitle>
        </CardHeader>
        <CardContent>
          {measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No measurements recorded yet</p>
          ) : (
            <div className="space-y-4">
              {measurements.map((m) => (
                <div key={m.id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{fmt(m.date)}</p>
                    {m.bmi !== null && (
                      <Badge variant="outline" className={`text-xs ${getBmiCategory(m.bmi).color}`}>
                        BMI {m.bmi} — {getBmiCategory(m.bmi).label}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1 text-sm text-muted-foreground">
                    {m.weight !== null && <span>Weight: {m.weight} kg</span>}
                    {m.height !== null && <span>Height: {m.height} cm</span>}
                    {m.chest !== null && <span>Chest: {m.chest} cm</span>}
                    {m.waist !== null && <span>Waist: {m.waist} cm</span>}
                    {m.hips !== null && <span>Hips: {m.hips} cm</span>}
                    {m.biceps !== null && <span>Biceps: {m.biceps} cm</span>}
                  </div>
                  {m.notes && (
                    <p className="text-xs text-muted-foreground mt-1">{m.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
