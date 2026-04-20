import { redirect } from "next/navigation";

// /member/dashboard is an alias for /member (the member home).
// Server-side redirect (HTTP 307) keeps this lightweight — no duplicated UI.
export default function MemberDashboardAliasPage() {
  redirect("/member");
}
