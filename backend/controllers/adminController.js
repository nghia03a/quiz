// ============================================================
// adminController.js — Quản lý giáo viên, học sinh, thống kê
//
// Các route sử dụng file này:
//   GET    /api/admin/stats
//   GET    /api/admin/teachers
//   POST   /api/admin/teachers
//   PUT    /api/admin/teachers/:id
//   POST   /api/admin/teachers/:id/toggle-status
//   POST   /api/admin/teachers/:id/reset-password
//   DELETE /api/admin/teachers/:id
//   GET    /api/admin/students
//   POST   /api/admin/students
//   POST   /api/admin/students/import
//   PUT    /api/admin/students/:id
//   POST   /api/admin/students/:id/toggle-status
//   POST   /api/admin/students/:id/reset-password
//   DELETE /api/admin/students/:id
//   GET    /api/admin/students/:studentId/stats
// ============================================================

const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const xlsx = require("xlsx"); // SheetJS — đọc file Excel

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// ============================================================
// Hàm tiện ích: chuyển ngày sinh thành mật khẩu mặc định
// Ví dụ: 2003-06-08 → "08062003" (định dạng ddmmyyyy)
// ============================================================
function dobToDefaultPassword(dateOfBirth) {
  const d = new Date(dateOfBirth);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

// ============================================================
// GET /api/admin/stats
// Trả về số liệu tổng quan cho dashboard Admin
// ============================================================
async function getStats(req, res) {
  try {
    const [[{ teachers }]] = await db.query(
      "SELECT COUNT(*) AS teachers FROM users WHERE role = 'teacher'",
    );
    const [[{ students }]] = await db.query(
      "SELECT COUNT(*) AS students FROM users WHERE role = 'student'",
    );
    const [[{ classes }]] = await db.query(
      "SELECT COUNT(*) AS classes FROM classes",
    );
    const [[{ exams }]] = await db.query("SELECT COUNT(*) AS exams FROM exams");

    // Lấy tên Admin để hiển thị ở header
    const [adminRows] = await db.query(
      "SELECT full_name FROM users WHERE id = ? LIMIT 1",
      [req.user.id],
    );

    return res.status(200).json({
      teachers,
      students,
      classes,
      exams,
      adminName: adminRows[0]?.full_name ?? "Admin",
    });
  } catch (err) {
    console.error("[adminController.getStats]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/admin/teachers
// Danh sách toàn bộ giáo viên
// ============================================================
async function getTeachers(req, res) {
  try {
    const [teachers] = await db.query(
      "SELECT id, username, full_name, teacher_id, date_of_birth, is_active, created_at FROM users WHERE role = 'teacher' ORDER BY created_at DESC",
    );

    const [adminRows] = await db.query(
      "SELECT full_name FROM users WHERE id = ?",
      [req.user.id],
    );

    return res.status(200).json({
      teachers: teachers.map((t) => ({
        id: t.id,
        username: t.username,
        fullName: t.full_name,
        teacherId: t.teacher_id,
        dateOfBirth: t.date_of_birth,
        isActive: t.is_active === 1,
        createdAt: t.created_at,
      })),
      adminName: adminRows[0]?.full_name,
    });
  } catch (err) {
    console.error("[adminController.getTeachers]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers
// Thêm giáo viên mới
// Body: { teacherId, fullName, dateOfBirth }
//
// Hệ thống tự tạo tài khoản:
//   username = teacherId
//   password = ngày sinh định dạng ddmmyyyy (mã hóa bcrypt)
//   must_change_password = 1 (bắt buộc đổi lần đầu)
// ============================================================
async function createTeacher(req, res) {
  const { teacherId, fullName, dateOfBirth } = req.body;

  if (!teacherId || !fullName || !dateOfBirth) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập đầy đủ mã GV, họ tên và ngày sinh." });
  }

  try {
    // Kiểm tra mã giáo viên đã tồn tại chưa
    const [existing] = await db.query(
      "SELECT id FROM users WHERE teacher_id = ? OR username = ? LIMIT 1",
      [teacherId.trim(), teacherId.trim()],
    );
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ message: "Mã giáo viên đã tồn tại trong hệ thống." });
    }

    const defaultPassword = dobToDefaultPassword(dateOfBirth);
    const hashedPassword = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
    const id = uuidv4();

    await db.query(
      `INSERT INTO users (id, username, password, full_name, role, teacher_id, date_of_birth, must_change_password, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'teacher', ?, ?, 1, 1, NOW(), NOW())`,
      [
        id,
        teacherId.trim(),
        hashedPassword,
        fullName.trim(),
        teacherId.trim(),
        dateOfBirth,
      ],
    );

    return res
      .status(201)
      .json({ message: "Tạo tài khoản giáo viên thành công." });
  } catch (err) {
    console.error("[adminController.createTeacher]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// PUT /api/admin/teachers/:id
// Sửa thông tin giáo viên (họ tên, ngày sinh)
// ============================================================
async function updateTeacher(req, res) {
  const { id } = req.params;
  const { fullName, dateOfBirth } = req.body;

  if (!fullName) {
    return res.status(400).json({ message: "Vui lòng nhập họ tên." });
  }

  try {
    await db.query(
      "UPDATE users SET full_name = ?, date_of_birth = ?, updated_at = NOW() WHERE id = ? AND role = ?",
      [fullName.trim(), dateOfBirth || null, id, "teacher"],
    );
    return res
      .status(200)
      .json({ message: "Cập nhật thông tin giáo viên thành công." });
  } catch (err) {
    console.error("[adminController.updateTeacher]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers/:id/toggle-status
// Khóa hoặc mở khóa tài khoản giáo viên
// ============================================================
async function toggleTeacherStatus(req, res) {
  const { id } = req.params;
  try {
    // Đảo ngược is_active: 1→0 hoặc 0→1
    await db.query(
      "UPDATE users SET is_active = IF(is_active = 1, 0, 1), updated_at = NOW() WHERE id = ? AND role = 'teacher'",
      [id],
    );
    return res
      .status(200)
      .json({ message: "Cập nhật trạng thái tài khoản thành công." });
  } catch (err) {
    console.error("[adminController.toggleTeacherStatus]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers/:id/reset-password
// Reset mật khẩu về ngày sinh mặc định
// Sau khi reset: must_change_password = 1
// ============================================================
async function resetTeacherPassword(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT date_of_birth FROM users WHERE id = ? AND role = 'teacher' LIMIT 1",
      [id],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Không tìm thấy giáo viên." });
    }

    const defaultPassword = dobToDefaultPassword(rows[0].date_of_birth);
    const hashedPassword = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);

    await db.query(
      "UPDATE users SET password = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?",
      [hashedPassword, id],
    );
    return res.status(200).json({ message: "Reset mật khẩu thành công." });
  } catch (err) {
    console.error("[adminController.resetTeacherPassword]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// DELETE /api/admin/teachers/:id
// Xóa tài khoản giáo viên
// ============================================================
async function deleteTeacher(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM users WHERE id = ? AND role = 'teacher'", [id]);
    return res
      .status(200)
      .json({ message: "Xóa tài khoản giáo viên thành công." });
  } catch (err) {
    console.error("[adminController.deleteTeacher]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/admin/students
// Danh sách toàn bộ học sinh
// ============================================================
async function getStudents(req, res) {
  try {
    const [students] = await db.query(
      "SELECT id, username, full_name, student_id, date_of_birth, is_active, created_at FROM users WHERE role = 'student' ORDER BY created_at DESC",
    );
    return res.status(200).json({
      students: students.map((s) => ({
        id: s.id,
        username: s.username,
        fullName: s.full_name,
        studentId: s.student_id,
        dateOfBirth: s.date_of_birth,
        isActive: s.is_active === 1,
        createdAt: s.created_at,
      })),
    });
  } catch (err) {
    console.error("[adminController.getStudents]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/students
// Thêm từng học sinh mới lẻ
// Body: { studentId, fullName, dateOfBirth }
// ============================================================
async function createStudent(req, res) {
  const { studentId, fullName, dateOfBirth } = req.body;

  if (!studentId || !fullName || !dateOfBirth) {
    return res
      .status(400)
      .json({ message: "Vui lòng nhập đầy đủ mã số HS, họ tên và ngày sinh." });
  }

  try {
    const [existing] = await db.query(
      "SELECT id FROM users WHERE student_id = ? OR username = ? LIMIT 1",
      [studentId.trim(), studentId.trim()],
    );
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ message: "Mã số học sinh đã tồn tại trong hệ thống." });
    }

    const defaultPassword = dobToDefaultPassword(dateOfBirth);
    const hashedPassword = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
    const id = uuidv4();

    await db.query(
      `INSERT INTO users (id, username, password, full_name, role, student_id, date_of_birth, must_change_password, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'student', ?, ?, 1, 1, NOW(), NOW())`,
      [
        id,
        studentId.trim(),
        hashedPassword,
        fullName.trim(),
        studentId.trim(),
        dateOfBirth,
      ],
    );

    return res
      .status(201)
      .json({ message: "Tạo tài khoản học sinh thành công." });
  } catch (err) {
    console.error("[adminController.createStudent]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/students/import
// Import hàng loạt học sinh từ file Excel
// File Excel có 3 cột: mã số học sinh | họ tên | ngày sinh
// Xử lý từng dòng độc lập — dòng lỗi bỏ qua, không rollback toàn bộ
// ============================================================
async function importStudents(req, res) {
  try {
    // req.file.buffer do handleUploadSingle (uploadMiddleware) gắn vào
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer",
      cellDates: true,
    });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
    });

    // Bỏ qua dòng đầu tiên (tiêu đề)
    const dataRows = rows.slice(1);

    let created = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const [rawStudentId, rawFullName, rawDob] = dataRows[i];
      const lineNum = i + 2; // +2 vì bỏ tiêu đề và index 0-based

      // Kiểm tra dòng trống
      if (!rawStudentId && !rawFullName) continue;

      const studentId = String(rawStudentId ?? "").trim();
      const fullName = String(rawFullName ?? "").trim();

      // Validate
      if (!studentId) {
        errors.push({ line: lineNum, reason: "Thiếu mã số học sinh" });
        continue;
      }
      if (!fullName) {
        errors.push({ line: lineNum, reason: "Thiếu họ tên" });
        continue;
      }
      if (!rawDob) {
        errors.push({ line: lineNum, reason: "Thiếu ngày sinh" });
        continue;
      }

      // Chuyển ngày sinh từ Excel sang Date
      let dateOfBirth;
      try {
        dateOfBirth = rawDob instanceof Date ? rawDob : new Date(rawDob);
        if (isNaN(dateOfBirth.getTime())) throw new Error();
      } catch {
        errors.push({ line: lineNum, reason: "Ngày sinh không hợp lệ" });
        continue;
      }

      // Kiểm tra trùng mã số
      try {
        const [existing] = await db.query(
          "SELECT id FROM users WHERE student_id = ? OR username = ? LIMIT 1",
          [studentId, studentId],
        );
        if (existing.length > 0) {
          errors.push({
            line: lineNum,
            reason: `Mã số học sinh "${studentId}" đã tồn tại`,
          });
          continue;
        }

        const dobString = dateOfBirth.toISOString().split("T")[0]; // yyyy-mm-dd
        const defaultPassword = dobToDefaultPassword(dateOfBirth);
        const hashedPassword = await bcrypt.hash(
          defaultPassword,
          BCRYPT_ROUNDS,
        );
        const id = uuidv4();

        await db.query(
          `INSERT INTO users (id, username, password, full_name, role, student_id, date_of_birth, must_change_password, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'student', ?, ?, 1, 1, NOW(), NOW())`,
          [id, studentId, hashedPassword, fullName, studentId, dobString],
        );
        created++;
      } catch (dbErr) {
        errors.push({ line: lineNum, reason: "Lỗi lưu vào database" });
      }
    }

    return res.status(200).json({
      message: `Import hoàn tất: tạo thành công ${created} tài khoản.`,
      created,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    console.error("[adminController.importStudents]", err);
    return res.status(400).json({
      message: "File không đúng định dạng hoặc bị lỗi. Vui lòng kiểm tra lại.",
    });
  }
}

// ============================================================
// PUT /api/admin/students/:id
// Sửa thông tin học sinh
// ============================================================
async function updateStudent(req, res) {
  const { id } = req.params;
  const { fullName, dateOfBirth } = req.body;
  if (!fullName)
    return res.status(400).json({ message: "Vui lòng nhập họ tên." });
  try {
    await db.query(
      "UPDATE users SET full_name = ?, date_of_birth = ?, updated_at = NOW() WHERE id = ? AND role = 'student'",
      [fullName.trim(), dateOfBirth || null, id],
    );
    return res
      .status(200)
      .json({ message: "Cập nhật thông tin học sinh thành công." });
  } catch (err) {
    console.error("[adminController.updateStudent]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// Khóa/mở khóa học sinh
async function toggleStudentStatus(req, res) {
  const { id } = req.params;
  try {
    await db.query(
      "UPDATE users SET is_active = IF(is_active = 1, 0, 1), updated_at = NOW() WHERE id = ? AND role = 'student'",
      [id],
    );
    return res.status(200).json({ message: "Cập nhật trạng thái thành công." });
  } catch (err) {
    console.error("[adminController.toggleStudentStatus]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// Reset mật khẩu học sinh về ngày sinh
async function resetStudentPassword(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT date_of_birth FROM users WHERE id = ? AND role = 'student' LIMIT 1",
      [id],
    );
    if (!rows.length)
      return res.status(404).json({ message: "Không tìm thấy học sinh." });

    const defaultPassword = dobToDefaultPassword(rows[0].date_of_birth);
    const hashedPassword = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
    await db.query(
      "UPDATE users SET password = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?",
      [hashedPassword, id],
    );
    return res.status(200).json({ message: "Reset mật khẩu thành công." });
  } catch (err) {
    console.error("[adminController.resetStudentPassword]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// Xóa học sinh
async function deleteStudent(req, res) {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM users WHERE id = ? AND role = 'student'", [id]);
    return res
      .status(200)
      .json({ message: "Xóa tài khoản học sinh thành công." });
  } catch (err) {
    console.error("[adminController.deleteStudent]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/admin/students/:studentId/stats
// Xem lịch sử học tập chi tiết của 1 học sinh theo mã số
// Dùng trong dashboard Admin (ô tìm kiếm) và student-detail.html
// ============================================================
async function getStudentStats(req, res) {
  const { studentId } = req.params;
  try {
    // Tìm học sinh theo id (UUID) hoặc student_id (mã số)
    const [students] = await db.query(
      "SELECT * FROM users WHERE (id = ? OR student_id = ?) AND role = 'student' LIMIT 1",
      [studentId, studentId],
    );
    const student = students[0];
    if (!student)
      return res.status(404).json({ message: "Không tìm thấy học sinh." });

    // Lịch sử thi
    const [attempts] = await db.query(
      `SELECT ea.id, e.title AS exam_title, ea.score, ea.correct_count, ea.total_questions,
              ea.finished_at,
              (SELECT COUNT(*) FROM violations v WHERE v.attempt_id = ea.id) AS violation_count
       FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       WHERE ea.student_id = ? AND ea.is_completed = 1
       ORDER BY ea.finished_at DESC`,
      [student.id],
    );

    // Điểm trung bình
    const avgScore = attempts.length
      ? attempts.reduce((sum, a) => sum + (a.score ?? 0), 0) / attempts.length
      : null;

    return res.status(200).json({
      student: {
        id: student.id,
        fullName: student.full_name,
        studentId: student.student_id,
        dateOfBirth: student.date_of_birth,
        isActive: student.is_active === 1,
        totalExams: attempts.length,
        avgScore,
      },
      attempts: attempts.map((a) => ({
        id: a.id,
        examTitle: a.exam_title,
        score: a.score,
        correctCount: a.correct_count,
        totalQuestions: a.total_questions,
        violationCount: a.violation_count,
        finishedAt: a.finished_at,
      })),
    });
  } catch (err) {
    console.error("[adminController.getStudentStats]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = {
  getStats,
  getTeachers,
  createTeacher,
  updateTeacher,
  toggleTeacherStatus,
  resetTeacherPassword,
  deleteTeacher,
  getStudents,
  createStudent,
  importStudents,
  updateStudent,
  toggleStudentStatus,
  resetStudentPassword,
  deleteStudent,
  getStudentStats,
};
