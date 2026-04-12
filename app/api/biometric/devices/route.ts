import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "worker") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const devices = await prisma.biometricDevice.findMany({
    include: { location: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(devices);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, locationId, deviceType } = body;

  if (!name || !locationId) {
    return Response.json({ error: "Name and location required" }, { status: 400 });
  }

  const device = await prisma.biometricDevice.create({
    data: {
      name,
      locationId: Number(locationId),
      deviceType: deviceType || "fingerprint",
    },
    include: { location: { select: { name: true } } },
  });

  return Response.json(device, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, isActive } = body;

  if (!id || typeof isActive !== "boolean") {
    return Response.json({ error: "id and isActive required" }, { status: 400 });
  }

  const device = await prisma.biometricDevice.update({
    where: { id: Number(id) },
    data: { isActive },
    include: { location: { select: { name: true } } },
  });

  return Response.json(device);
}
