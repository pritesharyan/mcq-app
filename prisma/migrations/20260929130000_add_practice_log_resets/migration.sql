CREATE TABLE "PracticeLogReset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "paperId" INTEGER,
    "bookId" INTEGER NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "resetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeLogReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLogReset_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLogReset_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PracticeLogReset_userId_scopeKey_key" ON "PracticeLogReset"("userId", "scopeKey");
CREATE INDEX "PracticeLogReset_userId_bookId_idx" ON "PracticeLogReset"("userId", "bookId");