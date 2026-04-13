// ============================================================
// services/importService.js — Đọc file Excel, tạo tài khoản hàng loạt
//
// Tại sao tách thành service riêng?
//   adminController chỉ lo nhận file và trả response
//   Service lo việc đọc Excel + validate + lưu DB
//   Dễ tái sử dụng nếu sau này cần import từ nhiều route
//
// Chức năng:
//   importStudentsFromBuffer — đọc buffer Excel → tạo tài khoản HS hàng loạt
//   importQuestionsFromBuffer — đọc buffer Excel → tạo câu hỏi hàng loạt
//
// Cấu trúc file Excel import học sinh (hàng 1 = tiêu đề, bỏ qua):
//   Cột A: Mã số học sinh
//   Cột B: Họ và tên
//   Cột C: Ngày sinh (định dạng yyyy-mm-dd hoặc dd/mm/yyyy)
//
// Cấu trúc file Excel import câu hỏi (hàng 1 = tiêu đề, bỏ qua):
//   Cột A: Nội dung câu hỏi
//   Cột B: Môn học
//   Cột C: Chủ đề
//   Cột D: Mức độ (easy/medium/hard)
//   Cột E: Điểm
//   Cột F: Đáp án A
//   Cột G: Đáp án B
//   Cột H: Đáp án C
//   Cột I: Đáp án D
//   Cột J: Đáp án đúng (A/B/C/D)
// ============================================================

const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const xlsx = require("xlsx");
const db = require("../config/database");

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// ============================================================
// Hàm tiện ích: ngày sinh → mật khẩu mặc định ddmmyyyy
// VD: 2003-06-08 → "08062003"
// ============================================================
function dobToDefaultPassword(dateOfBirth) {
  const d = new Date(dateOfBirth);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

// ============================================================
// importStudentsFromBuffer
// Đọc file Excel từ buffer → tạo tài khoản học sinh hàng loạt
//
// Tham số:
//   buffer — req.file.buffer (từ uploadMiddleware)
//
// Trả về:
//   { created, skipped, errors }
// ============================================================
async function importStudentsFromBuffer(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const rows = xlsx.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1 },
  );

  const dataRows = rows.slice(1); // bỏ hàng tiêu đề
  let created = 0;
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const [rawId, rawName, rawDob] = dataRows[i];
    const lineNum = i + 2; // +2: bỏ tiêu đề + index 0-based

    // Bỏ qua dòng hoàn toàn trống
    if (!rawId && !rawName) continue;

    const studentId = String(rawId ?? "").trim();
    const fullName = String(rawName ?? "").trim();

    // Validate từng trường
    if (!studentId) {
      errors.push({ line: lineNum, reason: "Thiếu mã số học sinh (cột A)" });
      continue;
    }
    if (!fullName) {
      errors.push({ line: lineNum, reason: "Thiếu họ tên (cột B)" });
      continue;
    }
    if (!rawDob) {
      errors.push({ line: lineNum, reason: "Thiếu ngày sinh (cột C)" });
      continue;
    }

    // Parse ngày sinh
    let dob;
    try {
      dob = rawDob instanceof Date ? rawDob : new Date(rawDob);
      if (isNaN(dob.getTime())) throw new Error();
    } catch {
      errors.push({ line: lineNum, reason: "Ngày sinh không hợp lệ" });
      continue;
    }

    try {
      // Kiểm tra mã số đã tồn tại chưa
      const [existing] = await db.query(
        "SELECT id FROM users WHERE student_id = ? OR username = ? LIMIT 1",
        [studentId, studentId],
      );
      if (existing.length) {
        errors.push({
          line: lineNum,
          reason: `Mã "${studentId}" đã tồn tại trong hệ thống`,
        });
        continue;
      }

      // Mật khẩu mặc định = ngày sinh định dạng ddmmyyyy
      const dobStr = dob.toISOString().split("T")[0]; // yyyy-mm-dd
      const hashed = await bcrypt.hash(
        dobToDefaultPassword(dob),
        BCRYPT_ROUNDS,
      );

      await db.query(
        `INSERT INTO users
           (id, username, password, full_name, role, student_id, date_of_birth,
            must_change_password, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'student', ?, ?, 1, 1, NOW(), NOW())`,
        [uuidv4(), studentId, hashed, fullName, studentId, dobStr],
      );
      created++;
    } catch {
      errors.push({ line: lineNum, reason: "Lỗi lưu vào database" });
    }
  }

  return { created, skipped: errors.length, errors };
}

// ============================================================
// importQuestionsFromBuffer
// Đọc file Excel từ buffer → tạo câu hỏi hàng loạt
//
// Tham số:
//   buffer — req.file.buffer (từ uploadMiddleware)
//   examId — gán câu hỏi vào đề thi nào (có thể null)
//
// Trả về:
//   { created, skipped, errors }
// ============================================================
async function importQuestionsFromBuffer(buffer, examId = null) {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const rows = xlsx.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1 },
  );

  const dataRows = rows.slice(1); // bỏ hàng tiêu đề
  let created = 0;
  const errors = [];

  for (let i = 0; i < dataRows.length; i++) {
    const [content, subject, topic, difficulty, points, a, b, c, d, correct] =
      dataRows[i];
    const lineNum = i + 2;

    // Bỏ qua dòng trống
    if (!content && !a) continue;

    // Validate
    if (!content) {
      errors.push({ line: lineNum, reason: "Thiếu nội dung câu hỏi (cột A)" });
      continue;
    }
    if (!a || !b || !c || !d) {
      errors.push({ line: lineNum, reason: "Thiếu đáp án A/B/C/D (cột F-I)" });
      continue;
    }
    if (!correct) {
      errors.push({ line: lineNum, reason: "Thiếu đáp án đúng (cột J)" });
      continue;
    }

    const correctKey = String(correct).toUpperCase().trim();
    if (!["A", "B", "C", "D"].includes(correctKey)) {
      errors.push({
        line: lineNum,
        reason: `Đáp án đúng "${correct}" không hợp lệ — phải là A, B, C hoặc D`,
      });
      continue;
    }

    try {
      const questionId = uuidv4();
      await db.query(
        `INSERT INTO questions
           (id, exam_id, content, subject, topic, difficulty, points, source, order_index, created_at, updated_at)
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

      // Lưu 4 đáp án
      const answerLabels = ["A", "B", "C", "D"];
      const answerValues = [a, b, c, d];
      for (let j = 0; j < 4; j++) {
        await db.query(
          "INSERT INTO answers (id, question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?, ?)",
          [
            uuidv4(),
            questionId,
            String(answerValues[j]).trim(),
            answerLabels[j] === correctKey ? 1 : 0,
            j,
          ],
        );
      }
      created++;
    } catch {
      errors.push({ line: lineNum, reason: "Lỗi lưu vào database" });
    }
  }

  return { created, skipped: errors.length, errors };
}

module.exports = { importStudentsFromBuffer, importQuestionsFromBuffer };
