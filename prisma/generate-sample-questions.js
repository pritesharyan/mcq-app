// Generates 100 placeholder MCQ questions for testing the app end-to-end
// (pagination, the test mode, export, Practice Log, etc.) before you've
// entered real content. Run with: npm run sample-data
//
// If no Book exists yet, this first creates a "Sample Paper" > "Sample Book"
// (plus 4 more sample books) to attach the questions to. If your own books
// already exist, it uses those instead and doesn't touch your real data.
const prisma = require('../lib/prisma');

const TOPICS = ['History', 'Geography', 'Science', 'Mathematics', 'Computer Science', 'General Knowledge'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

async function ensureSampleBooks() {
  const existing = await prisma.book.findMany();
  if (existing.length > 0) return existing;

  const paper = await prisma.paper.create({ data: { name: 'Sample Paper' } });
  const books = [];
  for (const name of ['Sample Book 1', 'Sample Book 2', 'Sample Book 3', 'Sample Book 4', 'Sample Book 5']) {
    const book = await prisma.book.create({ data: { name } });
    await prisma.paperBook.create({ data: { paperId: paper.id, bookId: book.id } });
    books.push(book);
  }
  console.log('No existing Book found - created "Sample Paper" with 5 sample books.');
  return books;
}

async function main() {
  const books = await ensureSampleBooks();

  let admin = await prisma.user.findFirst({ where: { role: 'master_admin' } });
  if (!admin) admin = await prisma.user.findFirst();
  if (!admin) {
    console.error('No users exist yet - start the server once first (npm start) so the master admin gets seeded, then re-run this.');
    process.exit(1);
  }

  let created = 0;
  for (let i = 1; i <= 100; i++) {
    const book = pick(books);
    const topic = pick(TOPICS);
    const correct = randInt(1, 4);
    const options = ['Option A', 'Option B', 'Option C', 'Option D'];
    options[correct - 1] = `Correct answer for #${i}`;

    await prisma.question.create({
      data: {
        bookId: book.id,
        questionText: `Sample ${topic} question #${i} - which of the following is correct?`,
        option1: options[0], option2: options[1], option3: options[2], option4: options[3],
        correctOption: correct,
        explanation: `Placeholder explanation for sample question #${i}. Replace with real content before publishing.`,
        createdById: admin.id
      }
    });
    created++;
  }
  console.log(`Created ${created} sample questions (attributed to "${admin.username}"). These are clearly labeled "Sample" / "Placeholder" - delete them from Admin > Questions once you no longer need test data.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
