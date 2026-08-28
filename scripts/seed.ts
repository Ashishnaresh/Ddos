/**
 * Development seed. Creates an admin, an operator, a viewer, and one APPROVED
 * target pointing at a local echo server you control (see docker-compose "echo").
 *
 * Credentials are intentionally weak-but-policy-compliant DEV values. Never use
 * these in a deployed environment.
 */
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

async function main() {
  const users = [
    { email: "admin@example.com", displayName: "Dev Admin", role: "ADMIN" as const, password: "AdminPass123!" },
    { email: "operator@example.com", displayName: "Dev Operator", role: "OPERATOR" as const, password: "OperatorPass123!" },
    { email: "viewer@example.com", displayName: "Dev Viewer", role: "VIEWER" as const, password: "ViewerPass123!" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role },
      create: {
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        passwordHash: await hashPassword(u.password),
      },
    });
    console.log(`user ${u.email} / ${u.password} (${u.role})`);
  }

  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@example.com" },
  });

  await prisma.emergencyStopState.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", active: false },
  });

  const target = await prisma.authorizedTarget.upsert({
    where: { hostname_port_protocol: { hostname: "echo", port: 8080, protocol: "HTTP" } },
    update: { authorizationStatus: "APPROVED" },
    create: {
      name: "Local echo (dev)",
      hostname: "echo",
      protocol: "HTTP",
      port: 8080,
      owner: "platform-team",
      authorizationStatus: "APPROVED",
      authorizationReference: "DEV-LOCAL-ECHO",
      maxRequestsPerSecond: 200,
      maxConcurrency: 50,
      maxDurationSeconds: 60,
      createdById: admin.id,
    },
  });
  console.log(`target ${target.name} -> APPROVED`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
