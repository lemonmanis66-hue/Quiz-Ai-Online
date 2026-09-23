const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { RateLimiterMemory } = require("rate-limiter-flexible");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 10);
const MAX_MATERIAL_CHARS = Number(process.env.MAX_MATERIAL_CHARS || 60000);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  if (allowedOrigins.length && req.headers.origin && allowedOrigins.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
  }
  next();
});

const limiter = new RateLimiterMemory({
  points: 20,
  duration: 60
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ].includes(file.mimetype) || /\.(txt|pdf|docx)$/i.test(file.originalname);
    cb(ok ? null : new Error("Format file tidak didukung. Gunakan TXT, PDF, atau DOCX."));
  }
});

function cleanText(s) {
  return String(s || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractFile(file) {
  if (!file) return "";
  const name = file.originalname.toLowerCase();

  if (name.endsWith(".txt")) return cleanText(file.buffer.toString("utf8"));

  if (name.endsWith(".pdf")) {
    const data = await pdfParse(file.buffer);
    return cleanText(data.text);
  }

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return cleanText(result.value);
  }

  throw new Error("Format file tidak didukung.");
}

function normalizeQuiz(data, requestedCount) {
  if (!data || typeof data !== "object" || !Array.isArray(data.questions)) {
    throw new Error("AI tidak mengembalikan format quiz yang valid.");
  }

  const questions = data.questions
    .map((q) => {
      if (!q || typeof q.question !== "string" || !Array.isArray(q.options)) return null;
      const options = q.options.map(x => String(x).trim()).filter(Boolean).slice(0, 4);
      const answer = Number(q.answer);
      if (options.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) return null;
      return {
        question: q.question.trim(),
        options,
        answer,
        explanation: String(q.explanation || "").trim(),
        topic: String(q.topic || "Umum").trim()
      };
    })
    .filter(Boolean);

  if (!questions.length) throw new Error("Tidak ada soal valid dari AI.");

  return {
    title: String(data.title || "Quiz AI").trim(),
    questions: questions.slice(0, requestedCount)
  };
}

async function callAI(material, count, difficulty) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY belum dikonfigurasi di server.");

  const prompt = `
Kamu adalah generator soal pendidikan yang ketat dan berbasis sumber.

MATERI SUMBER:
${material}

TUGAS:
Buat tepat ${count} soal pilihan ganda berbahasa Indonesia dengan tingkat kesulitan ${difficulty}.
Gunakan materi sumber sebagai sumber utama. Jangan mengarang fakta yang tidak didukung materi.
Variasikan tipe soal:
- pemahaman konsep
- hubungan antar-konsep
- penerapan
- analisis sederhana
Jika materi tidak cukup untuk tipe tertentu, gunakan tipe yang benar-benar didukung.

Hindari:
- jawaban benar yang selalu paling panjang
- pola posisi jawaban yang mudah ditebak
- soal ambigu
- dua opsi yang sama-sama benar
- pertanyaan di luar materi

Kembalikan HANYA JSON valid:
{
  "title": "judul quiz",
  "questions": [
    {
      "question": "pertanyaan",
      "options": ["A", "B", "C", "D"],
      "answer": 0,
      "explanation": "alasan jawaban",
      "topic": "topik yang diuji"
    }
  ]
}
` .trim();

  const response = await fetch(process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Kamu adalah pembuat soal pendidikan. Output harus JSON valid." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI provider error (${response.status}): ${body.slice(0, 300)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Respons AI kosong.");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI mengembalikan JSON yang tidak valid.");
  }

  return normalizeQuiz(parsed, count);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "quiz-ai-online", version: "2.0.0" });
});

app.post("/api/generate", upload.single("file"), async (req, res) => {
  try {
    await limiter.consume(req.ip);

    const textInput = cleanText(req.body.text);
    const fileText = await extractFile(req.file);
    const material = cleanText([textInput, fileText].filter(Boolean).join("\n\n"));

    if (material.length < 80) {
      return res.status(400).json({ error: "Materi terlalu pendek. Masukkan materi yang lebih lengkap." });
    }

    const count = Math.min(30, Math.max(5, Number(req.body.count || 10)));
    const difficulty = ["Easy", "Medium", "Hard", "Mixed"].includes(req.body.difficulty)
      ? req.body.difficulty
      : "Mixed";

    const clipped = material.slice(0, MAX_MATERIAL_CHARS);
    const quiz = await callAI(clipped, count, difficulty);

    res.json({
      ...quiz,
      meta: {
        requestedCount: count,
        difficulty,
        sourceChars: material.length,
        truncated: material.length > MAX_MATERIAL_CHARS
      }
    });
  } catch (err) {
    if (err.msBeforeNext) {
      return res.status(429).json({ error: "Terlalu banyak request. Coba lagi sebentar." });
    }
    console.error(err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan server." });
  }
});

app.use(express.static("public", {
  extensions: ["html"],
  maxAge: "1h"
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE"
      ? `File terlalu besar. Maksimal ${MAX_FILE_MB} MB.`
      : err.message });
  }
  res.status(400).json({ error: err.message || "Request tidak valid." });
});

app.listen(PORT, () => {
  console.log(`Quiz AI running on port ${PORT}`);
});
