// ============================================================
// questionController.js — Ngân hàng câu hỏi (Tách riêng)
//
// Lý do tách khỏi teacherController:
//   teacherController đã quá dài, tách ra để dễ bảo trì.
//   Routes vẫn được đăng ký trong cùng nhóm /api/teacher/
//
// Routes sử dụng file này (khai báo trong app.js):
//   GET    /api/teacher/questions
//   POST   /api/teacher/questions
//   PUT    /api/teacher/questions/:id
//   DELETE /api/teacher/questions/:id
//   POST   /api/teacher/questions/upload      ← cần handleUploadSingle trước
//   POST   /api/teacher/questions/ai-generate ← gọi Groq API
// ============================================================

const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const ai = require("../config/ai"); // Groq client (tương thích OpenAI)
const xlsx = require("xlsx"); // SheetJS — đọc file Excel

// ============================================================
// GET /api/teacher/questions
// Lấy toàn bộ câu hỏi thuộc các đề thi của GV đang đăng nhập
// ============================================================
async function getQuestions(req, res) {
  try {
    const [questions] = await db.query(
      `SELECT q.id, q.exam_id, q.content, q.subject, q.topic,
              q.difficulty, q.points, q.source, q.created_at
       FROM questions q
       JOIN exams e ON q.exam_id = e.id
       WHERE e.teacher_id = ?
       ORDER BY q.created_at DESC`,
      [req.user.id],
    );

    return res.status(200).json({
      teacherName: req.user.fullName,
      questions: questions.map((q) => ({
        id: q.id,
        examId: q.exam_id,
        content: q.content,
        subject: q.subject,
        topic: q.topic,
        difficulty: q.difficulty,
        points: q.points,
        source: q.source, // 'manual' | 'upload' | 'ai'
        createdAt: q.created_at,
      })),
    });
  } catch (err) {
    console.error("[questionController.getQuestions]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/teacher/questions
// Thêm 1 câu hỏi thủ công kèm các đáp án
//
// Body: {
//   examId, content, subject, topic, difficulty, points,
//   answers: [{ content, isCorrect }]
// }
// Đồng bộ với question-bank.html: 4 ô đáp án + radio đáp án đúng
// ============================================================
async function createQuestion(req, res) {
  const { examId, content, subject, topic, difficulty, points, answers } =
    req.body;

  if (!content)
    return res.status(400).json({ message: "Vui lòng nhập nội dung câu hỏi." });
  if (!answers?.length)
    return res.status(400).json({ message: "Vui lòng nhập ít nhất 1 đáp án." });
  if (!answers.some((a) => a.isCorrect)) {
    return res
      .status(400)
      .json({ message: "Vui lòng đánh dấu 1 đáp án đúng." });
  }

  try {
    const questionId = uuidv4();

    await db.query(
      `INSERT INTO questions
         (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 0, NOW(), NOW())`,
      [
        questionId,
        examId || null,
        content.trim(),
        subject || null,
        topic || null,
        difficulty || "medium",
        points || 1,
      ],
    );

    // Lưu từng đáp án — order_index theo thứ tự trong mảng
    for (let i = 0; i < answers.length; i++) {
      await db.query(
        "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
        [
          uuidv4(),
          questionId,
          answers[i].content.trim(),
          answers[i].isCorrect ? 1 : 0,
          i,
        ],
      );
    }

    return res
      .status(201)
      .json({ message: "Thêm câu hỏi thành công.", questionId });
  } catch (err) {
    console.error("[questionController.createQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// PUT /api/teacher/questions/:id
// Sửa nội dung câu hỏi + đáp án
// Đồng bộ với modal Sửa trong question-bank.html
// ============================================================
async function updateQuestion(req, res) {
  const { id } = req.params;
  const { content, subject, topic, difficulty, points, answers } = req.body;

  if (!content)
    return res.status(400).json({ message: "Vui lòng nhập nội dung câu hỏi." });

  try {
    await db.query(
      `UPDATE questions
       SET content = ?, subject = ?, topic = ?, difficulty = ?, points = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        content.trim(),
        subject || null,
        topic || null,
        difficulty || "medium",
        points || 1,
        id,
      ],
    );

    // Nếu có cập nhật đáp án → xóa cũ rồi thêm mới
    if (answers?.length) {
      await db.query("DELETE FROM answers WHERE question_id = ?", [id]);
      for (let i = 0; i < answers.length; i++) {
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [
            uuidv4(),
            id,
            answers[i].content.trim(),
            answers[i].isCorrect ? 1 : 0,
            i,
          ],
        );
      }
    }

    return res.status(200).json({ message: "Cập nhật câu hỏi thành công." });
  } catch (err) {
    console.error("[questionController.updateQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// DELETE /api/teacher/questions/:id
// Xóa câu hỏi — đáp án bị xóa theo (ON DELETE CASCADE trong DB)
// ============================================================
async function deleteQuestion(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM questions WHERE id = ?", [id]);
    return res.status(200).json({ message: "Xóa câu hỏi thành công." });
  } catch (err) {
    console.error("[questionController.deleteQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/teacher/questions/upload
// Upload hàng loạt câu hỏi từ file Excel
//
// req.file.buffer → do handleUploadSingle (uploadMiddleware) cung cấp
// req.body.examId → giao câu hỏi vào đề thi nào (có thể để trống)
//
// Cấu trúc cột Excel (hàng 1 = tiêu đề, bị bỏ qua):
//   A: Nội dung câu hỏi
//   B: Môn học
//   C: Chủ đề
//   D: Mức độ (easy / medium / hard)
//   E: Điểm
//   F: Đáp án A
//   G: Đáp án B
//   H: Đáp án C
//   I: Đáp án D
//   J: Đáp án đúng (ghi chữ A / B / C / D)
// ============================================================
async function uploadQuestions(req, res) {
  const { examId } = req.body;

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 }, // trả về mảng 2 chiều [[col1, col2, ...], ...]
    );

    const dataRows = rows.slice(1); // bỏ hàng tiêu đề
    let created = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const [content, subject, topic, difficulty, points, a, b, c, d, correct] =
        dataRows[i];
      const lineNum = i + 2; // +2: bỏ tiêu đề + index 0-based

      // Bỏ qua dòng hoàn toàn trống
      if (!content && !a) continue;

      // Validate từng trường
      if (!content) {
        errors.push({
          line: lineNum,
          reason: "Thiếu nội dung câu hỏi (cột A)",
        });
        continue;
      }
      if (!a || !b || !c || !d) {
        errors.push({
          line: lineNum,
          reason: "Thiếu đáp án A/B/C/D (cột F-I)",
        });
        continue;
      }
      if (!correct) {
        errors.push({ line: lineNum, reason: "Thiếu đáp án đúng (cột J)" });
        continue;
      }

      const correctKey = String(correct).toUpperCase().trim();
      if (!["A", "B", "C", "D"].includes(correctKey)) {
        errors.push({
          line: lineNum,
          reason: `Đáp án đúng "${correct}" không hợp lệ — phải là A, B, C hoặc D`,
        });
        continue;
      }

      try {
        const questionId = uuidv4();
        await db.query(
          `INSERT INTO questions
             (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', 0, NOW(), NOW())`,
          [
            questionId,
            examId || null,
            String(content).trim(),
            subject || null,
            topic || null,
            difficulty || "medium",
            points || 1,
          ],
        );

        const answerLabels = ["A", "B", "C", "D"];
        const answerValues = [a, b, c, d];
        for (let j = 0; j < 4; j++) {
          await db.query(
            "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
            [
              uuidv4(),
              questionId,
              String(answerValues[j]).trim(),
              answerLabels[j] === correctKey ? 1 : 0,
              j,
            ],
          );
        }
        created++;
      } catch {
        errors.push({ line: lineNum, reason: "Lỗi lưu vào database" });
      }
    }

    return res.status(200).json({
      message: `Upload thành công ${created} câu hỏi.`,
      created,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    console.error("[questionController.uploadQuestions]", err);
    return res
      .status(400)
      .json({ message: "File không đúng định dạng. Vui lòng kiểm tra lại." });
  }
}

// ============================================================
// POST /api/teacher/questions/ai-generate
// Tạo câu hỏi tự động bằng Groq AI
//
// Body: { examId, subject, topic, count, difficulty }
//
// Groq tương thích 100% chuẩn OpenAI Chat Completions.
// Chỉ cần sửa .env:
//   AI_BASE_URL=https://api.groq.com/openai/v1
//   AI_API_KEY=gsk_...
//   AI_MODEL=llama3-8b-8192
// Không cần sửa gì trong controller này.
// ============================================================
async function generateQuestionsWithAI(req, res) {
  const { examId, subject, topic, count = 5, difficulty = "medium" } = req.body;

  if (!subject || !topic) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập môn học và chủ đề." });
  }

  // Prompt yêu cầu AI trả về JSON thuần để dễ parse
  const prompt = `Hãy tạo ${count} câu hỏi trắc nghiệm bằng tiếng Việt về môn "${subject}", chủ đề "${topic}", mức độ ${difficulty}.
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

  try {
    // Gọi Groq (cú pháp giống hệt OpenAI)
    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "llama3-8b-8192",
      messages: [{ role: "user", content: prompt }],
      max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
    });

    const rawText = completion.choices[0]?.message?.content ?? "";

    // Trích xuất JSON — AI đôi khi bọc trong ```json ... ```
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI không trả về JSON hợp lệ.");

    const questions = JSON.parse(jsonMatch[0]);
    let created = 0;

    for (const q of questions) {
      if (!q.content || !q.answers?.length) continue;

      const questionId = uuidv4();
      await db.query(
        `INSERT INTO questions
           (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'ai', 0, NOW(), NOW())`,
        [
          questionId,
          examId || null,
          q.content.trim(),
          subject,
          topic,
          difficulty,
        ],
      );

      for (let i = 0; i < q.answers.length; i++) {
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [
            uuidv4(),
            questionId,
            q.answers[i].content.trim(),
            q.answers[i].isCorrect ? 1 : 0,
            i,
          ],
        );
      }
      created++;
    }

    return res.status(200).json({
      message: `Groq AI đã tạo ${created} câu hỏi và lưu vào ngân hàng.`,
      created,
    });
  } catch (err) {
    console.error("[questionController.generateQuestionsWithAI]", err);
    return res.status(500).json({
      message:
        "AI không phản hồi hoặc trả về dữ liệu không hợp lệ. Vui lòng thử lại.",
    });
  }
}

module.exports = {
  getQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestions,
  generateQuestionsWithAI,
};
