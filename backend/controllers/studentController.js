// ============================================================
// studentController.js — Dashboard, lớp học, lịch thi, lịch sử
//
// Routes:
//   GET  /api/student/dashboard
//   GET  /api/student/classes
//   POST /api/student/classes/join
//   POST /api/student/classes/:id/leave
//   GET  /api/student/exams
//   GET  /api/student/history
//   GET  /api/student/results/:attemptId
// ============================================================

const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");

// ============================================================
// GET /api/student/dashboard
// ============================================================
async function getDashboard(req, res) {
  const studentId = req.user.id;
  try {
    const [[{ totalClasses }]] = await db.query(
      "SELECT COUNT(*) AS totalClasses FROM class_enrollments WHERE student_id = ?",
      [studentId],
    );
    const [[{ totalDone }]] = await db.query(
      "SELECT COUNT(*) AS totalDone FROM exam_attempts WHERE student_id = ? AND is_completed = 1",
      [studentId],
    );
    const [[{ avgScore }]] = await db.query(
      "SELECT AVG(score) AS avgScore FROM exam_attempts WHERE student_id = ? AND is_completed = 1",
      [studentId],
    );

    // Bài thi sắp tới (đã được giao, chưa làm hoặc chưa hết hạn)
    const [upcoming] = await db.query(
      `SELECT DISTINCT e.id, e.title, e.exam_type, e.start_time, e.end_time, c.name AS class_name
       FROM exams e
       JOIN exam_classes ec ON e.id = ec.exam_id
       JOIN class_enrollments ce ON ec.class_id = ce.class_id
       JOIN classes c ON ec.class_id = c.id
       WHERE ce.student_id = ? AND e.is_published = 1
         AND (e.exam_type = 'free' OR e.end_time >= NOW())
       ORDER BY e.start_time ASC LIMIT 5`,
      [studentId],
    );

    // 5 kết quả gần nhất
    const [recent] = await db.query(
      `SELECT ea.id, e.title AS exam_title, ea.score, ea.correct_count, ea.total_questions, ea.finished_at
       FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       WHERE ea.student_id = ? AND ea.is_completed = 1
       ORDER BY ea.finished_at DESC LIMIT 5`,
      [studentId],
    );

    return res.status(200).json({
      fullName: req.user.fullName,
      totalClasses,
      totalDone,
      avgScore,
      upcoming: upcoming.map((e) => ({
        id: e.id,
        title: e.title,
        examType: e.exam_type,
        startTime: e.start_time,
        endTime: e.end_time,
        className: e.class_name,
      })),
      recent: recent.map((r) => ({
        examTitle: r.exam_title,
        score: r.score,
        correctCount: r.correct_count,
        totalQuestions: r.total_questions,
        finishedAt: r.finished_at,
      })),
    });
  } catch (err) {
    console.error("[studentController.getDashboard]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/student/classes
// ============================================================
async function getClasses(req, res) {
  const studentId = req.user.id;
  try {
    const [classes] = await db.query(
      `SELECT c.id, c.name, c.code, c.description, u.full_name AS teacher_name, ce.joined_at,
              (SELECT COUNT(*) FROM exam_classes ec WHERE ec.class_id = c.id) AS exam_count
       FROM class_enrollments ce
       JOIN classes c ON ce.class_id = c.id
       JOIN users u ON c.teacher_id = u.id
       WHERE ce.student_id = ?
       ORDER BY ce.joined_at DESC`,
      [studentId],
    );
    return res.status(200).json({
      fullName: req.user.fullName,
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        description: c.description,
        teacherName: c.teacher_name,
        examCount: c.exam_count,
        joinedAt: c.joined_at,
      })),
    });
  } catch (err) {
    console.error("[studentController.getClasses]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/student/classes/join
// Body: { code } — mã lớp 6 ký tự
// ============================================================
async function joinClass(req, res) {
  const { code } = req.body;
  const studentId = req.user.id;

  if (!code) return res.status(400).json({ message: "Vui lòng nhập mã lớp." });

  try {
    // Tìm lớp theo mã
    const [classes] = await db.query(
      "SELECT * FROM classes WHERE code = ? LIMIT 1",
      [code.toUpperCase().trim()],
    );
    if (!classes.length)
      return res
        .status(404)
        .json({ message: "Mã lớp không hợp lệ hoặc không tồn tại." });

    const cls = classes[0];

    // Kiểm tra đã tham gia chưa
    const [existing] = await db.query(
      "SELECT id FROM class_enrollments WHERE class_id = ? AND student_id = ? LIMIT 1",
      [cls.id, studentId],
    );
    if (existing.length)
      return res.status(409).json({ message: "Bạn đã tham gia lớp này rồi." });

    await db.query(
      "INSERT INTO class_enrollments (id, class_id, student_id, joined_at) VALUES (?, ?, ?, NOW())",
      [uuidv4(), cls.id, studentId],
    );

    return res
      .status(200)
      .json({ message: "Tham gia lớp học thành công.", className: cls.name });
  } catch (err) {
    console.error("[studentController.joinClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/student/classes/:id/leave
// ============================================================
async function leaveClass(req, res) {
  const { id } = req.params;
  try {
    await db.query(
      "DELETE FROM class_enrollments WHERE class_id = ? AND student_id = ?",
      [id, req.user.id],
    );
    return res.status(200).json({ message: "Rời lớp học thành công." });
  } catch (err) {
    console.error("[studentController.leaveClass]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/student/exams?classId=...
// Danh sách đề thi được phân công
// ============================================================
async function getExams(req, res) {
  const studentId = req.user.id;
  const { classId } = req.query;

  try {
    let query = `
      SELECT DISTINCT e.id, e.title, e.exam_type, e.time_limit, e.max_attempts,
                      e.start_time, e.end_time, c.name AS class_name, c.id AS class_id,
                      (SELECT COUNT(*) FROM exam_attempts ea
                       WHERE ea.exam_id = e.id AND ea.student_id = ?) AS attempt_count,
                      (SELECT id FROM exam_attempts ea
                       WHERE ea.exam_id = e.id AND ea.student_id = ? AND ea.is_completed = 1
                       ORDER BY ea.finished_at DESC LIMIT 1) AS last_attempt_id
      FROM exams e
      JOIN exam_classes ec ON e.id = ec.exam_id
      JOIN class_enrollments ce ON ec.class_id = ce.class_id
      JOIN classes c ON ec.class_id = c.id
      WHERE ce.student_id = ? AND e.is_published = 1`;

    const params = [studentId, studentId, studentId];
    if (classId) {
      query += " AND ec.class_id = ?";
      params.push(classId);
    }
    query += " ORDER BY e.start_time DESC";

    const [exams] = await db.query(query, params);
    return res.status(200).json({
      fullName: req.user.fullName,
      exams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        examType: e.exam_type,
        timeLimit: e.time_limit,
        maxAttempts: e.max_attempts,
        startTime: e.start_time,
        endTime: e.end_time,
        className: e.class_name,
        classId: e.class_id,
        attemptCount: e.attempt_count,
        isDone: e.attempt_count >= e.max_attempts && e.max_attempts > 0,
        lastAttemptId: e.last_attempt_id,
      })),
    });
  } catch (err) {
    console.error("[studentController.getExams]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/student/history
// Lịch sử toàn bộ bài thi đã làm
// ============================================================
async function getHistory(req, res) {
  try {
    const [attempts] = await db.query(
      `SELECT ea.id, e.title AS exam_title, c.name AS class_name,
              ea.score, ea.correct_count, ea.total_questions, ea.finished_at
       FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       LEFT JOIN exam_classes ec ON ec.exam_id = e.id
       LEFT JOIN classes c ON ec.class_id = c.id
       WHERE ea.student_id = ? AND ea.is_completed = 1
       ORDER BY ea.finished_at DESC`,
      [req.user.id],
    );
    return res.status(200).json({
      fullName: req.user.fullName,
      attempts: attempts.map((a) => ({
        id: a.id,
        examTitle: a.exam_title,
        className: a.class_name,
        score: a.score,
        correctCount: a.correct_count,
        totalQuestions: a.total_questions,
        finishedAt: a.finished_at,
      })),
    });
  } catch (err) {
    console.error("[studentController.getHistory]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/student/results/:attemptId
// Xem kết quả + giải thích đáp án AI sau khi nộp bài
// ============================================================
async function getResult(req, res) {
  const { attemptId } = req.params;
  try {
    const [attempts] = await db.query(
      `SELECT ea.*, e.title AS exam_title, u.full_name AS student_name
       FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       JOIN users u ON ea.student_id = u.id
       WHERE ea.id = ? AND ea.student_id = ? LIMIT 1`,
      [attemptId, req.user.id],
    );
    if (!attempts.length)
      return res.status(404).json({ message: "Không tìm thấy kết quả." });
    const attempt = attempts[0];

    // Lấy chi tiết từng câu hỏi + đáp án + câu đã chọn
    const [questions] = await db.query(
      `SELECT q.id, q.content, q.points,
              ar.selected_answer_id, ar.is_correct AS student_correct
       FROM questions q
       JOIN answer_records ar ON ar.question_id = q.id AND ar.attempt_id = ?
       WHERE q.exam_id = ?
       ORDER BY q.order_index`,
      [attemptId, attempt.exam_id],
    );

    // Với mỗi câu hỏi, lấy tất cả đáp án (kèm is_correct để hiển thị sau khi thi)
    const questionsWithAnswers = await Promise.all(
      questions.map(async (q) => {
        const [answers] = await db.query(
          "SELECT id, content, is_correct, order_index FROM answers WHERE question_id = ? ORDER BY order_index",
          [q.id],
        );
        return {
          id: q.id,
          content: q.content,
          points: q.points,
          selectedAnswerId: q.selected_answer_id,
          isCorrect: q.student_correct === 1,
          answers: answers.map((a) => ({
            id: a.id,
            content: a.content,
            isCorrect: a.is_correct === 1, // Hiển thị sau khi thi — OK
            orderIndex: a.order_index,
          })),
        };
      }),
    );

    return res.status(200).json({
      attemptId: attempt.id,
      examTitle: attempt.exam_title,
      studentName: attempt.student_name,
      score: attempt.score,
      totalPoints: attempt.total_points,
      correctCount: attempt.correct_count,
      totalQuestions: attempt.total_questions,
      startedAt: attempt.started_at,
      finishedAt: attempt.finished_at,
      aiExplanation: attempt.ai_explanation, // null nếu AI chưa xong
      questions: questionsWithAnswers,
    });
  } catch (err) {
    console.error("[studentController.getResult]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = {
  getDashboard,
  getClasses,
  joinClass,
  leaveClass,
  getExams,
  getHistory,
  getResult,
};
