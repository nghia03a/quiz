// ============================================================
// monitorController.js — Giám sát thi, lịch sử vi phạm
//
// Routes:
//   GET /api/teacher/exams/:examId/violations
//   GET /api/teacher/exams/:examId/monitor-data
// ============================================================

const db = require("../config/database");

// ============================================================
// GET /api/teacher/exams/:examId/monitor-data
// Lấy danh sách học sinh đang/đã thi + số vi phạm
// Dùng trong monitor.html để hiển thị bảng giám sát
// ============================================================
async function getMonitorData(req, res) {
  const { examId } = req.params;

  try {
    // Kiểm tra giáo viên có quyền với đề thi này không
    const [exams] = await db.query(
      "SELECT id, title FROM exams WHERE id = ? AND teacher_id = ? LIMIT 1",
      [examId, req.user.id],
    );
    if (!exams.length)
      return res.status(403).json({ message: "Không có quyền truy cập." });

    const [attempts] = await db.query(
      `SELECT ea.id AS attempt_id, u.id AS student_id, u.full_name, u.student_id AS student_code,
              ea.started_at, ea.finished_at, ea.is_completed,
              ea.score, ea.correct_count, ea.total_questions,
              (SELECT COUNT(*) FROM violations v WHERE v.attempt_id = ea.id) AS violation_count
       FROM exam_attempts ea
       JOIN users u ON ea.student_id = u.id
       WHERE ea.exam_id = ?
       ORDER BY ea.started_at DESC`,
      [examId],
    );

    return res.status(200).json({
      examTitle: exams[0].title,
      attempts: attempts.map((a) => ({
        attemptId: a.attempt_id,
        studentId: a.student_id,
        studentCode: a.student_code,
        fullName: a.full_name,
        startedAt: a.started_at,
        finishedAt: a.finished_at,
        isCompleted: a.is_completed === 1,
        score: a.score,
        correctCount: a.correct_count,
        totalQuestions: a.total_questions,
        violationCount: a.violation_count,
      })),
    });
  } catch (err) {
    console.error("[monitorController.getMonitorData]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/teacher/exams/:examId/violations
// Lịch sử toàn bộ vi phạm trong 1 buổi thi
// ============================================================
async function getViolations(req, res) {
  const { examId } = req.params;

  try {
    const [violations] = await db.query(
      `SELECT v.id, v.type, v.description, v.detected_at,
              u.full_name, u.student_id AS student_code,
              v.attempt_id
       FROM violations v
       JOIN users u ON v.student_id = u.id
       JOIN exam_attempts ea ON v.attempt_id = ea.id
       WHERE ea.exam_id = ?
       ORDER BY v.detected_at DESC`,
      [examId],
    );

    return res.status(200).json({
      violations: violations.map((v) => ({
        id: v.id,
        type: v.type,
        description: v.description,
        detectedAt: v.detected_at,
        fullName: v.full_name,
        studentCode: v.student_code,
        attemptId: v.attempt_id,
      })),
    });
  } catch (err) {
    console.error("[monitorController.getViolations]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = { getMonitorData, getViolations };

// ============================================================
// notificationController.js — Thông báo lịch thi
//
// Routes:
//   GET   /api/student/notifications
//   POST  /api/student/notifications/:id/read
// ============================================================

// Vì Node.js module.exports chỉ 1 per file,
// file này xuất monitorController ở trên.
// notificationController nằm trong file riêng bên dưới.
