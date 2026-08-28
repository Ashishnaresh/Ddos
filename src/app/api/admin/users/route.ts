import { defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "users:manage", roles: ["ADMIN"] },
  async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lockedUntil: true,
      },
    });
    return json({ users });
  },
);
