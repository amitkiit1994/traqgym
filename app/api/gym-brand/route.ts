import { NextResponse } from "next/server";
import { getSetting } from "@/lib/services/settings";

export async function GET() {
  const name = await getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym");
  const logo = await getSetting("gym_logo", "");
  return NextResponse.json({ name, logo });
}
