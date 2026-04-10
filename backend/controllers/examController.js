// ============================================================
// examController.js — Vào phòng thi, nộp bài, chấm điểm
//
// Routes:
//   POST /api/student/exams/:examId/start
//   POST /api/student/exams/:attemptId/submit
//   POST /api/student/violations
// ============================================================

const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const ai = require("../config/ai"); // Groq AI client

// ============================================================
// Hàm tiện ích: xáo trộn mảng (Fisher-Yates shuffle)
// Dùng để xáo trộn câu hỏi và đáp án độc lập cho từng học sinh
// ============================================================
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// POST /api/student/exams/:examId/start
// Học sinh bắt đầu vào phòng thi
//
// Luồng kiểm tra (đúng với UC56 trong báo cáo):
//   1. Học sinh phải thuộc lớp được giao đề
//   2. Đề thi phải trong khung giờ cho phép
//   3. Số lần thi chưa vượt max_attempts
// ============================================================
async function startExam(req, res) {
  const { examId } = req.params;
  const studentId = req.user.id;

  try {
    // --------------------------------------------------------
    // BƯỚC 1: Lấy thông tin đề thi
    // --------------------------------------------------------
    const [exams] = await db.query(
      "SELECT * FROM exams WHERE id = ? AND is_published = 1 LIMIT 1",
      [examId],
    );
    if (!exams.length)
      return res.status(404).json({ message: "Không tìm thấy đề thi." });
    const exam = exams[0];

    // --------------------------------------------------------
    // BƯỚC 2: Kiểm tra học sinh thuộc lớp được giao đề
    // --------------------------------------------------------
    const [enrollment] = await db.query(
      `SELECT ce.id FROM class_enrollments ce
       JOIN exam_classes ec ON ce.class_id = ec.class_id
       WHERE ec.exam_id = ? AND ce.student_id = ? LIMIT 1`,
      [examId, studentId],
    );
    if (!enrollment.length) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền tham gia bài thi này." });
    }

    // --------------------------------------------------------
    // BƯỚC 3: Kiểm tra khung giờ (chỉ áp dụng với scheduled)
    // --------------------------------------------------------
    if (exam.exam_type === "scheduled") {
      const now = new Date();
      const startTime = new Date(exam.start_time);
      const endTime = new Date(exam.end_time);

      if (now < startTime) {
        return res
          .status(403)
          .json({
            message: `Chưa đến giờ thi. Giờ mở đề: ${startTime.toLocaleString("vi-VN")}`,
          });
      }
      if (now > endTime) {
        return res.status(403).json({ message: "Đã hết thời gian thi." });
      }
    }

    // --------------------------------------------------------
    // BƯỚC 4: Kiểm tra số lần thi
    // max_attempts = 0 nghĩa là không giới hạn
    // --------------------------------------------------------
    const [[{ attemptCount }]] = await db.query(
      "SELECT COUNT(*) AS attemptCount FROM exam_attempts WHERE exam_id = ? AND student_id = ? AND is_completed = 1",
      [examId, studentId],
    );
    if (exam.max_attempts > 0 && attemptCount >= exam.max_attempts) {
      return res
        .status(403)
        .json({ message: "Bạn đã sử dụng hết số lần thi cho phép." });
    }

    // --------------------------------------------------------
    // BƯỚC 5: Tạo bản ghi lần thi mới trong exam_attempts
    // --------------------------------------------------------
    const attemptId = uuidv4();
    await db.query(
      `INSERT INTO exam_attempts (id, student_id, exam_id, started_at, is_completed)
       VALUES (?, ?, ?, NOW(), 0)`,
      [attemptId, studentId, examId],
    );

    // --------------------------------------------------------
    // BƯỚC 6: Lấy danh sách câu hỏi + đáp án
    // QUAN TRỌNG: KHÔNG trả về is_correct trong lúc thi
    // --------------------------------------------------------
    let [questions] = await db.query(
      `SELECT q.id, q.content, q.points
       FROM questions q
       WHERE q.exam_id = ?
       ORDER BY q.order_index`,
      [examId],
    );

    // Xáo trộn câu hỏi nếu cấu hình bật
    if (exam.shuffle_question) questions = shuffle(questions);

    // Lấy đáp án cho từng câu, xáo trộn nếu cần
    const questionsWithAnswers = await Promise.all(
      questions.map(async (q) => {
        let [answers] = await db.query(
          "SELECT id, content, order_index FROM answers WHERE question_id = ? ORDER BY order_index",
          [q.id],
          // KHÔNG SELECT is_correct — bảo mật đề thi
        );
        if (exam.shuffle_answer) answers = shuffle(answers);
        return {
          id: q.id,
          content: q.content,
          points: q.points,
          answers: answers.map((a) => ({ id: a.id, content: a.content })),
        };
      }),
    );

    return res.status(200).json({
      attemptId,
      examTitle: exam.title,
      timeLimit: exam.time_limit, // phút
      questions: questionsWithAnswers,
    });
  } catch (err) {
    console.error("[examController.startExam]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/student/exams/:attemptId/submit
// Học sinh nộp bài — chấm điểm tự động + gọi AI giải thích
//
// Body: { answers: [{ questionId, selectedAnswerId }] }
//
// Luồng (đúng với UC58 trong báo cáo):
//   1. Lưu câu trả lời vào answer_records
//   2. Chấm điểm tự động
//   3. Lưu kết quả vào exam_attempts (score, correct_count,...)
//   4. Gọi AI sinh giải thích đáp án (bất đồng bộ)
// ============================================================
async function submitExam(req, res) {
  const { attemptId } = req.params;
  const { answers } = req.body; // [{ questionId, selectedAnswerId }]
  const studentId = req.user.id;

  try {
    // Kiểm tra lần thi tồn tại và thuộc về học sinh này
    const [attempts] = await db.query(
      "SELECT * FROM exam_attempts WHERE id = ? AND student_id = ? LIMIT 1",
      [attemptId, studentId],
    );
    if (!attempts.length)
      return res.status(404).json({ message: "Không tìm thấy lần thi." });
    const attempt = attempts[0];

    if (attempt.is_completed) {
      return res.status(400).json({ message: "Bài thi này đã được nộp rồi." });
    }

    // --------------------------------------------------------
    // BƯỚC 1: Lấy tất cả câu hỏi + đáp án đúng của đề thi
    // --------------------------------------------------------
    const [questions] = await db.query(
      "SELECT id, points FROM questions WHERE exam_id = ?",
      [attempt.exam_id],
    );
    const [allAnswers] = await db.query(
      `SELECT a.id, a.question_id, a.is_correct
       FROM answers a
       JOIN questions q ON a.question_id = q.id
       WHERE q.exam_id = ?`,
      [attempt.exam_id],
    );

    // Map để tra cứu nhanh: answerId → isCorrect
    const answerCorrectMap = {};
    allAnswers.forEach((a) => {
      answerCorrectMap[a.id] = a.is_correct === 1;
    });

    // Map để tra cứu đáp án đúng của từng câu: questionId → answerId
    const correctAnswerMap = {};
    allAnswers
      .filter((a) => a.is_correct === 1)
      .forEach((a) => {
        correctAnswerMap[a.question_id] = a.id;
      });

    // --------------------------------------------------------
    // BƯỚC 2: Lưu câu trả lời + chấm đúng/sai từng câu
    // --------------------------------------------------------
    let correctCount = 0;
    let totalPoints = 0;
    let earnedPoints = 0;

    const answerMap = {}; // { questionId: selectedAnswerId }
    (answers || []).forEach((a) => {
      answerMap[a.questionId] = a.selectedAnswerId;
    });

    for (const q of questions) {
      const selectedAnswerId = answerMap[q.id] || null;
      const isCorrect = selectedAnswerId
        ? answerCorrectMap[selectedAnswerId] === true
        : false;

      await db.query(
        `INSERT INTO answer_records (id, attempt_id, question_id, selected_answer_id, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [uuidv4(), attemptId, q.id, selectedAnswerId, isCorrect ? 1 : 0],
      );

      totalPoints += q.points;
      if (isCorrect) {
        correctCount++;
        earnedPoints += q.points;
      }
    }

    // Tính điểm theo thang 10
    const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 10 : 0;

    // --------------------------------------------------------
    // BƯỚC 3: Cập nhật kết quả vào exam_attempts
    // --------------------------------------------------------
    await db.query(
      `UPDATE exam_attempts
       SET score = ?, total_points = ?, correct_count = ?, total_questions = ?,
           finished_at = NOW(), is_completed = 1
       WHERE id = ?`,
      [
        parseFloat(score.toFixed(2)),
        totalPoints,
        correctCount,
        questions.length,
        attemptId,
      ],
    );

    // --------------------------------------------------------
    // BƯỚC 4: Trả kết quả ngay cho học sinh
    // Gọi AI bất đồng bộ — không làm học sinh chờ
    // --------------------------------------------------------
    res.status(200).json({
      message: "Nộp bài thành công.",
      score: parseFloat(score.toFixed(2)),
      correctCount,
      totalQuestions: questions.length,
      totalPoints,
    });

    // --------------------------------------------------------
    // BƯỚC 5 (bất đồng bộ): Gọi AI sinh giải thích đáp án
    // Lưu kết quả vào cột ai_explanation (LONGTEXT) của exam_attempts
    // --------------------------------------------------------
    generateAIExplanation(
      attemptId,
      attempt.exam_id,
      answerMap,
      correctAnswerMap,
    ).catch((err) => {
      console.error(
        "[examController.generateAIExplanation] AI error:",
        err.message,
      );
    });
  } catch (err) {
    console.error("[examController.submitExam]", err);
    // Nếu res chưa được gửi thì trả lỗi
    if (!res.headersSent) {
      return res.status(500).json({ message: "Lỗi server khi nộp bài." });
    }
  }
}

// ============================================================
// Hàm bất đồng bộ: gọi Groq AI sinh giải thích đáp án
// Gọi sau khi đã trả kết quả cho học sinh rồi
// ============================================================
async function generateAIExplanation(
  attemptId,
  examId,
  answerMap,
  correctAnswerMap,
) {
  // Lấy toàn bộ câu hỏi + đáp án của đề thi
  const [questions] = await db.query(
    `SELECT q.id, q.content,
            (SELECT content FROM answers WHERE question_id = q.id AND is_correct = 1 LIMIT 1) AS correct_answer
     FROM questions q WHERE q.exam_id = ?`,
    [examId],
  );

  if (!questions.length) return;

  // Xây dựng nội dung gửi lên AI
  const examSummary = questions
    .map((q, i) => {
      const selectedId = answerMap[q.id];
      const isCorrect = selectedId && correctAnswerMap[q.id] === selectedId;
      return `Câu ${i + 1}: ${q.content}\nĐáp án đúng: ${q.correct_answer}\nHọc sinh trả lời: ${isCorrect ? "ĐÚNG" : "SAI"}`;
    })
    .join("\n\n");

  const prompt = `Dưới đây là kết quả bài thi trắc nghiệm của học sinh. Hãy giải thích ngắn gọn tại sao đáp án đúng là đúng cho từng câu, bằng tiếng Việt, dễ hiểu:

${examSummary}

Trả lời theo định dạng:
Câu 1: [giải thích]
Câu 2: [giải thích]
...`;

  const completion = await ai.chat.completions.create({
    model: process.env.AI_MODEL || "llama3-8b-8192",
    messages: [{ role: "user", content: prompt }],
    max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
  });

  const explanation = completion.choices[0]?.message?.content ?? "";

  // Lưu giải thích vào DB
  await db.query("UPDATE exam_attempts SET ai_explanation = ? WHERE id = ?", [
    explanation,
    attemptId,
  ]);
}

// ============================================================
// POST /api/student/violations
// Học sinh báo vi phạm — Frontend gửi khi phát hiện
// Body: { attemptId, type, description }
//
// type: 'tab_switch' | 'copy_paste' | 'exit_fullscreen'
// Socket.IO sẽ notify giáo viên trong socketServer.js
// ============================================================
async function recordViolation(req, res) {
  const { attemptId, type, description } = req.body;
  const studentId = req.user.id;

  if (!attemptId || !type) {
    return res.status(400).json({ message: "Thiếu thông tin vi phạm." });
  }

  try {
    await db.query(
      `INSERT INTO violations (id, attempt_id, student_id, type, description, detected_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [uuidv4(), attemptId, studentId, type, description || null],
    );
    return res.status(201).json({ message: "Đã ghi nhận vi phạm." });
  } catch (err) {
    console.error("[examController.recordViolation]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = { startExam, submitExam, recordViolation };
