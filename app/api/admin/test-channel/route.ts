import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { send as sendWhatsApp } from "@/lib/channels/whatsapp";
import { send as sendSMS } from "@/lib/channels/sms";
import { send as sendEmail } from "@/lib/channels/email";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { channel, recipient } = await request.json();

  if (!channel || !recipient) {
    return Response.json({ error: "channel and recipient required" }, { status: 400 });
  }

  try {
    if (channel === "whatsapp") {
      const result = await sendWhatsApp({
        recipient,
        templateName: "test_message",
        variables: { memberName: "Test User", customMessage: "This is a test from TraqGym" },
      });
      return Response.json(result);
    }

    if (channel === "sms") {
      const result = await sendSMS({
        recipient,
        templateName: "test_message",
        variables: { memberName: "Test User", customMessage: "This is a test from TraqGym" },
      });
      return Response.json(result);
    }

    if (channel === "email") {
      const result = await sendEmail({
        recipient,
        subject: "TraqGym — Test Email",
        html: "<h2>Test Email</h2><p>This is a test email from TraqGym. If you received this, your email integration is working.</p>",
      });
      return Response.json(result);
    }

    return Response.json({ error: "Unknown channel" }, { status: 400 });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
