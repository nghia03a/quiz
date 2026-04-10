// ============================================================
// teacherController.js — Lớp học, câu hỏi, đề thi, kết quả
//
// Các route sử dụng file này:
//   GET    /api/teacher/dashboard
//   GET    /api/teacher/classes
//   POST   /api/teacher/classes
//   PUT    /api/teacher/classes/:id
//   DELETE /api/teacher/classes/:id
//   GET    /api/teacher/classes/:id
//   DELETE /api/teacher/classes/:classId/students/:studentId
//   GET    /api/teacher/questions
//   POST   /api/teacher/questions
//   PUT    /api/teacher/questions/:id
//   DELETE /api/teacher/questions/:id
//   POST   /api/teacher/questions/upload
//   POST   /api/teacher/questions/ai-generate
//   GET    /api/teacher/exams
//   GET    /api/teacher/exams/:id
//   POST   /api/teacher/exams
//   PUT    /api/teacher/exams/:id
//   DELETE /api/teacher/exams/:id
//   GET    /api/teacher/exams/:id/results
//   GET    /api/teacher/exams/:id/export
// ============================================================

const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const ai = require("../config/ai"); // Groq/AI client
const xlsx = require("xlsx");

// ============================================================
// GET /api/teacher/dashboard
// Thống kê tổng quan + đề thi đang mở + danh sách lớp
// ============================================================
async function getDashboard(req, res) {
  const teacherId = req.user.id;
  try {
    const [[{ totalClasses }]] = await db.query(
      "SELECT COUNT(*) AS totalClasses  FROM classes WHERE teacher_id = ?",
      [teacherId],
    );
    const [[{ totalStudents }]] = await db.query(
      `SELECT COUNT(DISTINCT ce.student_id) AS totalStudents
       FROM class_enrollments ce
       JOIN classes c ON ce.class_id = c.id
       WHERE c.teacher_id = ?`,
      [teacherId],
    );
    const [[{ totalQuestions }]] = await db.query(
      `SELECT COUNT(*) AS totalQuestions FROM questions q
       JOIN exams e ON q.exam_id = e.id WHERE e.teacher_id = ?`,
      [teacherId],
    );
    const [[{ totalExams }]] = await db.query(
      "SELECT COUNT(*) AS totalExams FROM exams WHERE teacher_id = ?",
      [teacherId],
    );

    // Đề thi đang trong khung giờ hoặc tự do + đã xuất bản
    const [activeExams] = await db.query(
      `SELECT e.id, e.title, e.exam_type, e.start_time, e.end_time,
              (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id) AS attempt_count
       FROM exams e
       WHERE e.teacher_id = ? AND e.is_published = 1
         AND (e.exam_type = 'free' OR (NOW() BETWEEN e.start_time AND e.end_time))
       ORDER BY e.start_time DESC LIMIT 10`,
      [teacherId],
    );

    const [classes] = await db.query(
      `SELECT c.id, c.name, c.code,
              (SELECT COUNT(*) FROM class_enrollments ce WHERE ce.class_id = c.id) AS student_count,
              (SELECT COUNT(*) FROM exam_classes ec WHERE ec.class_id = c.id) AS exam_count
       FROM classes c WHERE c.teacher_id = ? ORDER BY c.created_at DESC LIMIT 10`,
      [teacherId],
    );

    return res.status(200).json({
      teacherName: req.user.fullName,
      totalClasses,
      totalStudents,
      totalQuestions,
      totalExams,
      activeExams: activeExams.map((e) => ({
        id: e.id,
        title: e.title,
        examType: e.exam_type,
        startTime: e.start_time,
        endTime: e.end_time,
        attemptCount: e.attempt_count,
      })),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        studentCount: c.student_count,
        examCount: c.exam_count,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getDashboard]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// LỚP HỌC
// ============================================================

// Hàm tiện ích tạo mã lớp 6 ký tự duy nhất (chữ + số)
async function generateClassCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code, exists;
  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
    const [rows] = await db.query(
      "SELECT id FROM classes WHERE code = ? LIMIT 1",
      [code],
    );
    exists = rows.length > 0;
  } while (exists);
  return code;
}

async function getClasses(req, res) {
  const teacherId = req.user.id;
  try {
    const [classes] = await db.query(
      `SELECT c.id, c.name, c.code, c.description, c.created_at,
              (SELECT COUNT(*) FROM class_enrollments ce WHERE ce.class_id = c.id) AS student_count,
              (SELECT COUNT(*) FROM exam_classes ec WHERE ec.class_id = c.id) AS exam_count
       FROM classes c WHERE c.teacher_id = ? ORDER BY c.created_at DESC`,
      [req.user.id],
    );
    return res.status(200).json({
      teacherName: req.user.fullName,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        description: c.description,
        studentCount: c.student_count,
        examCount: c.exam_count,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getClasses]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function createClass(req, res) {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: "Vui lòng nhập tên lớp." });
  try {
    const code = await generateClassCode();
    const id = uuidv4();
    await db.query(
      "INSERT INTO classes (id, name, code, teacher_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
      [id, name.trim(), code, req.user.id, description?.trim() || null],
    );
    return res
      .status(201)
      .json({ message: "Tạo lớp học thành công.", classId: id, code });
  } catch (err) {
    console.error("[teacherController.createClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function updateClass(req, res) {
  const { id } = req.params;
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ message: "Vui lòng nhập tên lớp." });
  try {
    await db.query(
      "UPDATE classes SET name = ?, description = ?, updated_at = NOW() WHERE id = ? AND teacher_id = ?",
      [name.trim(), description?.trim() || null, id, req.user.id],
    );
    return res.status(200).json({ message: "Cập nhật lớp học thành công." });
  } catch (err) {
    console.error("[teacherController.updateClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function deleteClass(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM classes WHERE id = ? AND teacher_id = ?", [
      id,
      req.user.id,
    ]);
    return res.status(200).json({ message: "Xóa lớp học thành công." });
  } catch (err) {
    console.error("[teacherController.deleteClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function getClassDetail(req, res) {
  const { id } = req.params;
  try {
    const [classes] = await db.query(
      "SELECT * FROM classes WHERE id = ? AND teacher_id = ? LIMIT 1",
      [id, req.user.id],
    );
    if (!classes.length)
      return res.status(404).json({ message: "Không tìm thấy lớp học." });

    const cls = classes[0];
    const [students] = await db.query(
      `SELECT u.id, u.full_name, u.student_id, ce.joined_at
       FROM class_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.class_id = ?
       ORDER BY ce.joined_at DESC`,
      [id],
    );
    const [[{ examCount }]] = await db.query(
      "SELECT COUNT(*) AS examCount FROM exam_classes WHERE class_id = ?",
      [id],
    );

    return res.status(200).json({
      id: cls.id,
      name: cls.name,
      code: cls.code,
      description: cls.description,
      teacherName: req.user.fullName,
      examCount,
      students: students.map((s) => ({
        id: s.id,
        fullName: s.full_name,
        studentId: s.student_id,
        joinedAt: s.joined_at,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getClassDetail]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function removeStudentFromClass(req, res) {
  const { classId, studentId } = req.params;
  try {
    await db.query(
      "DELETE FROM class_enrollments WHERE class_id = ? AND student_id = ?",
      [classId, studentId],
    );
    return res
      .status(200)
      .json({ message: "Xóa học sinh khỏi lớp thành công." });
  } catch (err) {
    console.error("[teacherController.removeStudentFromClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// NGÂN HÀNG CÂU HỎI
// ============================================================

async function getQuestions(req, res) {
  const teacherId = req.user.id;
  try {
    const [questions] = await db.query(
      `SELECT q.id, q.exam_id, q.content, q.subject, q.topic, q.difficulty, q.points, q.source, q.created_at
       FROM questions q
       JOIN exams e ON q.exam_id = e.id
       WHERE e.teacher_id = ?
       ORDER BY q.created_at DESC`,
      [teacherId],
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
        source: q.source,
        createdAt: q.created_at,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getQuestions]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function createQuestion(req, res) {
  const {
    examId,
    content,
    subject,
    topic,
    difficulty,
    points,
    answers,
    source,
  } = req.body;
  if (!content || !answers?.length) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập nội dung câu hỏi và ít nhất 1 đáp án." });
  }
  try {
    const questionId = uuidv4();
    await db.query(
      `INSERT INTO questions (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [
        questionId,
        examId,
        content.trim(),
        subject || null,
        topic || null,
        difficulty || "medium",
        points || 1,
        source || "manual",
      ],
    );
    // Lưu các đáp án
    for (const ans of answers) {
      await db.query(
        "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
        [
          uuidv4(),
          questionId,
          ans.content.trim(),
          ans.isCorrect ? 1 : 0,
          answers.indexOf(ans),
        ],
      );
    }
    return res
      .status(201)
      .json({ message: "Thêm câu hỏi thành công.", questionId });
  } catch (err) {
    console.error("[teacherController.createQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function updateQuestion(req, res) {
  const { id } = req.params;
  const { content, subject, topic, difficulty, points, answers } = req.body;
  if (!content)
    return res.status(400).json({ message: "Vui lòng nhập nội dung câu hỏi." });
  try {
    await db.query(
      "UPDATE questions SET content = ?, subject = ?, topic = ?, difficulty = ?, points = ?, updated_at = NOW() WHERE id = ?",
      [
        content.trim(),
        subject || null,
        topic || null,
        difficulty || "medium",
        points || 1,
        id,
      ],
    );
    if (answers?.length) {
      await db.query("DELETE FROM answers WHERE question_id = ?", [id]);
      for (const ans of answers) {
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [
            uuidv4(),
            id,
            ans.content.trim(),
            ans.isCorrect ? 1 : 0,
            answers.indexOf(ans),
          ],
        );
      }
    }
    return res.status(200).json({ message: "Cập nhật câu hỏi thành công." });
  } catch (err) {
    console.error("[teacherController.updateQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function deleteQuestion(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM questions WHERE id = ?", [id]);
    return res.status(200).json({ message: "Xóa câu hỏi thành công." });
  } catch (err) {
    console.error("[teacherController.deleteQuestion]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/teacher/questions/upload
// Upload câu hỏi từ file Excel
// Cấu trúc file: content | subject | topic | difficulty | points | A | B | C | D | correct(A/B/C/D)
// ============================================================
async function uploadQuestions(req, res) {
  const { examId } = req.body;
  if (!examId) return res.status(400).json({ message: "Thiếu examId." });
  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 },
    );
    const dataRows = rows.slice(1);
    let created = 0;

    for (const row of dataRows) {
      const [content, subject, topic, difficulty, points, a, b, c, d, correct] =
        row;
      if (!content || !a || !b || !c || !d || !correct) continue;

      const questionId = uuidv4();
      await db.query(
        `INSERT INTO questions (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', 0, NOW(), NOW())`,
        [
          questionId,
          examId,
          String(content).trim(),
          subject || null,
          topic || null,
          difficulty || "medium",
          points || 1,
        ],
      );

      const answerMap = { A: a, B: b, C: c, D: d };
      const correctKey = String(correct).toUpperCase().trim();
      for (const [key, val] of Object.entries(answerMap)) {
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [
            uuidv4(),
            questionId,
            String(val).trim(),
            key === correctKey ? 1 : 0,
            ["A", "B", "C", "D"].indexOf(key),
          ],
        );
      }
      created++;
    }
    return res
      .status(200)
      .json({ message: `Upload thành công ${created} câu hỏi.`, created });
  } catch (err) {
    console.error("[teacherController.uploadQuestions]", err);
    return res
      .status(500)
      .json({ message: "Lỗi đọc file. Vui lòng kiểm tra lại định dạng." });
  }
}

// ============================================================
// POST /api/teacher/questions/ai-generate
// Tạo câu hỏi tự động bằng AI (Groq)
// Body: { examId, subject, topic, count, difficulty }
// ============================================================
async function generateQuestionsWithAI(req, res) {
  const { examId, subject, topic, count = 5, difficulty = "medium" } = req.body;

  if (!subject || !topic) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập môn học và chủ đề." });
  }

  // Prompt yêu cầu AI trả về JSON chuẩn để parse được
  const prompt = `Hãy tạo ${count} câu hỏi trắc nghiệm về môn "${subject}", chủ đề "${topic}", mức độ ${difficulty}.
Trả về ĐÚNG định dạng JSON sau, không thêm bất kỳ văn bản nào khác:
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
Lưu ý: chỉ đúng 1 đáp án isCorrect: true trong mỗi câu.`;

  try {
    // Gọi Groq API (tương thích chuẩn OpenAI Chat Completions)
    const completion = await ai.chat.completions.create({
      model: process.env.AI_MODEL || "llama3-8b-8192",
      messages: [{ role: "user", content: prompt }],
      max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 2000,
    });

    const rawText = completion.choices[0]?.message?.content ?? "";

    // Trích xuất JSON từ response (AI đôi khi thêm markdown)
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI không trả về định dạng JSON hợp lệ.");

    const questions = JSON.parse(jsonMatch[0]);
    let created = 0;

    for (const q of questions) {
      if (!q.content || !q.answers?.length) continue;
      const questionId = uuidv4();
      await db.query(
        `INSERT INTO questions (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
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
        const ans = q.answers[i];
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [uuidv4(), questionId, ans.content.trim(), ans.isCorrect ? 1 : 0, i],
        );
      }
      created++;
    }

    return res.status(200).json({
      message: `AI đã tạo ${created} câu hỏi và lưu vào ngân hàng.`,
      created,
    });
  } catch (err) {
    console.error("[teacherController.generateQuestionsWithAI]", err);
    return res
      .status(500)
      .json({
        message:
          "AI không phản hồi hoặc trả về dữ liệu không hợp lệ. Vui lòng thử lại.",
      });
  }
}

// ============================================================
// ĐỀ THI
// ============================================================

async function getExams(req, res) {
  try {
    const [exams] = await db.query(
      `SELECT e.id, e.title, e.exam_type, e.time_limit, e.max_attempts,
              e.start_time, e.end_time, e.is_published, e.shuffle_question, e.shuffle_answer,
              (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count
       FROM exams e
       WHERE e.teacher_id = ?
       ORDER BY e.created_at DESC`,
      [req.user.id],
    );
    return res.status(200).json({
      teacherName: req.user.fullName,
      exams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        examType: e.exam_type,
        timeLimit: e.time_limit,
        maxAttempts: e.max_attempts,
        startTime: e.start_time,
        endTime: e.end_time,
        isPublished: e.is_published === 1,
        questionCount: e.question_count,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getExams]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function getExamById(req, res) {
  const { id } = req.params;
  try {
    const [exams] = await db.query(
      "SELECT * FROM exams WHERE id = ? AND teacher_id = ? LIMIT 1",
      [id, req.user.id],
    );
    if (!exams.length)
      return res.status(404).json({ message: "Không tìm thấy đề thi." });
    const exam = exams[0];

    const [questionIds] = await db.query(
      "SELECT id FROM questions WHERE exam_id = ?",
      [id],
    );
    const [classIds] = await db.query(
      "SELECT class_id FROM exam_classes WHERE exam_id = ?",
      [id],
    );

    return res.status(200).json({
      id: exam.id,
      title: exam.title,
      examType: exam.exam_type,
      timeLimit: exam.time_limit,
      maxAttempts: exam.max_attempts,
      startTime: exam.start_time,
      endTime: exam.end_time,
      isPublished: exam.is_published === 1,
      shuffleQuestion: exam.shuffle_question === 1,
      shuffleAnswer: exam.shuffle_answer === 1,
      questionIds: questionIds.map((q) => q.id),
      classIds: classIds.map((c) => c.class_id),
      teacherName: req.user.fullName,
    });
  } catch (err) {
    console.error("[teacherController.getExamById]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function createExam(req, res) {
  const {
    title,
    timeLimit,
    maxAttempts,
    examType,
    startTime,
    endTime,
    shuffleQuestion,
    shuffleAnswer,
    questionIds,
    classIds,
    isPublished,
  } = req.body;

  if (!title)
    return res.status(400).json({ message: "Vui lòng nhập tiêu đề đề thi." });
  if (!questionIds?.length)
    return res
      .status(400)
      .json({ message: "Vui lòng chọn ít nhất 1 câu hỏi." });

  try {
    const examId = uuidv4();
    await db.query(
      `INSERT INTO exams (id, title, teacher_id, time_limit, max_attempts, exam_type, start_time, end_time,
                          is_published, shuffle_question, shuffle_answer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        examId,
        title.trim(),
        req.user.id,
        timeLimit || 30,
        maxAttempts || 1,
        examType || "scheduled",
        startTime || null,
        endTime || null,
        isPublished ? 1 : 0,
        shuffleQuestion !== false ? 1 : 0,
        shuffleAnswer !== false ? 1 : 0,
      ],
    );

    // Cập nhật exam_id cho các câu hỏi được chọn
    if (questionIds?.length) {
      await db.query(
        `UPDATE questions SET exam_id = ? WHERE id IN (${questionIds.map(() => "?").join(",")})`,
        [examId, ...questionIds],
      );
    }

    // Giao đề cho các lớp + tạo thông báo cho học sinh
    if (classIds?.length) {
      for (const classId of classIds) {
        await db.query(
          "INSERT INTO exam_classes (id, exam_id, class_id, assigned_at) VALUES (?, ?, ?, NOW())",
          [uuidv4(), examId, classId],
        );
        // Tạo thông báo cho tất cả học sinh trong lớp
        if (isPublished) {
          const [students] = await db.query(
            "SELECT student_id FROM class_enrollments WHERE class_id = ?",
            [classId],
          );
          for (const s of students) {
            await db.query(
              `INSERT INTO notifications (id, user_id, exam_id, title, content, type, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, 'exam_assigned', 0, NOW())`,
              [
                uuidv4(),
                s.student_id,
                examId,
                `Bài thi mới: ${title}`,
                `Bạn được phân công bài thi "${title}". Vui lòng xem lịch thi để biết thêm chi tiết.`,
              ],
            );
          }
        }
      }
    }

    return res.status(201).json({ message: "Tạo đề thi thành công.", examId });
  } catch (err) {
    console.error("[teacherController.createExam]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function updateExam(req, res) {
  const { id } = req.params;
  const {
    title,
    timeLimit,
    maxAttempts,
    examType,
    startTime,
    endTime,
    shuffleQuestion,
    shuffleAnswer,
    questionIds,
    classIds,
    isPublished,
  } = req.body;

  try {
    await db.query(
      `UPDATE exams SET title = ?, time_limit = ?, max_attempts = ?, exam_type = ?,
                        start_time = ?, end_time = ?, is_published = ?,
                        shuffle_question = ?, shuffle_answer = ?, updated_at = NOW()
       WHERE id = ? AND teacher_id = ?`,
      [
        title,
        timeLimit || 30,
        maxAttempts || 1,
        examType || "scheduled",
        startTime || null,
        endTime || null,
        isPublished ? 1 : 0,
        shuffleQuestion !== false ? 1 : 0,
        shuffleAnswer !== false ? 1 : 0,
        id,
        req.user.id,
      ],
    );

    // Cập nhật câu hỏi
    if (questionIds?.length) {
      await db.query(
        `UPDATE questions SET exam_id = ? WHERE id IN (${questionIds.map(() => "?").join(",")})`,
        [id, ...questionIds],
      );
    }

    // Cập nhật lớp được giao
    if (classIds !== undefined) {
      await db.query("DELETE FROM exam_classes WHERE exam_id = ?", [id]);
      for (const classId of classIds) {
        await db.query(
          "INSERT INTO exam_classes (id, exam_id, class_id, assigned_at) VALUES (?, ?, ?, NOW())",
          [uuidv4(), id, classId],
        );
      }
    }

    return res.status(200).json({ message: "Cập nhật đề thi thành công." });
  } catch (err) {
    console.error("[teacherController.updateExam]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

async function deleteExam(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM exams WHERE id = ? AND teacher_id = ?", [
      id,
      req.user.id,
    ]);
    return res.status(200).json({ message: "Xóa đề thi thành công." });
  } catch (err) {
    console.error("[teacherController.deleteExam]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/teacher/exams/:id/results
// Xem kết quả toàn bộ học sinh của 1 đề thi
// ============================================================
async function getExamResults(req, res) {
  const { id } = req.params;
  try {
    const [attempts] = await db.query(
      `SELECT ea.id, u.student_id, u.full_name, ea.score, ea.correct_count,
              ea.total_questions, ea.started_at, ea.finished_at,
              (SELECT COUNT(*) FROM violations v WHERE v.attempt_id = ea.id) AS violation_count
       FROM exam_attempts ea
       JOIN users u ON ea.student_id = u.id
       WHERE ea.exam_id = ? AND ea.is_completed = 1
       ORDER BY ea.score DESC`,
      [id],
    );

    const scores = attempts.map((a) => a.score ?? 0);
    return res.status(200).json({
      attempts: attempts.map((a) => ({
        id: a.id,
        studentId: a.student_id,
        fullName: a.full_name,
        score: a.score,
        correctCount: a.correct_count,
        totalQuestions: a.total_questions,
        violationCount: a.violation_count,
        finishedAt: a.finished_at,
      })),
    });
  } catch (err) {
    console.error("[teacherController.getExamResults]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/teacher/exams/:id/export?token=...
// Xuất kết quả ra file Excel
// ============================================================
async function exportResults(req, res) {
  const { id } = req.params;
  try {
    const [attempts] = await db.query(
      `SELECT u.student_id, u.full_name, ea.score, ea.correct_count, ea.total_questions, ea.finished_at,
              (SELECT COUNT(*) FROM violations v WHERE v.attempt_id = ea.id) AS violations
       FROM exam_attempts ea
       JOIN users u ON ea.student_id = u.id
       WHERE ea.exam_id = ? AND ea.is_completed = 1
       ORDER BY ea.score DESC`,
      [id],
    );

    const [[exam]] = await db.query("SELECT title FROM exams WHERE id = ?", [
      id,
    ]);

    const wsData = [
      [
        "Mã số HS",
        "Họ và tên",
        "Điểm",
        "Số câu đúng",
        "Tổng câu",
        "Vi phạm",
        "Thời gian nộp",
      ],
      ...attempts.map((a) => [
        a.student_id,
        a.full_name,
        a.score,
        a.correct_count,
        a.total_questions,
        a.violations,
        a.finished_at ? new Date(a.finished_at).toLocaleString("vi-VN") : "",
      ]),
    ];

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, "Kết quả");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `ketqua_${exam?.title ?? id}.xlsx`;
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return res.send(buffer);
  } catch (err) {
    console.error("[teacherController.exportResults]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = {
  getDashboard,
  getClasses,
  createClass,
  updateClass,
  deleteClass,
  getClassDetail,
  removeStudentFromClass,
  getQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuestions,
  generateQuestionsWithAI,
  getExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  getExamResults,
  exportResults,
};
