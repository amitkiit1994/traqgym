import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyDiet } from "@/lib/actions/member-diet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Apple } from "lucide-react";

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export default async function MemberDietPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const diet = await getMyDiet();

  if (!diet) {
    return (
      <div className="space-y-4 md:space-y-6 p-3 md:p-6">
        <h1 className="text-2xl font-bold">Diet Plan</h1>
        <div className="flex flex-col items-center py-12 text-center">
          <Apple className="size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            No diet plan assigned yet
          </p>
        </div>
      </div>
    );
  }

  const mealTypes = MEAL_ORDER.filter((t) => diet.mealsByType[t]);

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Diet Plan</h1>
        <Badge variant="outline">{diet.planName}</Badge>
      </div>

      {diet.description && (
        <p className="text-sm text-muted-foreground">{diet.description}</p>
      )}

      <div className="space-y-4">
        {mealTypes.map((type) => (
          <Card key={type}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {MEAL_LABELS[type] || type}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {diet.mealsByType[type].map((meal, i) => (
                  <div
                    key={i}
                    className="border-b pb-2 last:border-0 last:pb-0"
                  >
                    <p className="font-medium">{meal.description}</p>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      {meal.calories != null && (
                        <span>{meal.calories} kcal</span>
                      )}
                      {meal.protein != null && (
                        <span>{meal.protein}g protein</span>
                      )}
                      {meal.carbs != null && (
                        <span>{meal.carbs}g carbs</span>
                      )}
                      {meal.fat != null && (
                        <span>{meal.fat}g fat</span>
                      )}
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
