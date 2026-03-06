import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";

const db = new Database("quiz.db");

// Inisialisasi Database
db.exec(`
  CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    start_time DATETIME,
    end_time DATETIME
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER,
    question TEXT,
    image TEXT,
    options TEXT,
    answer INTEGER,
    FOREIGN KEY(subject_id) REFERENCES subjects(id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT,
    nis TEXT,
    class TEXT,
    subject_id INTEGER,
    score INTEGER,
    correct_count INTEGER,
    total_questions INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(subject_id) REFERENCES subjects(id)
  );
`);

// Migrasi Database jika kolom subject_id belum ada di tabel questions
const tableInfo = db.prepare("PRAGMA table_info(questions)").all() as any[];
const hasSubjectId = tableInfo.some(col => col.name === 'subject_id');
if (!hasSubjectId) {
    console.log("Migrating database: Adding subject_id to questions table...");
    db.exec("DROP TABLE IF EXISTS questions");
    db.exec(`
        CREATE TABLE questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER,
            question TEXT,
            options TEXT,
            answer INTEGER,
            FOREIGN KEY(subject_id) REFERENCES subjects(id)
        )
    `);
}

// Migrasi Database: Tambah kolom image ke questions jika belum ada
const questionTableInfo = db.prepare("PRAGMA table_info(questions)").all() as any[];
const hasImage = questionTableInfo.some(col => col.name === 'image');
if (!hasImage) {
    console.log("Migrating database: Adding image column to questions table...");
    db.exec("ALTER TABLE questions ADD COLUMN image TEXT");
}

// Seed initial subject
const seedSubject = db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)");
seedSubject.run("Bahasa Indonesia");

const bahasaIndoId = (db.prepare("SELECT id FROM subjects WHERE name = ?").get("Bahasa Indonesia") as any).id;

const questionsData = [
    { question: "Tujuan utama teks laporan hasil observasi adalah...", options: JSON.stringify(["Menghibur pembaca dengan kisah nyata", "Menyampaikan informasi berdasarkan fakta hasil pengamatan", "Mengajak pembaca melakukan sesuatu", "Menyampaikan pendapat pribadi", "Menjelaskan prosedur suatu kegiatan"]), answer: 1 },
    { question: "Struktur utama dalam teks laporan hasil observasi terdiri atas...", options: JSON.stringify(["Orientasi – Komplikasi – Resolusi", "Pendahuluan – Isi – Penutup", "Pernyataan umum – Deskripsi bagian – Simpulan", "Identifikasi – Evaluasi – Orientasi", "Tujuan – Langkah-langkah – Hasil"]), answer: 2 },
    { question: "Berikut ini yang merupakan ciri kebahasaan teks laporan hasil observasi adalah...", options: JSON.stringify(["Menggunakan majas dan bahasa kias", "Mengandung opini pribadi penulis", "Menggunakan kata-kata emotif", "Menggunakan istilah teknis dan kalimat definisi", "Menggunakan kalimat ajakan dan seruan"]), answer: 3 },
    { question: "Perhatikan kutipan teks berikut:\n\"Padi merupakan tanaman pangan utama di Indonesia. Tanaman ini tumbuh subur di daerah beriklim tropis dengan curah hujan tinggi.\"\nBagian teks di atas termasuk dalam struktur...", options: JSON.stringify(["Simpulan", "Deskripsi bagian", "Pernyataan umum", "Orientasi", "Evaluasi"]), answer: 2 },
    { question: "Teks laporan hasil observasi bersifat objektif, maksudnya adalah...", options: JSON.stringify(["Menggunakan sudut pandang orang pertama", "Berdasarkan imajinasi penulis", "Berdasarkan pendapat pribadi", "Berdasarkan fakta yang dapat dibuktikan", "Mengandung unsur hiburan"]), answer: 3 },
    { question: "Tujuan utama teks eksposisi adalah...", options: JSON.stringify(["Menghibur pembaca dengan cerita menarik", "Menyampaikan pengalaman pribadi penulis", "Menjelaskan atau memaparkan suatu informasi dan pendapat secara logis", "Mempengaruhi pembaca agar mengikuti pendapat penulis", "Menyampaikan cerita berdasarkan fakta"]), answer: 2 },
    { question: "Struktur utama teks eksposisi adalah...", options: JSON.stringify(["Pendahuluan – Isi – Penutup", "Pernyataan umum – Deskripsi bagian – Simpulan", "Orientasi – Komplikasi – Resolusi", "Tesis – Argumentasi – Penegasan ulang", "Identifikasi – Evaluasi – Rekomendasi"]), answer: 3 },
    { question: "Salah satu ciri kebahasaan teks eksposisi adalah...", options: JSON.stringify(["Menggunakan kalimat perintah dan ajakan", "Menggunakan banyak majas dan gaya bahasa puitis", "Menggunakan kata-kata emotif dan perasaan", "Menggunakan kata-kata teknis dan logis", "Menggunakan kalimat tanya retoris"]), answer: 3 },
    { question: "Perhatikan kutipan berikut:\n“Pendidikan karakter penting diterapkan sejak dini. Hal ini karena anak usia dini lebih mudah dibentuk kebiasaan positif.”\nKutipan tersebut termasuk bagian struktur eksposisi, yaitu...", options: JSON.stringify(["Tesis", "Argumentasi", "Penegasan ulang", "Simpulan", "Orientasi"]), answer: 0 },
    { question: "Perhatikan pernyataan berikut:\n“Oleh karena itu, pemerintah harus lebih serius dalam menata sistem transportasi publik.”\nPernyataan di atas termasuk bagian struktur teks eksposisi yaitu...", options: JSON.stringify(["Tesis", "Argumentasi", "Penegasan ulang", "Simpulan", "Orientasi"]), answer: 2 }
];

