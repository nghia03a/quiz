// ============================================================
// authMiddleware.js — Xác thực JWT Token
//
// Cách hoạt động:
//   Frontend gửi mọi request kèm header:
//     Authorization: Bearer <token>
//
//   Middleware này:
//     1. Lấy token ra khỏi header
//     2. Kiểm tra token có hợp lệ không (đúng secret, chưa hết hạn)
//     3. Nếu hợp lệ → lưu thông tin user vào req.user → next()
//     4. Nếu không  → trả về lỗi 401, không cho vào route
//
// Dùng ở đâu:
//   Đặt trước toàn bộ routes cần đăng nhập trong app.js
//   Ví dụ: router.use(authMiddleware)
// ============================================================

const jwt = require("jsonwebtoken");

// Đọc khóa bí mật từ .env — phải khớp với key dùng khi tạo token
const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  // --------------------------------------------------------
  // BƯỚC 1: Lấy token từ header Authorization
  // Header có dạng: "Bearer eyJhbGci..."
  // Tách lấy phần sau chữ "Bearer "
  // --------------------------------------------------------
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.",
    });
  }

  const token = authHeader.split(" ")[1]; // lấy phần sau "Bearer "

  // --------------------------------------------------------
  // BƯỚC 2: Xác thực token bằng JWT_SECRET
  // jwt.verify sẽ ném lỗi nếu:
  //   - Token bị sửa / giả mạo
  //   - Token đã hết hạn (JWT_EXPIRES_IN = 8h)
  // --------------------------------------------------------
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // decoded chứa payload đã lưu lúc tạo token, ví dụ:
    // { id, username, role, fullName, mustChangePassword, iat, exp }

    // --------------------------------------------------------
    // BƯỚC 3: Kiểm tra tài khoản có bị khóa không
    // is_active = false → tài khoản bị Admin khóa → từ chối
    // (trường này được lưu trong payload khi đăng nhập)
    // --------------------------------------------------------
    if (decoded.isActive === false) {
      return res.status(403).json({
        message: "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.",
      });
    }

    // --------------------------------------------------------
    // BƯỚC 4: Kiểm tra cờ mustChangePassword
    // Nếu true → user phải đổi mật khẩu trước khi làm gì khác
    // Chỉ cho phép gọi route /api/auth/change-password
    // --------------------------------------------------------
    if (decoded.mustChangePassword && !req.path.includes("/change-password")) {
      return res.status(403).json({
        mustChangePassword: true,
        message: "Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.",
      });
    }

    // --------------------------------------------------------
    // BƯỚC 5: Gắn thông tin user vào req để các route dùng
    // Sau bước này, mọi controller đều có thể dùng req.user
    // --------------------------------------------------------
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role, // 'admin' | 'teacher' | 'student'
      fullName: decoded.fullName,
      teacherId: decoded.teacherId, // chỉ có nếu role = teacher
      studentId: decoded.studentId, // chỉ có nếu role = student
      mustChangePassword: decoded.mustChangePassword,
      isActive: decoded.isActive,
    };

    next(); // cho phép đi tiếp vào route handler
  } catch (err) {
    // Token hết hạn
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      });
    }

    // Token sai / bị sửa
    return res.status(401).json({
      message: "Token không hợp lệ. Vui lòng đăng nhập lại.",
    });
  }
}

module.exports = authMiddleware;
