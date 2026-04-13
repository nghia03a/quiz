// ============================================================
// adminController.js — Quản lý giáo viên, học sinh, thống kê
// ============================================================

const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const xlsx = require("xlsx");

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// Hàm chuyển ngày sinh → mật khẩu mặc định ddmmyyyy
// Ví dụ: 2003-06-08 → "08062003"
function dobToDefaultPassword(dateOfBirth) {
  const d = new Date(dateOfBirth);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

// ============================================================
// GET /api/admin/stats
// ============================================================
async function getStats(req, res) {
  try {
    const [[{ teachers }]] = await db.query(
      "SELECT COUNT(*) AS teachers FROM users WHERE role='teacher'",
    );
    const [[{ students }]] = await db.query(
      "SELECT COUNT(*) AS students FROM users WHERE role='student'",
    );
    const [[{ classes }]] = await db.query(
      "SELECT COUNT(*) AS classes FROM classes",
    );
    const [[{ exams }]] = await db.query("SELECT COUNT(*) AS exams FROM exams");
    const [rows] = await db.query("SELECT full_name FROM users WHERE id = ?", [
      req.user.id,
    ]);
    return res.status(200).json({
      teachers,
      students,
      classes,
      exams,
      adminName: rows[0]?.full_name ?? "Admin",
    });
  } catch (err) {
    console.error("[adminController.getStats]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// GET /api/admin/teachers
// ============================================================
async function getTeachers(req, res) {
  try {
    const [teachers] = await db.query(
      "SELECT id, username, full_name, teacher_id, date_of_birth, is_active FROM users WHERE role='teacher' ORDER BY created_at DESC",
    );
    const [rows] = await db.query("SELECT full_name FROM users WHERE id = ?", [
      req.user.id,
    ]);
    return res.status(200).json({
      adminName: rows[0]?.full_name,
      teachers: teachers.map((t) => ({
        id: t.id,
        username: t.username,
        fullName: t.full_name,
        teacherId: t.teacher_id,
        dateOfBirth: t.date_of_birth,
        isActive: t.is_active === 1,
      })),
    });
  } catch (err) {
    console.error("[adminController.getTeachers]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers
// Body: { teacherId, fullName, dateOfBirth }
// ============================================================
async function createTeacher(req, res) {
  const { teacherId, fullName, dateOfBirth } = req.body;
  if (!teacherId || !fullName || !dateOfBirth)
    return res
      .status(400)
      .json({ message: "Vui lòng nhập đầy đủ mã GV, họ tên và ngày sinh." });
  try {
    const [existing] = await db.query(
      "SELECT id FROM users WHERE teacher_id = ? OR username = ? LIMIT 1",
      [teacherId.trim(), teacherId.trim()],
    );
    if (existing.length)
      return res.status(409).json({ message: "Mã giáo viên đã tồn tại." });
    const hashed = await bcrypt.hash(
      dobToDefaultPassword(dateOfBirth),
      BCRYPT_ROUNDS,
    );
    await db.query(
      "INSERT INTO users (id,username,password,full_name,role,teacher_id,date_of_birth,must_change_password,is_active,created_at,updated_at) VALUES (?,?,?,?,'teacher',?,?,1,1,NOW(),NOW())",
      [
        uuidv4(),
        teacherId.trim(),
        hashed,
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
// ============================================================
async function updateTeacher(req, res) {
  const { fullName, dateOfBirth } = req.body;
  if (!fullName)
    return res.status(400).json({ message: "Vui lòng nhập họ tên." });
  try {
    await db.query(
      "UPDATE users SET full_name=?, date_of_birth=?, updated_at=NOW() WHERE id=? AND role='teacher'",
      [fullName.trim(), dateOfBirth || null, req.params.id],
    );
    return res.status(200).json({ message: "Cập nhật thành công." });
  } catch (err) {
    console.error("[adminController.updateTeacher]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers/:id/toggle-status
// ============================================================
async function toggleTeacherStatus(req, res) {
  try {
    await db.query(
      "UPDATE users SET is_active=IF(is_active=1,0,1), updated_at=NOW() WHERE id=? AND role='teacher'",
      [req.params.id],
    );
    return res.status(200).json({ message: "Cập nhật trạng thái thành công." });
  } catch (err) {
    console.error("[adminController.toggleTeacherStatus]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/teachers/:id/reset-password
// ============================================================
async function resetTeacherPassword(req, res) {
  try {
    const [rows] = await db.query(
      "SELECT date_of_birth FROM users WHERE id=? AND role='teacher' LIMIT 1",
      [req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ message: "Không tìm thấy giáo viên." });
    const hashed = await bcrypt.hash(
      dobToDefaultPassword(rows[0].date_of_birth),
      BCRYPT_ROUNDS,
    );
    await db.query(
      "UPDATE users SET password=?, must_change_password=1, updated_at=NOW() WHERE id=?",
      [hashed, req.params.id],
    );
    return res.status(200).json({ message: "Reset mật khẩu thành công." });
  } catch (err) {
    console.error("[adminController.resetTeacherPassword]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// DELETE /api/admin/teachers/:id
// ============================================================
async function deleteTeacher(req, res) {
  try {
    await db.query("DELETE FROM users WHERE id=? AND role='teacher'", [
      req.params.id,
    ]);
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
// ============================================================
async function getStudents(req, res) {
  try {
    const [students] = await db.query(
      "SELECT id, username, full_name, student_id, date_of_birth, is_active FROM users WHERE role='student' ORDER BY created_at DESC",
    );
    return res.status(200).json({
      students: students.map((s) => ({
        id: s.id,
        username: s.username,
        fullName: s.full_name,
        studentId: s.student_id,
        dateOfBirth: s.date_of_birth,
        isActive: s.is_active === 1,
      })),
    });
  } catch (err) {
    console.error("[adminController.getStudents]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/students
// Body: { studentId, fullName, dateOfBirth }
// ============================================================
async function createStudent(req, res) {
  const { studentId, fullName, dateOfBirth } = req.body;
  if (!studentId || !fullName || !dateOfBirth)
    return res
      .status(400)
      .json({ message: "Vui lòng nhập đầy đủ mã số HS, họ tên và ngày sinh." });
  try {
    const [existing] = await db.query(
      "SELECT id FROM users WHERE student_id=? OR username=? LIMIT 1",
      [studentId.trim(), studentId.trim()],
    );
    if (existing.length)
      return res.status(409).json({ message: "Mã số học sinh đã tồn tại." });
    const hashed = await bcrypt.hash(
      dobToDefaultPassword(dateOfBirth),
      BCRYPT_ROUNDS,
    );
    await db.query(
      "INSERT INTO users (id,username,password,full_name,role,student_id,date_of_birth,must_change_password,is_active,created_at,updated_at) VALUES (?,?,?,?,'student',?,?,1,1,NOW(),NOW())",
      [
        uuidv4(),
        studentId.trim(),
        hashed,
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
// Upload file Excel, tạo hàng loạt tài khoản học sinh
// ============================================================
async function importStudents(req, res) {
  try {
    const workbook = xlsx.read(req.file.buffer, {
      type: "buffer",
      cellDates: true,
    });
    const rows = xlsx.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { header: 1 },
    );
    const dataRows = rows.slice(1); // bỏ hàng tiêu đề
    let created = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const [rawId, rawName, rawDob] = dataRows[i];
      const lineNum = i + 2;
      if (!rawId && !rawName) continue; // dòng trống
      const studentId = String(rawId ?? "").trim();
      const fullName = String(rawName ?? "").trim();
      if (!studentId) {
        errors.push({ line: lineNum, reason: "Thiếu mã số HS" });
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
      let dob;
      try {
        dob = rawDob instanceof Date ? rawDob : new Date(rawDob);
        if (isNaN(dob.getTime())) throw new Error();
      } catch {
        errors.push({ line: lineNum, reason: "Ngày sinh không hợp lệ" });
        continue;
      }
      try {
        const [ex] = await db.query(
          "SELECT id FROM users WHERE student_id=? OR username=? LIMIT 1",
          [studentId, studentId],
        );
        if (ex.length) {
          errors.push({
            line: lineNum,
            reason: `Mã "${studentId}" đã tồn tại`,
          });
          continue;
        }
        const hashed = await bcrypt.hash(
          dobToDefaultPassword(dob),
          BCRYPT_ROUNDS,
        );
        await db.query(
          "INSERT INTO users (id,username,password,full_name,role,student_id,date_of_birth,must_change_password,is_active,created_at,updated_at) VALUES (?,?,?,?,'student',?,?,1,1,NOW(),NOW())",
          [
            uuidv4(),
            studentId,
            hashed,
            fullName,
            studentId,
            dob.toISOString().split("T")[0],
          ],
        );
        created++;
      } catch {
        errors.push({ line: lineNum, reason: "Lỗi lưu database" });
      }
    }
    return res.status(200).json({
      message: `Import hoàn tất: ${created} tài khoản.`,
      created,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    console.error("[adminController.importStudents]", err);
    return res.status(400).json({ message: "File không đúng định dạng." });
  }
}

// ============================================================
// PUT /api/admin/students/:id
// ============================================================
async function updateStudent(req, res) {
  const { fullName, dateOfBirth } = req.body;
  if (!fullName)
    return res.status(400).json({ message: "Vui lòng nhập họ tên." });
  try {
    await db.query(
      "UPDATE users SET full_name=?, date_of_birth=?, updated_at=NOW() WHERE id=? AND role='student'",
      [fullName.trim(), dateOfBirth || null, req.params.id],
    );
    return res.status(200).json({ message: "Cập nhật thành công." });
  } catch (err) {
    console.error("[adminController.updateStudent]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/students/:id/toggle-status
// ============================================================
async function toggleStudentStatus(req, res) {
  try {
    await db.query(
      "UPDATE users SET is_active=IF(is_active=1,0,1), updated_at=NOW() WHERE id=? AND role='student'",
      [req.params.id],
    );
    return res.status(200).json({ message: "Cập nhật trạng thái thành công." });
  } catch (err) {
    console.error("[adminController.toggleStudentStatus]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/admin/students/:id/reset-password
// ============================================================
async function resetStudentPassword(req, res) {
  try {
    const [rows] = await db.query(
      "SELECT date_of_birth FROM users WHERE id=? AND role='student' LIMIT 1",
      [req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ message: "Không tìm thấy học sinh." });
    const hashed = await bcrypt.hash(
      dobToDefaultPassword(rows[0].date_of_birth),
      BCRYPT_ROUNDS,
    );
    await db.query(
      "UPDATE users SET password=?, must_change_password=1, updated_at=NOW() WHERE id=?",
      [hashed, req.params.id],
    );
    return res.status(200).json({ message: "Reset mật khẩu thành công." });
  } catch (err) {
    console.error("[adminController.resetStudentPassword]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// DELETE /api/admin/students/:id
// ============================================================
async function deleteStudent(req, res) {
  try {
    await db.query("DELETE FROM users WHERE id=? AND role='student'", [
      req.params.id,
    ]);
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
// Lịch sử học tập của 1 học sinh — dùng trong student-detail.html
// ============================================================
async function getStudentStats(req, res) {
  const { studentId } = req.params;
  try {
    const [students] = await db.query(
      "SELECT * FROM users WHERE (id=? OR student_id=?) AND role='student' LIMIT 1",
      [studentId, studentId],
    );
    if (!students.length)
      return res.status(404).json({ message: "Không tìm thấy học sinh." });
    const s = students[0];

    const [attempts] = await db.query(
      `SELECT ea.id, e.title AS exam_title, ea.score, ea.correct_count,
              ea.total_questions, ea.finished_at,
              (SELECT COUNT(*) FROM violations v WHERE v.attempt_id=ea.id) AS violation_count
       FROM exam_attempts ea JOIN exams e ON ea.exam_id=e.id
       WHERE ea.student_id=? AND ea.is_completed=1
       ORDER BY ea.finished_at DESC`,
      [s.id],
    );

    const avgScore = attempts.length
      ? attempts.reduce((sum, a) => sum + (a.score ?? 0), 0) / attempts.length
      : null;

    return res.status(200).json({
      student: {
        id: s.id,
        fullName: s.full_name,
        studentId: s.student_id,
        dateOfBirth: s.date_of_birth,
        isActive: s.is_active === 1,
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

// ============================================================
// XUẤT ĐỦ TẤT CẢ HÀM
// ============================================================
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
