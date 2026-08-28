import { defineHandler, json } from "@/lib/apiHandler";
import { permissionsFor } from "@/lib/rbac";

export const runtime = "nodejs";

export const GET = defineHandler({ auth: "required" }, async ({ user }) => {
  return json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
    permissions: permissionsFor(user.role),
  });
});
