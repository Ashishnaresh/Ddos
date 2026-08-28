-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AuthorizationStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Protocol" AS ENUM ('HTTP', 'HTTPS');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('CREATED', 'AUTHORIZING', 'AUTHORIZED', 'STARTING', 'RUNNING', 'STOPPING', 'COMPLETED', 'FAILED', 'ABORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'USER_CREATED', 'USER_ROLE_CHANGED', 'TARGET_CREATED', 'TARGET_UPDATED', 'TARGET_APPROVED', 'TARGET_SUSPENDED', 'TARGET_REVOKED', 'TEST_REQUESTED', 'TEST_AUTHORIZED', 'TEST_STARTED', 'TEST_STOPPED', 'TEST_COMPLETED', 'TEST_FAILED', 'TEST_REJECTED', 'SAFETY_LIMIT_TRIGGERED', 'EMERGENCY_STOP', 'SERVICE_UNAVAILABLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipAtCreation" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizedTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "protocol" "Protocol" NOT NULL DEFAULT 'HTTPS',
    "port" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "authorizationStatus" "AuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "authorizationReference" TEXT NOT NULL,
    "notes" TEXT,
    "maxRequestsPerSecond" INTEGER NOT NULL,
    "maxConcurrency" INTEGER NOT NULL,
    "maxDurationSeconds" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorizedTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'CREATED',
    "targetId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "path" TEXT NOT NULL DEFAULT '/',
    "requestsPerSecond" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "requestTimeoutMs" INTEGER NOT NULL,
    "headersJson" JSONB,
    "bodySize" INTEGER NOT NULL DEFAULT 0,
    "requestedConfigJson" JSONB NOT NULL,
    "sessionId" TEXT NOT NULL,
    "observedIp" TEXT NOT NULL,
    "targetHostname" TEXT NOT NULL,
    "targetPort" INTEGER NOT NULL,
    "workerId" TEXT,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "stopReason" TEXT,
    "stoppedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestMetric" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "intervalMs" INTEGER NOT NULL,
    "requests" INTEGER NOT NULL,
    "successes" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "timeouts" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "requestsPerSecond" DOUBLE PRECISION NOT NULL,
    "concurrencyPeak" INTEGER NOT NULL,
    "latencyAvgMs" DOUBLE PRECISION NOT NULL,
    "latencyP50Ms" DOUBLE PRECISION NOT NULL,
    "latencyP95Ms" DOUBLE PRECISION NOT NULL,
    "latencyP99Ms" DOUBLE PRECISION NOT NULL,
    "latencyMaxMs" DOUBLE PRECISION NOT NULL,
    "statusCountsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventType" "AuditEventType" NOT NULL,
    "userId" TEXT,
    "observedIp" TEXT,
    "testId" TEXT,
    "targetId" TEXT,
    "sessionId" TEXT,
    "message" TEXT,
    "result" TEXT,
    "failureReason" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyStopState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyStopState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthorizedTarget_authorizationStatus_idx" ON "AuthorizedTarget"("authorizationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedTarget_hostname_port_protocol_key" ON "AuthorizedTarget"("hostname", "port", "protocol");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE INDEX "Test_targetId_idx" ON "Test"("targetId");

-- CreateIndex
CREATE INDEX "Test_requestedById_idx" ON "Test"("requestedById");

-- CreateIndex
CREATE INDEX "Test_requestedAt_idx" ON "Test"("requestedAt");

-- CreateIndex
CREATE INDEX "TestMetric_testId_bucketStart_idx" ON "TestMetric"("testId", "bucketStart");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_testId_idx" ON "AuditLog"("testId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizedTarget" ADD CONSTRAINT "AuthorizedTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AuthorizedTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestMetric" ADD CONSTRAINT "TestMetric_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

