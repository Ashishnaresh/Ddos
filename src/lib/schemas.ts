import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(80),
  password: z.string().min(12).max(200),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const hostnameRe =
  /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-]{1,63}\.?)+[a-zA-Z0-9-]{1,63}$|^localhost$|^\d{1,3}(\.\d{1,3}){3}$/;

export const createTargetSchema = z.object({
  name: z.string().min(1).max(120),
  hostname: z.string().min(1).max(253).regex(hostnameRe, "Invalid hostname or IP"),
  protocol: z.enum(["HTTP", "HTTPS"]),
  port: z.number().int().min(1).max(65535),
  owner: z.string().min(1).max(200),
  authorizationReference: z.string().min(3).max(500),
  notes: z.string().max(2000).optional(),
  maxRequestsPerSecond: z.number().int().min(1).max(1_000_000),
  maxConcurrency: z.number().int().min(1).max(100_000),
  maxDurationSeconds: z.number().int().min(1).max(86_400),
});

export const updateTargetSchema = createTargetSchema.partial().extend({
  authorizationStatus: z
    .enum(["PENDING", "APPROVED", "SUSPENDED", "REVOKED"])
    .optional(),
});

export const createTestSchema = z.object({
  targetId: z.string().min(1),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  path: z.string().min(1).max(2048),
  requestsPerSecond: z.number().int().min(1).max(10_000_000),
  concurrency: z.number().int().min(1).max(10_000_000),
  durationSeconds: z.number().int().min(1).max(10_000_000),
  requestTimeoutMs: z.number().int().min(100).max(120_000),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().max(1_000_000).optional(),
});

export const stopTestSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const emergencyStopSchema = z.object({
  scope: z.enum(["all", "one"]),
  testId: z.string().optional(),
  reason: z.string().min(1).max(500),
  clear: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;
