import { Agent } from "@openai/agents";
import { buildSystemPrompt, type AgentContext } from "./system-prompt";
import { dashboardTools } from "./tools/dashboard";
import { memberTools } from "./tools/members";
import { renewalTools } from "./tools/renewals";
import { attendanceTools } from "./tools/attendance";
import { freezeTools } from "./tools/freeze";
import { notificationTools } from "./tools/notifications";
import { enquiryTools } from "./tools/enquiries";
import { expenseTools } from "./tools/expenses";
import { planTools } from "./tools/plans";
import { staffTools } from "./tools/staff";
import { classTools } from "./tools/classes";
import { locationTools } from "./tools/locations";
import { announcementTools } from "./tools/announcements";
import { miscTools } from "./tools/misc";
import { compositeTools } from "./tools/composite";
import { targetTools } from "./tools/targets";
import { billingTools } from "./tools/billing";
import { trialTools } from "./tools/trials";
import { enquiryFollowupTools } from "./tools/enquiry-followups";
import { chequeTools } from "./tools/cheque";
import { anniversaryTools } from "./tools/anniversary";
import { irregularMemberTools } from "./tools/irregular-members";
import { ptReportTools } from "./tools/pt-report";
import { leadPipelineTools } from "./tools/lead-pipeline";
import { posTools } from "./tools/pos";
import { facilityBookingTools } from "./tools/facility-booking";
import { workoutDietTools } from "./tools/workout-diet";
import { giftCardTools } from "./tools/gift-cards";
import { waiverTools } from "./tools/waivers";
import { razorpayTools } from "./tools/razorpay";
import { payrollTools } from "./tools/payroll";
import { familyTools } from "./tools/family";
import { reportsExtendedTools } from "./tools/reports-extended";
import { milestoneTools } from "./tools/milestones";
import { churnTools } from "./tools/churn";
import { coldLeadTools } from "./tools/cold-leads";
import { dailyActionTools } from "./tools/daily-actions";
import { searchTools } from "./tools/search";
import { inAppReadTools } from "./tools/in-app-read";
import { invoiceLookupTools } from "./tools/invoice-lookup";
import { memberStatsTools } from "./tools/member-stats";
import { biometricReadTools } from "./tools/biometric-read";
import { settingsWriteTools } from "./tools/settings-write";
import { biometricWriteTools } from "./tools/biometric-write";
import { inAppWriteTools } from "./tools/in-app-write";
import { lockerTools } from "./tools/lockers";
import { extensionTools } from "./tools/extension";
import { feedbackTools } from "./tools/feedback";
import { appointmentTools } from "./tools/appointments";
import { compTools } from "./tools/comp-tools";
import { insightTools } from "./tools/insights";

// Tools that require admin role — tool executor will deny access for staff
const ADMIN_ONLY_TOOLS = new Set([
  "get_profit_loss",
  "get_expense_summary",
  "get_expenses",
  "create_expense",
  "update_expense",
  "get_collection_report",
  "get_workers",
  "create_worker",
  "update_worker",
  "toggle_worker_active",
  "reset_worker_password",
  "get_settings",
  "get_audit_logs",
  "get_staff_performance",
  "transfer_member",
  "set_gym_target",
  "create_payment_followup",
  "assign_payment_followup",
  "get_tax_settings",
  "create_trial_membership",
  "convert_trial",
  "update_cheque_status",
  "move_lead_stage",
  "sell_product",
  "restock_product",
  "create_workout_plan",
  "create_diet_plan",
  "calculate_payroll",
  "process_payroll",
  "create_gift_card",
  "create_family_group",
  "get_login_history",
  "get_membership_matrix",
  "get_source_analysis",
  "set_setting",
  "resolve_biometric_mapping",
  "notify_user",
  "notify_worker",
  "assign_locker",
  "release_locker",
  "create_locker",
  "extend_membership",
  "book_appointment",
  "cancel_appointment",
  "get_attendance_patterns",
  "suggest_schedule",
  // Comp / comp-pass mutations — admin-only (server actions also enforce).
  "issue_comp_pass",
  "revoke_comp_pass",
  "convert_comp_pass",
  "issue_comp",
  "revoke_comp",
  "convert_comp",
]);

const allTools = [
  ...dashboardTools,
  ...memberTools,
  ...renewalTools,
  ...attendanceTools,
  ...freezeTools,
  ...notificationTools,
  ...enquiryTools,
  ...expenseTools,
  ...planTools,
  ...staffTools,
  ...classTools,
  ...locationTools,
  ...announcementTools,
  ...miscTools,
  ...compositeTools,
  ...targetTools,
  ...billingTools,
  ...trialTools,
  ...enquiryFollowupTools,
  ...chequeTools,
  ...anniversaryTools,
  ...irregularMemberTools,
  ...ptReportTools,
  ...leadPipelineTools,
  ...posTools,
  ...facilityBookingTools,
  ...workoutDietTools,
  ...giftCardTools,
  ...waiverTools,
  ...razorpayTools,
  ...payrollTools,
  ...familyTools,
  ...reportsExtendedTools,
  ...milestoneTools,
  ...churnTools,
  ...coldLeadTools,
  ...dailyActionTools,
  ...searchTools,
  ...inAppReadTools,
  ...invoiceLookupTools,
  ...memberStatsTools,
  ...biometricReadTools,
  ...settingsWriteTools,
  ...biometricWriteTools,
  ...inAppWriteTools,
  ...lockerTools,
  ...feedbackTools,
  ...extensionTools,
  ...appointmentTools,
  ...compTools,
  ...insightTools,
];

export { allTools };

export function createGymAgent(context: AgentContext) {
  // Filter tools based on role — staff can't see admin-only tools
  const tools =
    context.role === "admin"
      ? allTools
      : allTools.filter((t) => !ADMIN_ONLY_TOOLS.has(t.name));

  return new Agent({
    name: "TraqGym AI",
    model: "gpt-5.4",
    instructions: buildSystemPrompt(context),
    tools,
  });
}
