type Env = {
  DB: any;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  ADMIN_PASSWORD?: string;
};

const ADMIN_TOKEN = "fake-admin-token";

type AnswerInput = {
  id: number;
  selectedIndex: number;
};

type StudentDataInput = {
  name: string;
  nis: string;
  class: string;
};

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

const isAdmin = (request: Request) =>
  request.headers.get("authorization") === ADMIN_TOKEN;

const safeParseOptions = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const ensureAdmin = (request: Request): Response | null => {
  if (!isAdmin(request)) {
    return json({ message: "Akses ditolak" }, 403);
  }
  return null;
};

const handleApi = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/subjects") {
    const result = await env.DB.prepare(
      "SELECT id, name, start_time, end_time FROM subjects ORDER BY id"
    ).all();
    return json(result.results ?? []);
  }

  const publicQuestionMatch = path.match(/^\/api\/questions\/(\d+)$/);
  if (method === "GET" && publicQuestionMatch) {
    const subjectId = Number(publicQuestionMatch[1]);
    const result = (await env.DB.prepare(
      "SELECT id, question, image, options FROM questions WHERE subject_id = ? ORDER BY id"
    )
      .bind(subjectId)
      .all()) as { results?: Record<string, unknown>[] };
    const questions = (result.results ?? []).map((row) => ({
      id: row.id,
      question: row.question,
      image: row.image,
      options: safeParseOptions(row.options),
    }));
    return json(questions);
  }

  const submitMatch = path.match(/^\/api\/submit\/(\d+)$/);
  if (method === "POST" && submitMatch) {
    const subjectId = Number(submitMatch[1]);
    const body = await parseJsonBody<{
      answers?: AnswerInput[];
      studentData?: StudentDataInput;
    }>(request);

    if (!body || !Array.isArray(body.answers)) {
      return json({ success: false, message: "Format request tidak valid" }, 400);
    }

    let score = 0;
    const results: Array<{
      id: number;
      question: string;
      options: string[];
      correctAnswer: number;
      userAnswer: number;
      isCorrect: boolean;
    }> = [];

    for (const ans of body.answers) {
      if (!ans || typeof ans.id !== "number" || typeof ans.selectedIndex !== "number") {
        continue;
      }
      const question = (await env.DB.prepare(
        "SELECT id, question, options, answer FROM questions WHERE id = ? AND subject_id = ?"
      )
        .bind(ans.id, subjectId)
        .first()) as
        | { id: number; question: string; options: string; answer: number }
        | null;

      if (!question) continue;

      const isCorrect = question.answer === ans.selectedIndex;
      if (isCorrect) score += 1;

      results.push({
        id: question.id,
        question: question.question,
        options: safeParseOptions(question.options),
        correctAnswer: question.answer,
        userAnswer: ans.selectedIndex,
        isCorrect,
      });
    }

    const totalQuestions = results.length;
    const finalScore =
      totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    if (
      body.studentData &&
      body.studentData.name &&
      body.studentData.nis &&
      body.studentData.class
    ) {
      await env.DB.prepare(
        "INSERT INTO results (student_name, nis, class, subject_id, score, correct_count, total_questions) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          body.studentData.name,
          body.studentData.nis,
          body.studentData.class,
          subjectId,
          finalScore,
          score,
          totalQuestions
        )
        .run();
    }

    return json({
      score: finalScore,
      correctCount: score,
      total: totalQuestions,
      results,
    });
  }

  if (method === "POST" && path === "/api/admin/login") {
    const body = await parseJsonBody<{ password?: string }>(request);
    const adminPassword = env.ADMIN_PASSWORD || "admin123";
    if (body?.password === adminPassword) {
      return json({ success: true, token: ADMIN_TOKEN });
    }
    return json({ success: false, message: "Password salah" }, 401);
  }

  if (method === "GET" && path === "/api/admin/results") {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const result = await env.DB.prepare(
      "SELECT r.*, s.name AS subject_name FROM results r JOIN subjects s ON r.subject_id = s.id ORDER BY r.timestamp DESC"
    ).all();
    return json(result.results ?? []);
  }

  if (method === "POST" && path === "/api/admin/subjects") {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const body = await parseJsonBody<{
      name?: string;
      start_time?: string | null;
      end_time?: string | null;
    }>(request);

    if (!body?.name || !body.name.trim()) {
      return json({ success: false, message: "Nama mata pelajaran wajib diisi" }, 400);
    }

    try {
      const insertResult = await env.DB.prepare(
        "INSERT INTO subjects (name, start_time, end_time) VALUES (?, ?, ?)"
      )
        .bind(body.name.trim(), body.start_time ?? null, body.end_time ?? null)
        .run();
      return json({ success: true, id: insertResult.meta.last_row_id });
    } catch {
      return json({ success: false, message: "Mata pelajaran sudah ada" }, 400);
    }
  }

  const deleteSubjectPostMatch = path.match(/^\/api\/admin\/subjects\/(\d+)\/delete$/);
  const deleteSubjectDeleteMatch = path.match(/^\/api\/admin\/subjects\/(\d+)$/);
  if (
    (method === "POST" && deleteSubjectPostMatch) ||
    (method === "DELETE" && deleteSubjectDeleteMatch)
  ) {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const subjectId = Number(
      (deleteSubjectPostMatch?.[1] ?? deleteSubjectDeleteMatch?.[1]) as string
    );

    const existing = await env.DB.prepare(
      "SELECT id, name FROM subjects WHERE id = ?"
    )
      .bind(subjectId)
      .first();
    if (!existing) {
      return json({ success: false, message: "Mata pelajaran tidak ditemukan" }, 404);
    }

    const deletedQuestions = await env.DB.prepare(
      "DELETE FROM questions WHERE subject_id = ?"
    )
      .bind(subjectId)
      .run();
    const deletedResults = await env.DB.prepare(
      "DELETE FROM results WHERE subject_id = ?"
    )
      .bind(subjectId)
      .run();
    const deletedSubject = await env.DB.prepare(
      "DELETE FROM subjects WHERE id = ?"
    )
      .bind(subjectId)
      .run();

    return json({
      success: true,
      deletedQuestions: deletedQuestions.meta.changes,
      deletedResults: deletedResults.meta.changes,
      deletedSubject: deletedSubject.meta.changes,
    });
  }

  const subjectScheduleMatch = path.match(/^\/api\/admin\/subjects\/(\d+)\/schedule$/);
  if (method === "PUT" && subjectScheduleMatch) {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const subjectId = Number(subjectScheduleMatch[1]);
    const body = await parseJsonBody<{ start_time?: string; end_time?: string }>(request);
    if (!body) {
      return json({ success: false, message: "Format request tidak valid" }, 400);
    }

    await env.DB.prepare(
      "UPDATE subjects SET start_time = ?, end_time = ? WHERE id = ?"
    )
      .bind(body.start_time ?? null, body.end_time ?? null, subjectId)
      .run();
    return json({ success: true });
  }

  if (method === "POST" && path === "/api/admin/questions") {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const body = await parseJsonBody<{
      subject_id?: number;
      question?: string;
      image?: string | null;
      options?: string[];
      answer?: number;
    }>(request);

    if (
      !body ||
      !body.subject_id ||
      !body.question ||
      !Array.isArray(body.options) ||
      typeof body.answer !== "number"
    ) {
      return json({ success: false, message: "Data tidak lengkap" }, 400);
    }

    const insertResult = await env.DB.prepare(
      "INSERT INTO questions (subject_id, question, image, options, answer) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        body.subject_id,
        body.question,
        body.image ?? null,
        JSON.stringify(body.options),
        body.answer
      )
      .run();

    return json({ success: true, id: insertResult.meta.last_row_id });
  }

  if (method === "POST" && path === "/api/admin/questions/bulk") {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const body = await parseJsonBody<{
      subject_id?: number;
      questions?: Array<{
        question: string;
        image?: string | null;
        options: string[];
        answer: number;
      }>;
    }>(request);

    if (!body?.subject_id || !Array.isArray(body.questions)) {
      return json({ success: false, message: "Data tidak lengkap" }, 400);
    }

    for (const q of body.questions) {
      await env.DB.prepare(
        "INSERT INTO questions (subject_id, question, image, options, answer) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(
          body.subject_id,
          q.question,
          q.image ?? null,
          JSON.stringify(q.options),
          q.answer
        )
        .run();
    }

    return json({ success: true, count: body.questions.length });
  }

  const adminQuestionByIdMatch = path.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (method === "DELETE" && adminQuestionByIdMatch) {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const id = Number(adminQuestionByIdMatch[1]);
    await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
    return json({ success: true });
  }

  if (method === "PUT" && adminQuestionByIdMatch) {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const id = Number(adminQuestionByIdMatch[1]);
    const body = await parseJsonBody<{
      question?: string;
      image?: string | null;
      options?: string[];
      answer?: number;
    }>(request);

    if (
      !body ||
      !body.question ||
      !Array.isArray(body.options) ||
      typeof body.answer !== "number"
    ) {
      return json({ success: false, message: "Data tidak lengkap" }, 400);
    }

    await env.DB.prepare(
      "UPDATE questions SET question = ?, image = ?, options = ?, answer = ? WHERE id = ?"
    )
      .bind(
        body.question,
        body.image ?? null,
        JSON.stringify(body.options),
        body.answer,
        id
      )
      .run();
    return json({ success: true });
  }

  const adminQuestionsBySubjectMatch = path.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (method === "GET" && adminQuestionsBySubjectMatch) {
    const denied = ensureAdmin(request);
    if (denied) return denied;

    const subjectId = Number(adminQuestionsBySubjectMatch[1]);
    const result = (await env.DB.prepare(
      "SELECT id, subject_id, question, image, options, answer FROM questions WHERE subject_id = ? ORDER BY id"
    )
      .bind(subjectId)
      .all()) as { results?: Record<string, unknown>[] };

    const questions = (result.results ?? []).map((row) => ({
      ...row,
      options: safeParseOptions(row.options),
    }));
    return json(questions);
  }

  return json({ message: "Endpoint tidak ditemukan" }, 404);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env);
      }

      if (!env.ASSETS) {
        return new Response("Static assets belum tersedia. Jalankan build frontend.", {
          status: 500,
        });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled error:", error);
      return json({ success: false, message: "Terjadi kesalahan server" }, 500);
    }
  },
};
