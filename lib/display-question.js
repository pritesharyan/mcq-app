const path = require('path');
const prisma = require('./prisma');

function singleLanguage(value) {
  const text = String(value ?? '').trim();
  if (!text.includes('//')) return text;
  const [english, ...gujarati] = text.split('//');
  return english.trim() || gujarati.join('//').trim();
}

function displayField(stored) {
  return { text: singleLanguage(stored) };
}

function toDisplayQuestion(question, isStarred = false) {
  return {
    id: question.id,
    book_id: question.bookId,
    book_name: question.book ? question.book.name : undefined,
    paper_names: question.book && question.book.papers
      ? question.book.papers.map(paperBook => paperBook.paper.name).sort((a, b) => a.localeCompare(b))
      : [],
    created_by: question.createdById,
    question: displayField(question.questionText),
    options: [question.option1, question.option2, question.option3, question.option4].map(displayField),
    correct_option: question.correctOption,
    explanation: displayField(question.explanation),
    attachment_url: question.attachmentPath ? `/uploads/${path.basename(question.attachmentPath)}` : null,
    attachment_type: question.attachmentType,
    is_starred: isStarred
  };
}

async function toDisplayQuestions(questions, userId) {
  const questionIds = questions.map(question => question.id);
  const starred = questionIds.length
    ? await prisma.starredQuestion.findMany({
      where: { userId, questionId: { in: questionIds } },
      select: { questionId: true }
    })
    : [];
  const starredIds = new Set(starred.map(item => item.questionId));
  return questions.map(question => toDisplayQuestion(question, starredIds.has(question.id)));
}

module.exports = { toDisplayQuestions };
