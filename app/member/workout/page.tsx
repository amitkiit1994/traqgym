import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyWorkout } from "@/lib/actions/member-workout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dumbbell } from "lucide-react";

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default async function MemberWorkoutPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const workout = await getMyWorkout();

  if (!workout) {
    return (
      <div className="space-y-4 md:space-y-6 p-3 md:p-6">
        <h1 className="text-2xl font-bold">Workout Plan</h1>
        <div className="flex flex-col items-center py-12 text-center">
          <Dumbbell className="size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            No workout plan assigned yet
          </p>
        </div>
      </div>
    );
  }

  const days = DAY_ORDER.filter((d) => workout.exercisesByDay[d]);

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workout Plan</h1>
        <Badge variant="outline">{workout.planName}</Badge>
      </div>

      {workout.description && (
        <p className="text-sm text-muted-foreground">{workout.description}</p>
      )}

      <div className="space-y-4">
        {days.map((day) => (
          <Card key={day}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base capitalize">{day}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {workout.exercisesByDay[day].map((ex, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{ex.name}</p>
                      {ex.notes && (
                        <p className="text-xs text-muted-foreground">
                          {ex.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{ex.sets} sets</span>
                      <span>{ex.reps} reps</span>
                      {ex.weight != null && <span>{ex.weight} kg</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
