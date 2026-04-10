// ============================================================
// roleMiddleware.js — Kiểm tra phân quyền theo vai trò
//
// Dự án có 3 vai trò: admin | teacher | student
// Mỗi nhóm route chỉ được phép truy cập bởi đúng vai trò của mình.
//
// Cách dùng:
//   roleMiddleware('admin')           → chỉ admin mới vào được
//   roleMiddleware('teacher')         → chỉ teacher mới vào được
//   roleMiddleware('admin', 'teacher') → admin hoặc teacher đều được
//
// Quan trọng:
//   Phải đặt SAU authMiddleware trong chuỗi middleware
//   vì roleMiddleware cần req.user do authMiddleware gắn vào
//
// Ví dụ dùng trong routes:
//   router.get('/stats', authMiddleware, roleMiddleware('admin'), controller)
//   router.post('/classes', authMiddleware, roleMiddleware('teacher'), controller)
// ============================================================

function roleMiddleware(...allowedRoles) {
  // Hàm này trả về một middleware function
  // allowedRoles là danh sách các role được phép
  // Ví dụ: roleMiddleware('admin', 'teacher') → allowedRoles = ['admin', 'teacher']

  return function (req, res, next) {
    // --------------------------------------------------------
    // BƯỚC 1: Đảm bảo authMiddleware đã chạy trước
    // Nếu req.user không có → authMiddleware chưa chạy → lỗi cấu hình
    // --------------------------------------------------------
    if (!req.user) {
      return res.status(401).json({
        message: "Bạn chưa đăng nhập.",
      });
    }

    // --------------------------------------------------------
    // BƯỚC 2: Kiểm tra role của user có nằm trong danh sách cho phép không
    // req.user.role được gắn bởi authMiddleware từ JWT payload
    // --------------------------------------------------------
    const userRole = req.user.role; // 'admin' | 'teacher' | 'student'

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        message: "Bạn không có quyền thực hiện thao tác này.",
      });
    }

    // --------------------------------------------------------
    // BƯỚC 3: Vai trò hợp lệ → cho phép đi tiếp
    // --------------------------------------------------------
    next();
  };
}

module.exports = roleMiddleware;

// ============================================================
// GHI CHÚ CÁCH DÙNG TRONG app.js / routes:
//
// const authMiddleware = require('./middlewares/authMiddleware');
// const roleMiddleware = require('./middlewares/roleMiddleware');
//
// --- Chỉ admin ---
// router.get('/admin/stats',
//   authMiddleware,
//   roleMiddleware('admin'),
//   adminController.getStats
// );
//
// --- Chỉ teacher ---
// router.post('/teacher/classes',
//   authMiddleware,
//   roleMiddleware('teacher'),
//   teacherController.createClass
// );
//
// --- Chỉ student ---
// router.post('/student/classes/join',
//   authMiddleware,
//   roleMiddleware('student'),
//   studentController.joinClass
// );
//
// --- Admin hoặc teacher đều được ---
// router.get('/exams/:id/results',
//   authMiddleware,
//   roleMiddleware('admin', 'teacher'),
//   examController.getResults
// );
// ============================================================
