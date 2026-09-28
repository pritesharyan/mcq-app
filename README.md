# MCQ Practice App v2 — multi-user, multi-admin, Prisma

Login + registration, Paper → Book → Chapter hierarchy, English/Gujarati
bilingual questions, admin CRUD, image/PDF attachments, user-submitted
correction suggestions, a collapsible practice-quiz setup panel with a hint
button, a timed randomized "Take a Test" mode with a color-coded question
palette, an exam-material download table, and multi-admin user management
with block/grant access.

## Stack
- **Backend:** Node.js + Express
- **Node.js:** 22.16 or newer (uses Node's SQLite online backup API)
- **ORM/DB:** **Prisma** on SQLite for now — switching to Postgres later is a
  two-line change (see "Moving to Postgres" below), no route code changes needed
- **Auth:** `express-session` + `bcryptjs` (passwords are hashed, not stored
  in plain text — see "About passwords" below for why, and what to use instead)
- **Uploads:** `multer` (images/PDF, 10MB limit)
- **Frontend:** plain HTML/CSS/JS, no build step

## Run it

```bash
cd mcq-app
npm install
npx prisma migrate dev --name init
npm start
```

Open `http://localhost:3000`.

- **`npm install`** also runs `prisma generate` automatically (via the
  `postinstall` script) to build the Prisma Client.
- **`npx prisma migrate dev --name init`** is a one-time step (per fresh
  database) that creates `data.db` and all its tables from
  `prisma/schema.prisma`. Run it again with a new `--name` any time you edit
  the schema yourself later.
- **Initial master admin:** username `admin`, with the password from
  `INITIAL_ADMIN_PASSWORD` — seeded only the very first time the server starts
  against an empty database. Production requires this variable and a password
  of at least 12 characters; local development uses `admin123` only when the
  variable is omitted. Change the initial password immediately after signing
  in via the Change Password screen.
- Anyone can **Register** — new accounts default to role `user`.

## Deploy to Render

This repository includes `render.yaml` for a single-instance Render web service
using a persistent disk for the SQLite database, uploads, and backups.

1. Push the repository to GitHub and create a Render Blueprint from it.
2. Review the generated `SESSION_SECRET`; Render generates it automatically.
3. Add SMTP environment variables if account-recovery emails should be sent:
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM`.
4. Deploy and confirm that `/healthz` returns `{ "ok": true }`.

The persistent disk is required. Without it, SQLite data, uploaded materials,
sessions, and backups can be lost when Render restarts or redeploys the service.
For multiple web instances, migrate the database to Postgres and use durable
object storage for uploaded files; the current in-process session store is for
the single-instance deployment described above.

For Google AdSense, publish the Privacy Policy, Terms of Use, and Contact pages
before applying, keep substantial original educational content available to
crawlers, and add the publisher-specific `ads.txt` entry only after Google
provides the publisher ID. Approval is determined by Google and cannot be
guaranteed by deployment configuration.

## Android app wrapper

The `android-app/` directory contains a lightweight WebView wrapper that
opens the deployed site directly on the login page. Set the final HTTPS Render
URL in `android-app/app/src/main/res/values/strings.xml`, then open the
directory in Android Studio. Build a signed Android App Bundle (`.aab`) for
Google Play; see `android-app/README.md` for the release steps.

## Database backups

The server keeps consistent SQLite snapshots in the project-root `backups/` folder. It creates an automatic backup at startup when no automatic backup exists or the latest one is at least 24 hours old, then schedules the next backup 24 hours later. Master admins can create and download manual or automatic snapshots from Admin > Backups. Backup files stay on the same server, so download important copies to separate storage.

## About passwords — why they're hashed, not plaintext

You asked for admin-visible plaintext passwords so admins could help
locked-out users. I've kept passwords hashed (industry standard — if
`data.db` or a backup of it is ever exposed, plaintext passwords hand over
every user's password immediately, and most people reuse passwords
elsewhere). Instead, admins get the practical thing they actually need:

- **Admin > Users > Reset password** generates a fresh random password,
  shows it to the admin **once** in a dialog, and hashes it before storing.
  The admin copies it and gives it to the user directly.
- **Users can change their own password** any time (Change Password tab),
  which requires their current password.

If you still want literal plaintext storage after reading this, it's a small
change in `routes/auth.js` / `routes/users.js` (drop the `bcrypt.hash` /
`bcrypt.compareSync` calls) — just say so and I'll make it.

## Roles and permissions

| Role | Can do |
|---|---|
| `user` | Take practice quizzes / timed tests, suggest corrections, see their own suggestions, download exam materials, change their own password |
| `admin` | Everything a user can, **plus**: add/edit/delete Papers/Books/Chapters, add questions (scoped to **only the questions they personally created** — they can't edit or delete another admin's questions), view/manage all suggestions, view the user list and block/grant access to any non-master-admin user |
| `master_admin` | Everything an admin can, **plus**: sees and can edit/delete **every** question regardless of who created it, can promote a `user` to `admin` (or back), and is the only role that can add/edit/delete rows in the Exam Materials table |

The very first account ever created (via `lib/seed.js`, on first server start)
is automatically `master_admin`. There's currently no UI to promote someone
to `master_admin` directly — that's an intentional narrow point of control;
do it via Prisma Studio (`npm run studio`) if you ever need a second one.

## How the bilingual `//` format works

Unchanged from before, just relabeled: questions/options/explanation are
stored as `"English//Gujarati"` in one field. The admin form gives two
separate boxes (English / Gujarati) and the server joins them with `//` on
save (`combine()` in `routes/questions.js`); if only one language was typed,
no `//` is added. On the way out, `displayField()` shows both, just one
language, or — if a question only ever had one language — that language
regardless of what the user picked.

## New in this update

- **User-submitted corrections, visible to the submitter.** During a quiz,
  "Suggest a correction" posts to the admin's Suggestions tab. New: users can
  now also see every suggestion **they've** submitted, any time they log in,
  under the **My Suggestions** tab — including its current status and any
  admin note.
- **Prisma.** All data access now goes through `prisma/schema.prisma` +
  `lib/prisma.js` instead of raw SQL. See "Moving to Postgres" below.
- **Multi-admin with scoped visibility.** Regular admins only see/edit
  questions they personally created; the master admin sees and can manage
  everything. This is enforced server-side (`routes/questions.js`), not just
  hidden in the UI.
- **User management.** Admin > Users lists every registered user (name,
  username, mobile, email, role, status) and lets any admin block or restore
  ("grant") their access — a blocked user is logged out immediately, even
  mid-session, and can't log back in until unblocked. Only the master admin
  can change a `user` into an `admin`.
- **Registration fields.** Name, Username, Mobile, Email, Password, Confirm
  Password — matching what you asked for. My suggestion on top of that: I
  added **server-side confirm-password matching and a 6-character minimum**,
  since the fields alone don't stop someone from submitting mismatched or
  trivial passwords. I did *not* add anything beyond what you listed (like
  email verification) to keep this a real prototype you can run today — happy
  to add that later if you want registered emails verified.
- **Pagination.** The admin Questions tab now paginates at 10 per page, with
  Prev/Next and a "Page X of Y (N questions)" indicator — works together with
  the per-admin ownership scoping above.
- **Take a Test.** A new tab: pick one or more books, a question count
  (default **25**) and a time limit in minutes (default **50**), then start.
  Questions are pulled randomly from across all selected books' chapters. A
  countdown timer auto-submits at zero. The right-hand panel shows a numbered
  square per question, colored **green = attempted, yellow = skipped/visited
  but unanswered, plain = not yet visited**, with the current question
  outlined in blue — click any square to jump straight to that question.
  Submitting shows a score summary and an optional full review with
  explanations.
- **Exam Material downloads.** A new tab lists every row the master admin has
  added under Admin > Exam Materials — Sr. No, Paper Name, Book/Material
  Name, and a Download link — for users to browse and download reference
  PDFs.

## Moving to Postgres later

1. Stand up a Postgres database (locally, or a hosted one).
2. In `.env`, change `DATABASE_URL` to your Postgres connection string,
   e.g. `postgresql://user:password@host:5432/mcqapp`.
3. In `prisma/schema.prisma`, change `provider = "sqlite"` to
   `provider = "postgresql"` under `datasource db`.
4. Run `npx prisma migrate dev --name postgres-migration`.

None of the route/model code changes — that's the point of going through
Prisma instead of raw SQL from the start.

## Data model (see `prisma/schema.prisma` for the authoritative version)

```
User               (id, name, username, mobile, email, password[hashed], role, status, createdAt)
Paper              (id, name)
Book               (id, name)
PaperBook          (paperId, bookId)              -- many-to-many
Chapter            (id, name, bookId)
Question           (id, chapterId, questionText, option1..4, correctOption,
                    explanation, attachmentPath, attachmentType, createdById)
QuestionSuggestion (id, questionId, userId, suggestionText, status, adminNote, createdAt)
ExamMaterial       (id, paperId, materialName, downloadLink, addedById, createdAt)
```

## What I'd extend first

1. **Score/attempt history.** Test results currently aren't saved anywhere —
   they vanish on refresh. A `TestAttempt` model (user, questions, answers,
   score, timestamp) would let users see past results and let admins see
   aggregate performance per chapter/book.
2. **Real session store.** `express-session`'s default `MemoryStore` still
   isn't durable — swap in a Prisma- or Redis-backed store before this runs
   with real concurrent users, especially across a server restart.
3. **Bulk question import (CSV/Excel).** Entering questions one at a time
   doesn't scale, especially now that individual admins are each building up
   their own question bank.
4. **Exam Material access control.** Right now anyone logged in can see every
   row in the Exam Materials table. If some materials should be
   paper/book-restricted per user later, that's a small addition to the model.
5. **Email verification / password reset via email**, now that email is a
   registration field — currently it's collected but unused beyond uniqueness.
6. **Rate limiting on login.** No brute-force protection yet.

## Known prototype limitations

- Test scoring happens client-side using data already sent to the browser —
  a technically savvy user could inspect network responses to see correct
  answers before finishing. Fine for internal/practice use; if this becomes
  a graded/proctored exam tool, scoring needs to move server-side.
- No pagination yet on Users, Suggestions, or Exam Materials tables (only
  Questions) — fine at prototype scale.
- `SESSION_SECRET` in `.env` is a placeholder — set a real random value
  before deploying anywhere public.
