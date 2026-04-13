// ============================================================
// routes/questionRoutes.js — Ngân hàng câu hỏi
//
// Tách riêng khỏi teacherRoutes.js để file không quá dài.
// Prefix trong app.js: /api/teacher/questions
// Tất cả routes đều cần: authMiddleware + roleMiddleware('teacher')
//
// Routes:
//   GET    /api/teacher/questions
//   POST   /api/teacher/questions
//   PUT    /api/teacher/questions/:id
//   DELETE /api/teacher/questions/:id
//   POST   /api/teacher/questions/upload       ← cần uploadMiddleware
//   POST   /api/teacher/questions/ai-generate  ← gọi Groq AI
//
// Đồng bộ với:
//   frontend/pages/teacher/question-bank.html
//     - Bảng câu hỏi     → GET /api/teacher/questions
//     - Modal thêm/sửa   → POST/PUT /api/teacher/questions
//     - Nút Xóa          → DELETE /api/teacher/questions/:id
//     - Nút Upload file  → POST /api/teacher/questions/upload
//     - Modal AI tạo     → POST /api/teacher/questions/ai-generate
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const { handleUploadSingle } = require("../middlewares/uploadMiddleware");
const questionController = require("../controllers/questionController");

// Áp dụng cho TẤT CẢ routes trong file này
router.use(authMiddleware);
router.use(roleMiddleware("teacher"));

// ============================================================
// QUAN TRỌNG — Thứ tự route:
//   /upload và /ai-generate phải đặt TRƯỚC /:id
//   Nếu đặt sau, Express nhầm "upload"/"ai-generate" là giá trị :id
// ============================================================

// Lấy danh sách câu hỏi
router.get("/", questionController.getQuestions);

// Upload hàng loạt từ file Excel — handleUploadSingle xử lý req.file
router.post("/upload", handleUploadSingle, questionController.uploadQuestions);

// Tạo câu hỏi bằng Groq AI
router.post("/ai-generate", questionController.generateQuestionsWithAI);

// Thêm 1 câu hỏi thủ công — đặt SAU /upload và /ai-generate
router.post("/", questionController.createQuestion);

// Sửa và xóa theo :id
router.put("/:id", questionController.updateQuestion);
router.delete("/:id", questionController.deleteQuestion);

module.exports = router;
