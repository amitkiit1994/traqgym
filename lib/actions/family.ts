"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createFamilyGroup as createFamilyGroupService,
  addMember as addMemberService,
  removeMember as removeMemberService,
  getFamilyMembers as getFamilyMembersService,
  getMemberFamily as getMemberFamilyService,
  getFamilyGroups as getFamilyGroupsService,
} from "@/lib/services/family";

export async function getFamilyGroups() {
  try { await requireWorker(); } catch { return []; }
  return getFamilyGroupsService();
}

export async function createFamilyGroup(data: {
  name: string;
  primaryMemberId: number;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return createFamilyGroupService(data);
}

export async function addMember(groupId: number, userId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return addMemberService(groupId, userId);
}

export async function removeMember(groupId: number, userId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return removeMemberService(groupId, userId);
}

export async function getFamilyMembers(groupId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Failed to get family members" }; }
  return getFamilyMembersService(groupId);
}

export async function getMemberFamily(userId: number) {
  try { await requireWorker(); } catch { return null; }
  return getMemberFamilyService(userId);
}
