-- DropIndex
DROP INDEX "evidence_files_storageKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_evidenceId_storageKey_key" ON "evidence_files"("evidenceId", "storageKey");

