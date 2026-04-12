import nodemailer from "nodemailer";
import { getSetting } from "@/lib/services/settings";

export async function send(params: {
  recipient: string;
  subject: string;
  html: string;
}) {
  const host = (await getSetting("smtp_host", "")) || process.env.SMTP_HOST;
  const port = parseInt((await getSetting("smtp_port", "")) || (process.env.SMTP_PORT ?? "587"), 10);
  const user = (await getSetting("smtp_user", "")) || process.env.SMTP_USER;
  const pass = (await getSetting("smtp_pass", "")) || process.env.SMTP_PASS;
  const from = (await getSetting("smtp_from", "")) || process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    console.log(
      `[Email DEV] "${params.subject}" to ${params.recipient}`,
      params.html.slice(0, 200)
    );
    return { success: true, channel: "email", mode: "dev" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: params.recipient,
      subject: params.subject,
      html: params.html,
    });

    return { success: true, channel: "email", mode: "live" };
  } catch (err) {
    console.error("[Email] Error:", err);
    return { success: false, channel: "email", error: String(err) };
  }
}
