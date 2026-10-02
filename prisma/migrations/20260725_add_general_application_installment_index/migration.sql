-- CreateIndex
CREATE INDEX IF NOT EXISTS "general_application_installments_applicationId_date_idx" ON "general_application_installments"("application_id", "date");
