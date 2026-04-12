import QRCode from "qrcode";
import { generateUpiUrl } from "@/lib/services/upi-qr";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const amount = searchParams.get("amount");
  const memberName = searchParams.get("memberName");
  const invoiceNumber = searchParams.get("invoiceNumber") ?? "PENDING";

  if (!amount || !memberName) {
    return Response.json(
      { error: "amount and memberName are required" },
      { status: 400 }
    );
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  try {
    const upiUrl = await generateUpiUrl({
      amount: parsedAmount,
      memberName,
      invoiceNumber,
    });

    const svg = await QRCode.toString(upiUrl, { type: "svg", margin: 2 });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