// Cek jika tabel kosong, isi dengan data awal
const count = db.prepare("SELECT COUNT(*) as count FROM questions").get() as { count: number };
if (count.count === 0) {
    const insert = db.prepare("INSERT INTO questions (subject_id, question, options, answer) VALUES (?, ?, ?, ?)");
    for (const q of questionsData) {
        insert.run(bahasaIndoId, q.question, q.options, q.answer);
    }
}

async function startServer() {
    const app = express();
    app.use(express.json());

    const PORT = 3000;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

    // API: Ambil semua mata pelajaran
    app.get("/api/subjects", (req, res) => {
        const rows = db.prepare("SELECT * FROM subjects").all();
        res.json(rows);
    });

    // API: Ambil soal per mata pelajaran (Tanpa kunci jawaban)
    app.get("/api/questions/:subjectId", (req, res) => {
        const { subjectId } = req.params;
        const rows = db.prepare("SELECT id, question, image, options FROM questions WHERE subject_id = ?").all(subjectId) as any[];
        const questions = rows.map(row => ({
            id: row.id,
            question: row.question,
            image: row.image,
            options: JSON.parse(row.options)
        }));
        res.json(questions);
    });

    // API: Submit Jawaban
    app.post("/api/submit/:subjectId", (req, res) => {
        const { subjectId } = req.params;
        const { answers, studentData } = req.body; // Array of { id, selectedIndex }
        let score = 0;
        const results = [];

        for (const ans of answers) {
            const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(ans.id) as any;
            if (!question) continue;
            const isCorrect = question.answer === ans.selectedIndex;
            if (isCorrect) score++;
            
            results.push({
                id: ans.id,
                question: question.question,
                options: JSON.parse(question.options),
                correctAnswer: question.answer,
                userAnswer: ans.selectedIndex,
                isCorrect
            });
        }

        const totalQuestions = results.length;
        const finalScore = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

        // Simpan hasil ke database
        if (studentData) {
            db.prepare(`
                INSERT INTO results (student_name, nis, class, subject_id, score, correct_count, total_questions)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(studentData.name, studentData.nis, studentData.class, subjectId, finalScore, score, totalQuestions);
        }

        res.json({ score: finalScore, correctCount: score, total: totalQuestions, results });
    });

    // --- ADMIN ENDPOINTS ---

    // Login Admin
    app.post("/api/admin/login", (req, res) => {
        const { password } = req.body;
        if (password === ADMIN_PASSWORD) {
            res.json({ success: true, token: "fake-admin-token" });
        } else {
            res.status(401).json({ success: false, message: "Password salah" });
        }
    });

    // Middleware cek admin (sederhana)
    const isAdmin = (req: any, res: any, next: any) => {
        const token = req.headers.authorization;
        if (token === "fake-admin-token") {
            next();
        } else {
            res.status(403).json({ message: "Akses ditolak" });
        }
    };

    // Ambil semua hasil pengerjaan siswa
    app.get("/api/admin/results", isAdmin, (req, res) => {
        const rows = db.prepare(`
            SELECT r.*, s.name as subject_name 
            FROM results r
            JOIN subjects s ON r.subject_id = s.id
            ORDER BY r.timestamp DESC
        `).all();
        res.json(rows);
    });

    // Tambah Mata Pelajaran
    app.post("/api/admin/subjects", isAdmin, (req, res) => {
        const { name, start_time, end_time } = req.body;
        try {
            const info = db.prepare("INSERT INTO subjects (name, start_time, end_time) VALUES (?, ?, ?)").run(name, start_time || null, end_time || null);
            res.json({ success: true, id: info.lastInsertRowid });
        } catch (e) {
            res.status(400).json({ success: false, message: "Mata pelajaran sudah ada" });
        }
    });

    const deleteSubjectById = (id: string, res: any) => {
        const subject = db.prepare("SELECT id, name FROM subjects WHERE id = ?").get(id) as { id: number; name: string } | undefined;
        if (!subject) {
            return res.status(404).json({ success: false, message: "Mata pelajaran tidak ditemukan" });
        }

        try {
            const deleteSubjectData = db.transaction((subjectId: string) => {
                const deletedQuestions = db.prepare("DELETE FROM questions WHERE subject_id = ?").run(subjectId).changes;
                const deletedResults = db.prepare("DELETE FROM results WHERE subject_id = ?").run(subjectId).changes;
                const deletedSubject = db.prepare("DELETE FROM subjects WHERE id = ?").run(subjectId).changes;
                return { deletedQuestions, deletedResults, deletedSubject };
            });

            const result = deleteSubjectData(id);
            if (result.deletedSubject === 0) {
                return res.status(500).json({ success: false, message: "Gagal menghapus mata pelajaran" });
            }
            res.json({ success: true, ...result });
        } catch (e: any) {
            res.status(500).json({ success: false, message: e.message });
        }
    };

    // Hapus Mata Pelajaran (beserta soal dan hasil terkait)
    app.delete("/api/admin/subjects/:id", isAdmin, (req, res) => {
        deleteSubjectById(req.params.id, res);
    });

    // Fallback endpoint hapus via POST untuk menghindari masalah method DELETE pada beberapa environment
    app.post("/api/admin/subjects/:id/delete", isAdmin, (req, res) => {
        deleteSubjectById(req.params.id, res);
    });

    // Update Jadwal Mata Pelajaran
    app.put("/api/admin/subjects/:id/schedule", isAdmin, (req, res) => {
        const { id } = req.params;
        const { start_time, end_time } = req.body;
        try {
            db.prepare("UPDATE subjects SET start_time = ?, end_time = ? WHERE id = ?").run(start_time, end_time, id);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // Tambah Soal
    app.post("/api/admin/questions", isAdmin, (req, res) => {
        try {
            const { subject_id, question, image, options, answer } = req.body;
            if (!subject_id || !question || !options) {
                return res.status(400).json({ success: false, message: "Data tidak lengkap" });
            }
            const info = db.prepare(`
                INSERT INTO questions (subject_id, question, image, options, answer)
                VALUES (?, ?, ?, ?, ?)
            `).run(subject_id, question, image || null, JSON.stringify(options), answer);
            res.json({ success: true, id: info.lastInsertRowid });
        } catch (error: any) {
            console.error("Error adding question:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Tambah Soal (Bulk)
    app.post("/api/admin/questions/bulk", isAdmin, (req, res) => {
        try {
            const { subject_id, questions } = req.body;
            if (!subject_id || !questions || !Array.isArray(questions)) {
                return res.status(400).json({ success: false, message: "Data tidak lengkap" });
            }

            const insert = db.prepare(`
                INSERT INTO questions (subject_id, question, image, options, answer)
                VALUES (?, ?, ?, ?, ?)
            `);

            const insertMany = db.transaction((qs) => {
                for (const q of qs) {
                    insert.run(subject_id, q.question, q.image || null, JSON.stringify(q.options), q.answer);
                }
            });

            insertMany(questions);
            res.json({ success: true, count: questions.length });
        } catch (error: any) {
            console.error("Error bulk adding questions:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Hapus Soal
    app.delete("/api/admin/questions/:id", isAdmin, (req, res) => {
        db.prepare("DELETE FROM questions WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    });

    // Update Soal
    app.put("/api/admin/questions/:id", isAdmin, (req, res) => {
        const { id } = req.params;
        const { question, image, options, answer } = req.body;
        try {
            db.prepare(`
                UPDATE questions 
                SET question = ?, image = ?, options = ?, answer = ? 
                WHERE id = ?
            `).run(question, image || null, JSON.stringify(options), answer, id);
            res.json({ success: true });
        } catch (error: any) {
            console.error("Error updating question:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // Ambil soal per mata pelajaran (DENGAN kunci jawaban untuk admin)
    app.get("/api/admin/questions/:subjectId", isAdmin, (req, res) => {
        const rows = db.prepare("SELECT * FROM questions WHERE subject_id = ?").all(req.params.subjectId);
        const questions = rows.map((row: any) => ({
            ...row,
            options: JSON.parse(row.options)
        }));
        res.json(questions);
    });

    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        app.use(express.static(path.resolve(__dirname, "dist")));
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();
