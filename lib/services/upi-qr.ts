import { getSetting } from "@/lib/services/settings";

/**
 * Generate a UPI payment URL following NPCI standard format.
 */
export async function generateUpiUrl(params: {
  amount: number;
  memberName: string;
  invoiceNumber: string;
}): Promise<string> {
  const vpa = await getSetting("gym_upi_vpa", process.env.GYM_UPI_VPA || "");
  const payeeName = await getSetting("gym_name", process.env.GYM_NAME || "FreeformFitness");

  if (!vpa) {
    throw new Error("GYM_UPI_VPA is not configured. Set it in Gym Settings or .env to enable UPI QR codes.");
  }

  const tn = `${payeeName} - ${params.memberName} - ${params.invoiceNumber}`;

  const url = new URL("upi://pay");
  url.searchParams.set("pa", vpa);
  url.searchParams.set("pn", payeeName);
  url.searchParams.set("am", params.amount.toFixed(2));
  url.searchParams.set("cu", "INR");
  url.searchParams.set("tn", tn);

  return url.toString();
}
