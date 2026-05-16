import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory store for the mocked PendingGymProvisioning table.
type PendingRow = {
  id: number;
  gymName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  subdomain: string | null;
  city: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};
const pendingRows: PendingRow[] = [];
let nextId = 1;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingGymProvisioning: {
      findFirst: vi.fn(({ where }: { where: { ownerEmail: string; status: string } }) =>
        Promise.resolve(
          pendingRows.find(
            (r) => r.ownerEmail === where.ownerEmail && r.status === where.status,
          ) ?? null,
        ),
      ),
      create: vi.fn(({ data }: { data: Omit<PendingRow, "id" | "status" | "createdAt" | "updatedAt"> }) => {
        const row: PendingRow = {
          id: nextId++,
          ...data,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pendingRows.push(row);
        return Promise.resolve(row);
      }),
    },
  },
}));

const sendEmailMock = vi.fn();
vi.mock("@/lib/services/notification", async () => {
  // Use the real normalizePhone so validation behaves correctly, but stub
  // sendEmail so we don't touch SMTP.
  const actual = await vi.importActual<typeof import("@/lib/services/notification")>(
    "@/lib/services/notification",
  );
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  };
});

// Stub global fetch in case the real notification module is exercised
// indirectly elsewhere during the test run.
vi.stubGlobal("fetch", vi.fn());

describe("requestGymSignup", () => {
  beforeEach(() => {
    pendingRows.length = 0;
    nextId = 1;
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ success: true });
    vi.resetModules();
  });

  it("creates a pending row and sends ops a notification on valid input", async () => {
    const { requestGymSignup } = await import("@/lib/actions/gym-signup");
    const res = await requestGymSignup({
      gymName: " Free Form Fitness ",
      ownerName: "Amit",
      ownerEmail: "AMIT@example.com",
      ownerPhone: "+91 98198 11652",
      subdomain: "freeformfitness",
      city: "Mumbai",
      notes: "Currently on FitnessBoard",
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.id).toBe(1);

    // Row was inserted with trimmed/normalized values
    expect(pendingRows.length).toBe(1);
    const row = pendingRows[0];
    expect(row.gymName).toBe("Free Form Fitness");
    expect(row.ownerEmail).toBe("amit@example.com");
    expect(row.ownerPhone).toBe("9819811652");
    expect(row.subdomain).toBe("freeformfitness");

    // Ops email fired with the provisioning command pre-filled
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      body: string;
    };
    expect(call.subject).toContain("Free Form Fitness");
    expect(call.body).toContain("./scripts/onboard-gym.sh");
    expect(call.body).toContain("amit@example.com");
  });

  it("rejects when a pending row already exists for that email", async () => {
    const { requestGymSignup } = await import("@/lib/actions/gym-signup");
    const first = await requestGymSignup({
      gymName: "Gym A",
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      ownerPhone: "9819811652",
    });
    expect(first.success).toBe(true);

    const second = await requestGymSignup({
      gymName: "Gym A",
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      ownerPhone: "9819811652",
    });
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error).toMatch(/already have a pending signup/i);

    // Only the first call triggered the ops email
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(pendingRows.length).toBe(1);
  });

  it("rejects when required fields are missing or invalid", async () => {
    const { requestGymSignup } = await import("@/lib/actions/gym-signup");

    const noGym = await requestGymSignup({
      gymName: "",
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      ownerPhone: "9819811652",
    });
    expect(noGym.success).toBe(false);

    const noOwner = await requestGymSignup({
      gymName: "Gym",
      ownerName: "  ",
      ownerEmail: "owner@example.com",
      ownerPhone: "9819811652",
    });
    expect(noOwner.success).toBe(false);

    const badPhone = await requestGymSignup({
      gymName: "Gym",
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      ownerPhone: "12345", // too short — normalizePhone returns null
    });
    expect(badPhone.success).toBe(false);

    const badEmail = await requestGymSignup({
      gymName: "Gym",
      ownerName: "Owner",
      ownerEmail: "not-an-email",
      ownerPhone: "9819811652",
    });
    expect(badEmail.success).toBe(false);

    // None of the invalid attempts inserted a row or sent ops mail
    expect(pendingRows.length).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
