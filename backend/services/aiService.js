// ============================================================
// services/aiService.js — Tất cả logic gọi Groq AI
//
// Tại sao tách thành service riêng?
//   Controller chỉ lo nghiệp vụ (chấm điểm, lưu DB)
//   Service lo việc gọi AI — dễ thay đổi provider sau này
//
// 2 chức năng chính:
//   1. generateExplanation  — sinh giải thích đáp án sau khi HS nộp bài
//                             gọi bất đồng bộ trong examController.submitExam
//   2. generateQuestions    — tạo câu hỏi trắc nghiệm theo chủ đề
//                             gọi trong questionController.generateQuestionsWithAI
//
// Cấu hình đọc từ .env:
//   AI_MODEL=llama3-8b-8192
//   AI_MAX_TOKENS=2000
//   AI_TIMEOUT_MS=10000
// ============================================================

const ai = require("../config/ai"); // Groq client (tương thích OpenAI)

// ============================================================
// generateExplanation
// Sinh giải thích đáp án cho toàn bộ câu hỏi sau khi thi
//
// Tham số:
//   questions — mảng câu hỏi gồm: content, correctAnswer, studentAnswer, isCorrect
//
// Trả về: string — nội dung giải thích từ AI
// ============================================================
async function generateExplanation(questions) {
  // Xây dựng nội dung gửi cho AI
  const questionList = questions
    .map((q, i) => {
      return `Câu ${i + 1}: ${q.content}
Đáp án đúng: ${q.correctAnswer}
Học sinh chọn: ${q.studentAnswer ?? "Bỏ qua"} (${q.isCorrect ? "ĐÚNG" : "SAI"})`;
    })
    .join("\n\n");

  const prompt = `Dưới đây là kết quả bài thi trắc nghiệm của học sinh. 
Hãy giải thích ngắn gọn TẠI SAO đáp án đúng là đúng cho từng câu, bằng tiếng Việt, dễ hiểu.

${questionList}

Trả lời theo định dạng:
Câu 1: [giải thích lý do đáp án đúng]
Câu 2: [giải thích lý do đáp án đúng]
...`;

  const completion = await ai.chat.completions.create({
    model: process.env.AI_MODEL || "llama3-8b-8192",
    max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0]?.message?.content ?? "";
}

// ============================================================
// generateQuestions
// Tạo câu hỏi trắc nghiệm theo chủ đề bằng AI
//
// Tham số:
//   subject    — môn học (VD: "Toán", "Vật lý")
//   topic      — chủ đề / chương (VD: "Đại số tuyến tính")
//   count      — số câu cần tạo (mặc định 5)
//   difficulty — mức độ: 'easy' | 'medium' | 'hard'
//
// Trả về: mảng câu hỏi đã parse
//   [{ content, answers: [{ content, isCorrect }] }]
// ============================================================
async function generateQuestions(
  subject,
  topic,
  count = 5,
  difficulty = "medium",
) {
  const diffText =
    { easy: "Dễ", medium: "Trung bình", hard: "Khó" }[difficulty] ||
    "Trung bình";

  // Yêu cầu AI trả về JSON thuần để parse dễ dàng
  const prompt = `Hãy tạo ${count} câu hỏi trắc nghiệm bằng tiếng Việt về môn "${subject}", chủ đề "${topic}", mức độ ${diffText}.
Trả về ĐÚNG định dạng JSON sau, không thêm bất kỳ văn bản nào bên ngoài JSON:
[
  {
    "content": "Nội dung câu hỏi",
    "answers": [
      { "content": "Đáp án A", "isCorrect": false },
      { "content": "Đáp án B", "isCorrect": true },
      { "content": "Đáp án C", "isCorrect": false },
      { "content": "Đáp án D", "isCorrect": false }
    ]
  }
]
Lưu ý quan trọng: mỗi câu hỏi chỉ được có đúng 1 đáp án isCorrect = true.`;

  const completion = await ai.chat.completions.create({
    model: process.env.AI_MODEL || "llama3-8b-8192",
    max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = completion.choices[0]?.message?.content ?? "";

  // Trích xuất JSON — AI đôi khi bọc trong ```json ... ```
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(
      "AI không trả về đúng định dạng JSON. Nội dung nhận được: " +
        rawText.slice(0, 200),
    );
  }

  const questions = JSON.parse(jsonMatch[0]);

  // Lọc bỏ câu hỏi không đủ cấu trúc
  return questions.filter((q) => q.content && q.answers?.length > 0);
}

module.exports = { generateExplanation, generateQuestions };
