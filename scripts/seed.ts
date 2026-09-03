/**
 * Local development seed. Creates an admin, an operator, a viewer, and one
 * APPROVED target pointing at a local echo server you control (see
 * docker-compose "echo").
 *
 * Each account gets a freshly generated, policy-compliant password that is
 * printed to the console once. Refuses to run when NODE_ENV=production.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

if (process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to seed: NODE_ENV=production. The seed is for local development only.",
  );
  process.exit(1);
}

function devPassword(): string {
  // Satisfies the password policy (upper + lower + digit, >= 12 chars).
  return "Dev-" + randomBytes(9).toString("base64url") + "9Aa";
}

async function main() {
  const users = [
    { email: "admin@example.com", displayName: "Dev Admin", role: "ADMIN" as const },
    { email: "operator@example.com", displayName: "Dev Operator", role: "OPERATOR" as const },
    { email: "viewer@example.com", displayName: "Dev Viewer", role: "VIEWER" as const },
  ];

  console.log("Seeded development accounts (save these now — not shown again):");
  for (const u of users) {
    const password = devPassword();
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, passwordHash: await hashPassword(password) },
      create: {
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`  ${u.role.padEnd(9)} ${u.email.padEnd(24)} ${password}`);
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
