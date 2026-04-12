import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import { searchMembers } from "@/lib/actions/renewals";
import {
  getMembers,
  getMember,
  createMember,
  updateMember,
  toggleMemberActive,
  cancelMembership,
  transferMember,
} from "@/lib/actions/members";

export const memberTools = [
  tool({
    name: "search_members",
    description: "Search members by name, email, or phone. Returns matching members with their plan status.",
    parameters: z.object({
      query: z.string().describe("Search query (name, email, or phone)"),
    }),
    async execute(input) {
      const results = await searchMembers(input.query);
      return JSON.stringify(results);
    },
  }),

  tool({
    name: "get_member_details",
    description: "Get full member profile including active plans/tickets, payment history summary, and attendance",
    parameters: z.object({
      memberId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const member = await getMember(input.memberId);
      return JSON.stringify(member);
    },
  }),

  tool({
    name: "get_members_list",
    description: "Get paginated list of all members with search/filter",
    parameters: z.object({
      search: z.string().nullable().describe("Search query"),
      page: z.number().nullable().describe("Page number (1-based)"),
      pageSize: z.number().nullable().describe("Results per page"),
    }),
    async execute(input) {
      const result = await getMembers({
        search: input.search ?? undefined,
        page: input.page ?? undefined,
        pageSize: input.pageSize ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "create_member",
    description: "Create a new gym member. Requires confirmation before executing.",
    parameters: z.object({
      firstname: z.string().describe("First name"),
      lastname: z.string().describe("Last name"),
      email: z.string().describe("Email address"),
      phone: z.string().nullable().describe("Phone number"),
      gender: z.string().nullable().describe("Gender: male, female, or other"),
      locationId: z.number().nullable().describe("Location ID"),
    }),
    async execute(input) {
      const result = await createMember(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_member",
    description: "Update an existing member's details. Requires confirmation before executing.",
    parameters: z.object({
      memberId: z.number().describe("Member ID to update"),
      firstname: z.string().describe("First name"),
      lastname: z.string().describe("Last name"),
      email: z.string().describe("Email"),
      phone: z.string().nullable().describe("Phone"),
      gender: z.string().nullable().describe("Gender"),
      locationId: z.number().nullable().describe("Location ID"),
    }),
    async execute(input) {
      const { memberId, ...data } = input;
      const result = await updateMember(memberId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_member_active",
    description: "Activate or deactivate a member. Requires confirmation.",
    parameters: z.object({
      memberId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const result = await toggleMemberActive(input.memberId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "cancel_membership",
    description: "Cancel an active membership ticket. Requires confirmation.",
    parameters: z.object({
      ticketId: z.number().describe("MemberTicket ID to cancel"),
    }),
    async execute(input) {
      const result = await cancelMembership(input.ticketId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "transfer_member",
    description: "Transfer a member to a different gym location. Requires confirmation before executing. Admin only.",
    parameters: z.object({
      userId: z.number().describe("Member ID to transfer"),
      toLocationId: z.number().describe("Destination location ID"),
    }),
    async execute(input) {
      // Find the member's active ticket
      const member = await getMember(input.userId);
      if (!member) return JSON.stringify({ success: false, error: "Member not found" });

      const activeTicket = member.memberTickets?.find(
        (t: { status: string; expireDate: Date }) => t.status === "active" && new Date(t.expireDate) >= new Date()
      );
      if (!activeTicket) return JSON.stringify({ success: false, error: "No active ticket found for this member" });

      const result = await transferMember({
        userId: input.userId,
        toLocationId: input.toLocationId,
        ticketId: activeTicket.id,
      });
      return JSON.stringify(result);
    },
  }),
];
