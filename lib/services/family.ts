import { prisma } from "@/lib/prisma";

export async function getFamilyGroups() {
  try {
    const groups = await prisma.familyGroup.findMany({
      include: {
        members: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      primaryMemberId: g.primaryMemberId,
      memberCount: g.members.length,
      members: g.members.map((m) => ({
        id: m.id,
        name: `${m.firstname} ${m.lastname}`,
        email: m.email,
        phone: m.phone,
        isActive: m.isActive,
        isPrimary: m.id === g.primaryMemberId,
      })),
    }));
  } catch {
    return [];
  }
}

export async function createFamilyGroup(data: {
  name: string;
  primaryMemberId: number;
}) {
  try {
    const user = await prisma.user.findUnique({ where: { id: data.primaryMemberId } });
    if (!user) return { success: false, error: "User not found" };
    if (user.familyGroupId) return { success: false, error: "User already belongs to a family group" };

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.familyGroup.create({
        data: {
          name: data.name.trim(),
          primaryMemberId: data.primaryMemberId,
        },
      });
      await tx.user.update({
        where: { id: data.primaryMemberId },
        data: { familyGroupId: g.id },
      });
      return g;
    });

    return {
      success: true,
      group: {
        id: group.id,
        name: group.name,
        primaryMemberId: group.primaryMemberId,
        createdAt: group.createdAt.toISOString(),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create family group" };
  }
}

export async function addMember(groupId: number, userId: number) {
  try {
    const group = await prisma.familyGroup.findUnique({
      where: { id: groupId },
      include: { members: { select: { id: true } } },
    });
    if (!group) return { success: false, error: "Family group not found" };
    if (group.members.length >= 6) return { success: false, error: "Maximum 6 members per family group" };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, error: "User not found" };
    if (user.familyGroupId) return { success: false, error: "User already belongs to a family group" };

    await prisma.user.update({
      where: { id: userId },
      data: { familyGroupId: groupId },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to add member" };
  }
}

export async function removeMember(groupId: number, userId: number) {
  try {
    const group = await prisma.familyGroup.findUnique({ where: { id: groupId } });
    if (!group) return { success: false, error: "Family group not found" };
    if (group.primaryMemberId === userId) return { success: false, error: "Cannot remove primary member" };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.familyGroupId !== groupId) return { success: false, error: "User is not in this group" };

    await prisma.user.update({
      where: { id: userId },
      data: { familyGroupId: null },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to remove member" };
  }
}

export async function getFamilyMembers(groupId: number) {
  try {
    const group = await prisma.familyGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
      },
    });

    if (!group) return { success: false, error: "Family group not found" };

    return {
      success: true,
      group: {
        id: group.id,
        name: group.name,
        primaryMemberId: group.primaryMemberId,
      },
      members: group.members.map((m) => ({
        id: m.id,
        name: `${m.firstname} ${m.lastname}`,
        email: m.email,
        phone: m.phone,
        isActive: m.isActive,
        isPrimary: m.id === group.primaryMemberId,
      })),
    };
  } catch {
    return { success: false, error: "Failed to get family members" };
  }
}

export async function getMemberFamily(userId: number) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { familyGroupId: true },
    });

    if (!user || !user.familyGroupId) return null;

    return getFamilyMembers(user.familyGroupId);
  } catch {
    return null;
  }
}
