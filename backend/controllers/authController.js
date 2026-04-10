// ============================================================
// authController.js — Đăng nhập, đăng xuất, đổi mật khẩu
//
// Các route sử dụng file này:
//   POST /api/auth/login
//   POST /api/auth/logout
//   POST /api/auth/change-password
//   GET  /api/auth/me
// ============================================================

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// ============================================================
// Hàm tạo JWT token
// Payload lưu các thông tin cần dùng trong authMiddleware
// ============================================================
function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role, // 'admin' | 'teacher' | 'student'
      fullName: user.full_name,
      teacherId: user.teacher_id, // null nếu không phải teacher
      studentId: user.student_id, // null nếu không phải student
      mustChangePassword: user.must_change_password === 1,
      isActive: user.is_active === 1,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

// ============================================================
// POST /api/auth/login
// Body: { username, password }
//
// Đồng bộ với login.html:
//   - Trả về { token, user: { role, mustChangePassword, fullName } }
//   - Frontend lưu token + role vào localStorage
//   - Nếu mustChangePassword → redirect sang change-password.html
// ============================================================
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập tên đăng nhập và mật khẩu." });
  }

  try {
    // Tìm user trong bảng users theo username
    const [rows] = await db.query(
      "SELECT * FROM users WHERE username = ? LIMIT 1",
      [username.trim()],
    );

    const user = rows[0];

    // Không tìm thấy user → thông báo chung (không tiết lộ username/password cái nào sai)
    if (!user) {
      return res
        .status(401)
        .json({ message: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }

    // Tài khoản bị Admin khóa
    if (user.is_active === 0) {
      return res
        .status(403)
        .json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ Admin." });
    }

    // Kiểm tra mật khẩu — bcrypt.compare tự xử lý salt
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res
        .status(401)
        .json({ message: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }

    // Tạo JWT token
    const token = createToken(user);

    // Trả về token + thông tin cần thiết cho Frontend
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
        teacherId: user.teacher_id,
        studentId: user.student_id,
        mustChangePassword: user.must_change_password === 1,
      },
    });
  } catch (err) {
    console.error("[authController.login]", err);
    return res.status(500).json({ message: "Lỗi server. Vui lòng thử lại." });
  }
}

// ============================================================
// POST /api/auth/logout
// Đồng bộ với logoutBtn trong mọi trang HTML:
//   localStorage.clear() → gọi API logout (tùy chọn)
//
// JWT là stateless nên logout phía server chỉ trả về 200.
// Token tự hết hạn sau JWT_EXPIRES_IN.
// ============================================================
function logout(req, res) {
  return res.status(200).json({ message: "Đăng xuất thành công." });
}

// ============================================================
// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
//
// Dùng cho 2 trường hợp:
//   1. Đổi mật khẩu bắt buộc lần đầu (mustChangePassword = true)
//      → gọi từ change-password.html
//   2. Đổi mật khẩu chủ động từ trang profile
//      → gọi từ admin/profile.html, teacher/profile.html, student/profile.html
//
// Sau khi đổi thành công:
//   - Đặt must_change_password = 0 trong DB
//   - Cấp lại token mới (payload mustChangePassword = false)
// ============================================================
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  // Validate đầu vào
  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({
        message: "Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.",
      });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ message: "Mật khẩu mới phải có ít nhất 6 ký tự." });
  }

  try {
    // Lấy thông tin user từ DB (cần password hash hiện tại)
    const [rows] = await db.query("SELECT * FROM users WHERE id = ? LIMIT 1", [
      userId,
    ]);
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy tài khoản." });
    }

    // Xác thực mật khẩu hiện tại
    const isCurrentCorrect = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentCorrect) {
      return res.status(400).json({ message: "Mật khẩu hiện tại không đúng." });
    }

    // Mật khẩu mới không được trùng mật khẩu cũ
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới không được trùng mật khẩu hiện tại." });
    }

    // Mã hóa mật khẩu mới bằng bcrypt
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Cập nhật DB: mật khẩu mới + tắt cờ mustChangePassword
    await db.query(
      "UPDATE users SET password = ?, must_change_password = 0, updated_at = NOW() WHERE id = ?",
      [hashedPassword, userId],
    );

    // Tạo token mới với mustChangePassword = false
    const updatedUser = {
      ...user,
      password: hashedPassword,
      must_change_password: 0,
    };
    const newToken = createToken(updatedUser);

    return res.status(200).json({
      message: "Đổi mật khẩu thành công.",
      token: newToken,
    });
  } catch (err) {
    console.error("[authController.changePassword]", err);
    return res.status(500).json({ message: "Lỗi server. Vui lòng thử lại." });
  }
}

// ============================================================
// GET /api/auth/me
// Trả về thông tin tài khoản đang đăng nhập
// Dùng trong trang profile để hiển thị họ tên, mã GV, mã HS
// ============================================================
async function getMe(req, res) {
  try {
    const [rows] = await db.query(
      "SELECT id, username, full_name, role, teacher_id, student_id, date_of_birth, is_active FROM users WHERE id = ? LIMIT 1",
      [req.user.id],
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy tài khoản." });
    }

    return res.status(200).json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      teacherId: user.teacher_id,
      studentId: user.student_id,
      dateOfBirth: user.date_of_birth,
      isActive: user.is_active === 1,
    });
  } catch (err) {
    console.error("[authController.getMe]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = { login, logout, changePassword, getMe };
