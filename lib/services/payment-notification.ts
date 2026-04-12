import { dispatch, markSent, markFailed } from "./notification";
import { getSetting } from "./settings";
import * as whatsapp from "@/lib/channels/whatsapp";
import * as sms from "@/lib/channels/sms";
import * as email from "@/lib/channels/email";
import { todayIST } from "@/lib/utils/date";

/**
 * Send post-payment notifications (WhatsApp/SMS/Email) after renewal or plan change.
 * Respects the `notification_channel` setting. Always non-blocking.
 */
export async function sendPaymentNotification(params: {
  userId: number;
  phone: string | null;
  emailAddress: string | null;
  memberName: string;
  planName: string;
  amount: number;
  newExpiryDate: Date;
  invoiceId: number;
  invoiceNumber: string;
  action: "renewal" | "plan_change";
}) {
  const today = todayIST();
  const channel = await getSetting("notification_channel", "whatsapp");

  const variables = {
    memberName: params.memberName,
    planName: params.planName,
    amount: `₹${params.amount}`,
    newExpiry: params.newExpiryDate.toLocaleDateString("en-IN"),
    invoiceNumber: params.invoiceNumber,
    invoiceUrl: `${process.env.NEXTAUTH_URL}/api/invoices/${params.invoiceId}/pdf`,
  };

  const templateBase = params.action === "renewal" ? "renewal_confirmation" : "plan_change_confirmation";

  // WhatsApp
  if (params.phone && (channel === "whatsapp" || channel === "both")) {
    try {
      const notif = await dispatch({
        userId: params.userId,
        templateName: templateBase,
        channel: "whatsapp",
        recipient: params.phone,
        deliveryDate: today,
      });
      if (!notif.skipped) {
        const result = await whatsapp.send({
          recipient: params.phone,
          templateName: templateBase,
          variables,
        });
        if (result.success) await markSent(notif.id);
        else await markFailed(notif.id, result.error || "Send failed");
      }
    } catch (err) {
      console.error(`[PaymentNotif] WhatsApp failed:`, err);
    }
  }

  // SMS
  if (params.phone && (channel === "sms" || channel === "both")) {
    try {
      const notif = await dispatch({
        userId: params.userId,
        templateName: `${templateBase}_sms`,
        channel: "sms",
        recipient: params.phone,
        deliveryDate: today,
      });
      if (!notif.skipped) {
        const result = await sms.send({
          recipient: params.phone,
          templateName: `${templateBase}_sms`,
          variables,
        });
        if (result.success) await markSent(notif.id);
        else await markFailed(notif.id, result.error || "Send failed");
      }
    } catch (err) {
      console.error(`[PaymentNotif] SMS failed:`, err);
    }
  }

  // Email receipt (always sent if email is available, independent of channel setting)
  if (params.emailAddress) {
    try {
      const notif = await dispatch({
        userId: params.userId,
        templateName: `${templateBase}_email`,
        channel: "email",
        recipient: params.emailAddress,
        deliveryDate: today,
      });
      if (!notif.skipped) {
        const gymName = await getSetting("gym_name", "TraqGym");
        const actionLabel = params.action === "renewal" ? "Membership Renewal" : "Plan Change";
        const result = await email.send({
          recipient: params.emailAddress,
          subject: `${gymName} — ${actionLabel} Receipt (${params.invoiceNumber})`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2 style="color: #16a34a;">${gymName}</h2>
              <p>Hi ${params.memberName},</p>
              <p>Your ${actionLabel.toLowerCase()} has been processed successfully.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px 0; color: #666;">Plan</td><td style="padding: 8px 0; font-weight: 600;">${params.planName}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;">Amount Paid</td><td style="padding: 8px 0; font-weight: 600;">${variables.amount}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;">Valid Until</td><td style="padding: 8px 0; font-weight: 600;">${variables.newExpiry}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;">Invoice</td><td style="padding: 8px 0; font-weight: 600;">${params.invoiceNumber}</td></tr>
              </table>
              <p><a href="${variables.invoiceUrl}" style="display: inline-block; padding: 10px 20px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px;">View Invoice</a></p>
              <p style="color: #999; font-size: 12px; margin-top: 24px;">This is an automated receipt from ${gymName}.</p>
            </div>
          `,
        });
        if (result.success) await markSent(notif.id);
        else await markFailed(notif.id, result.error || "Send failed");
      }
    } catch (err) {
      console.error(`[PaymentNotif] Email failed:`, err);
    }
  }
}
