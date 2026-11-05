-- Phase 9: notifications
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title_ar" VARCHAR(300) NOT NULL,
    "title_en" VARCHAR(300) NOT NULL,
    "body_ar" TEXT,
    "body_en" TEXT,
    "link" VARCHAR(500),
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "notifications_user_created_idx" ON "notifications"("user_id", "created_at" DESC);
CREATE INDEX "notifications_user_unread_idx" ON "notifications"("user_id") WHERE "read_at" IS NULL;
