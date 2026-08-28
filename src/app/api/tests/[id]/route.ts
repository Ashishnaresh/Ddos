import { ApiError, defineHandler, json } from "@/lib/apiHandler";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export const GET = defineHandler(
  { auth: "required", permission: "tests:view" },
  async ({ params }) => {
    const test = await prisma.test.findUnique({
      where: { id: params.id },
      include: {
        target: {
          select: {
            name: true,
            hostname: true,
            port: true,
            protocol: true,
            authorizationStatus: true,
            authorizationReference: true,
          },
        },
        requestedBy: { select: { displayName: true, email: true } },
      },
    });
    if (!test) throw new ApiError(404, "NOT_FOUND", "Test not found.");
    return json({ test });
  },
);
