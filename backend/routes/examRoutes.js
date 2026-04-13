// ============================================================
// routes/examRoutes.js — Vào phòng thi, nộp bài, vi phạm
//
// Tách riêng vì đây là phần nghiệp vụ phức tạp nhất:
//   - startExam: kiểm tra quyền, khung giờ, số lần thi
//   - submitExam: chấm điểm tự động, gọi AI giải thích bất đồng bộ
//   - recordViolation: ghi vi phạm + Socket.IO notify GV
//
// Prefix trong app.js: /api/student
// Chỉ role = 'student' mới dùng được
//
// Routes:
//   POST /api/student/exams/:examId/start        — Vào phòng thi
//   POST /api/student/exams/:attemptId/submit    — Nộp bài
//   POST /api/student/violations                 — Báo vi phạm
//
// Đồng bộ với:
//   frontend/pages/student/exam-room.html
//     - Vào phòng: fetch POST /api/student/exams/${examId}/start
//     - Nộp bài:   fetch POST /api/student/exams/${attemptId}/submit
//     - Vi phạm:   fetch POST /api/student/violations
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const examController = require("../controllers/examController");

// Áp dụng cho TẤT CẢ routes trong file này
router.use(authMiddleware);
router.use(roleMiddleware("student"));

// ============================================================
// VÀO PHÒNG THI
// POST /api/student/exams/:examId/start
//
// Kiểm tra:
//   1. Học sinh thuộc lớp được giao đề
//   2. Đề thi đang trong khung giờ (scheduled) hoặc tự do (free)
//   3. Chưa vượt số lần thi tối đa
// Trả về: câu hỏi + đáp án (ĐÃ XÁO TRỘN, KHÔNG có is_correct)
// ============================================================
router.post("/exams/:examId/start", examController.startExam);

// ============================================================
// NỘP BÀI
// POST /api/student/exams/:attemptId/submit
// Body: { answers: [{ questionId, selectedAnswerId }] }
//
// Luồng:
//   1. Lưu câu trả lời vào answer_records
//   2. Chấm điểm tự động (thang 10)
//   3. Lưu kết quả vào exam_attempts
//   4. Trả kết quả ngay cho học sinh
//   5. Gọi Groq AI sinh giải thích (bất đồng bộ — không làm HS chờ)
// ============================================================
router.post("/exams/:attemptId/submit", examController.submitExam);

// ============================================================
// BÁO VI PHẠM
// POST /api/student/violations
// Body: { attemptId, type, description }
// type: 'tab_switch' | 'copy_paste' | 'exit_fullscreen'
//
// exam-room.html phát hiện vi phạm → gọi API này → lưu DB
// Socket.IO trong server.js nhận sự kiện 'violation' từ client
// và phát đến GV đang giám sát
// ============================================================
router.post("/violations", examController.recordViolation);

module.exports = router;
