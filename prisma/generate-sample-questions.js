// Generates 100 placeholder MCQ questions for testing the app end-to-end
// (pagination, the test mode, export, etc.) before you've entered real content.
// Run with: npm run sample-data
//
// If no Book/Chapter exists yet, this first creates a "Sample Paper" > "Sample
// Book" > 5 chapters to attach the questions to. If your own books/chapters
// already exist, it uses those instead and doesn't touch your real data.
const prisma = require('../lib/prisma');

const TOPICS = ['History', 'Geography', 'Science', 'Mathematics', 'Computer Science', 'General Knowledge'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

async function ensureSampleStructure() {
  const existing = await prisma.chapter.findMany();
  if (existing.length > 0) return existing;

  const paper = await prisma.paper.create({ data: { name: 'Sample Paper' } });
  const book = await prisma.book.create({ data: { name: 'Sample Book' } });
  await prisma.paperBook.create({ data: { paperId: paper.id, bookId: book.id } });

  const chapters = [];
  for (const name of ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5']) {
    chapters.push(await prisma.chapter.create({ data: { name, bookId: book.id } }));
  }
  console.log('No existing Book/Chapter found - created "Sample Paper" > "Sample Book" > 5 chapters.');
  return chapters;
}

async function main() {
  const chapters = await ensureSampleStructure();

  let admin = await prisma.user.findFirst({ where: { role: 'master_admin' } });
  if (!admin) admin = await prisma.user.findFirst();
  if (!admin) {
    console.error('No users exist yet - start the server once first (npm start) so the master admin gets seeded, then re-run this.');
    process.exit(1);
  }

  let created = 0;
  for (let i = 1; i <= 100; i++) {
    const chapter = pick(chapters);
    const topic = pick(TOPICS);
    const correct = randInt(1, 4);
    const options = ['Option A', 'Option B', 'Option C', 'Option D'];
    options[correct - 1] = `Correct answer for #${i}`;

    await prisma.question.create({
      data: {
        chapterId: chapter.id,
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
