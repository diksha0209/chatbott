import 'dotenv/config';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { extractText } from 'unpdf';
import type { GeneratedPdfSpec, PdfSection } from './src/types/chat.ts';

const PORT = Number(process.env.PORT) || 3000;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_FREE_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const FREE_MODEL_FALLBACKS = Array.from(
  new Set([
    PRIMARY_FREE_MODEL,
    'openrouter/free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3.5-super-vl:free',
    'inclusionai/ling-3.2-flash:free',
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
  ]),
);

function getOpenRouterHeaders(): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured in environment variables.');
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
    'X-Title': 'FolioMind',
  };
}

function getFriendlyProviderError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('401') || raw.includes('403') || raw.includes('Unauthorized') || raw.includes('invalid')) {
    return {
      status: 403,
      message: 'OpenRouter API key error. Please verify OPENROUTER_API_KEY configuration.',
    };
  }
  if (raw.includes('429') || raw.includes('rate limit') || raw.includes('Rate limit')) {
    return {
      status: 429,
      message: 'OpenRouter free-tier rate limit reached. Please wait a few seconds and try again.',
    };
  }
  if (raw.includes('OPENROUTER_API_KEY is not configured')) {
    return { status: 500, message: raw };
  }
  return { status: 500, message: raw || 'Unexpected server error.' };
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (!trimmed) return {};

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence) as Record<string, unknown>;
  } catch {
    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    }
    return {};
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | null
    | Array<
        | { type: 'text'; text: string }
        | { type: 'file'; file: { filename: string; file_data: string } }
      >;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

async function callOpenRouterCompletion(params: {
  messages: OpenRouterMessage[];
  responseFormatJson?: boolean;
  plugins?: Array<{ id: string; pdf?: { engine: string } }>;
  timeoutMs?: number;
}): Promise<{ text: string; modelUsed?: string }> {
  const headers = getOpenRouterHeaders();
  const candidates = FREE_MODEL_FALLBACKS;
  let lastError = 'OpenRouter request failed.';

  for (const model of candidates) {
    const controller = new AbortController();
    const timer = params.timeoutMs
      ? setTimeout(() => controller.abort(), params.timeoutMs)
      : null;

    try {
      const body: Record<string, unknown> = {
        model,
        messages: params.messages,
        ...(params.responseFormatJson ? { response_format: { type: 'json_object' } } : {}),
        ...(params.plugins ? { plugins: params.plugins } : {}),
      };

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text();
        lastError = `OpenRouter (${response.status}): ${errBody.slice(0, 300)}`;
        if (response.status === 401 || response.status === 403) {
          throw new Error(lastError);
        }
        continue;
      }

      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        error?: { message?: string; code?: number };
      };

      if (data.error) {
        lastError = data.error.message || 'OpenRouter error';
        continue;
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        return { text: content, modelUsed: data.model || model };
      }
      lastError = 'Model returned an empty response.';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (lastError.includes('401') || lastError.includes('403')) {
        throw err;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

interface StreamPassResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  modelUsed: string;
}

async function streamOpenRouterPass(
  params: {
    messages: OpenRouterMessage[];
    tools?: unknown[];
  },
  onDelta: (text: string) => void,
): Promise<StreamPassResult> {
  const headers = getOpenRouterHeaders();
  let lastError = 'OpenRouter streaming request failed.';

  for (const model of FREE_MODEL_FALLBACKS) {
    const controller = new AbortController();
    let inactivityTimer = setTimeout(() => controller.abort(), 25000);
    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), 25000);
    };

    try {
      const body: Record<string, unknown> = {
        model,
        stream: true,
        messages: params.messages,
        ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
      };

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        lastError = `OpenRouter (${response.status}): ${errText.slice(0, 300)}`;
        if (response.status === 401 || response.status === 403) {
          throw new Error(lastError);
        }
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let actualModel = model;
      const toolMap = new Map<number, { id: string; name: string; arguments: string }>();
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetTimer();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':') || !line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const chunk = JSON.parse(dataStr) as {
              model?: string;
              error?: { message?: string };
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };

            if (chunk.error?.message) {
              streamError = chunk.error.message;
              break;
            }
            if (chunk.model) actualModel = chunk.model;

            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              fullText += delta.content;
              onDelta(delta.content);
            }

            if (Array.isArray(delta?.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = toolMap.get(idx) || {
                  id: tc.id || `call_${idx}`,
                  name: '',
                  arguments: '',
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                toolMap.set(idx, existing);
              }
            }
          } catch {
            // Ignore partial or non-JSON keepalive frames
          }
        }

        if (streamError) break;
      }

      if (streamError) {
        lastError = streamError;
        if (fullText.trim()) {
          return {
            text: fullText,
            toolCalls: Array.from(toolMap.values()),
            modelUsed: actualModel,
          };
        }
        continue;
      }

      const toolCalls = Array.from(toolMap.values()).filter((t) => t.name);
      if (fullText.trim() || toolCalls.length > 0) {
        return { text: fullText, toolCalls, modelUsed: actualModel };
      }
      lastError = 'Free model returned an empty stream.';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (lastError.includes('401') || lastError.includes('403')) {
        throw err;
      }
    } finally {
      clearTimeout(inactivityTimer);
    }
  }

  throw new Error(lastError);
}

function sanitizeFilename(name: string): string {
  const base = (name || 'document')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${base || 'document'}.pdf`;
}

function normalizePdfSpec(raw: Record<string, unknown>, fallbackAuthor?: string): GeneratedPdfSpec {
  const title =
    typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'FolioMind Document';
  const subtitle =
    typeof raw.subtitle === 'string' && raw.subtitle.trim() ? raw.subtitle.trim() : undefined;
  const author =
    typeof raw.author === 'string' && raw.author.trim()
      ? raw.author.trim()
      : fallbackAuthor || 'FolioMind';
  const summary =
    typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : undefined;
  const rawFileName =
    typeof raw.fileName === 'string' && raw.fileName.trim() ? raw.fileName : title;
  const fileName = sanitizeFilename(rawFileName);

  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: PdfSection[] = rawSections
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .slice(0, 40)
    .map((s) => {
      const heading =
        typeof s.heading === 'string' && s.heading.trim() ? s.heading.trim() : 'Section';
      const body = typeof s.body === 'string' && s.body.trim() ? s.body.trim() : undefined;
      const bullets = Array.isArray(s.bullets)
        ? s.bullets.map((b) => String(b).trim()).filter(Boolean).slice(0, 40)
        : undefined;

      let table: PdfSection['table'] | undefined;
      if (s.table && typeof s.table === 'object') {
        const t = s.table as Record<string, unknown>;
        const headers = Array.isArray(t.headers)
          ? t.headers.map((h) => String(h).trim()).filter(Boolean).slice(0, 10)
          : [];
        const rows = Array.isArray(t.rows)
          ? t.rows
              .filter((r): r is unknown[] => Array.isArray(r))
              .slice(0, 50)
              .map((r) => headers.map((_, idx) => String(r[idx] ?? '').trim()))
          : [];
        if (headers.length > 0 && rows.length > 0) {
          table = { headers, rows };
        }
      }

      return {
        heading,
        ...(body ? { body } : {}),
        ...(bullets && bullets.length > 0 ? { bullets } : {}),
        ...(table ? { table } : {}),
      };
    });

  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    author,
    fileName,
    createdAtIso: new Date().toISOString(),
    ...(summary ? { summary } : {}),
    sections:
      sections.length > 0
        ? sections
        : [{ heading: 'Overview', body: summary || 'Generated from FolioMind conversation.' }],
  };
}

async function renderPdfBuffer(spec: GeneratedPdfSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 64, bottom: 24, left: 54, right: 54 },
      bufferPages: true,
      info: {
        Title: spec.title,
        Author: spec.author || 'FolioMind',
        Subject: spec.subtitle || spec.title,
        Creator: 'FolioMind PDF Engine',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = 54;
    const right = pageWidth - 54;
    const contentWidth = right - left;
    const bottomLimit = pageHeight - 72;

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > bottomLimit) {
        doc.addPage();
        doc.y = 64;
      }
    };

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(22).text(spec.title, left, 56, {
      width: contentWidth,
      lineGap: 3,
    });

    if (spec.subtitle) {
      doc.moveDown(0.3);
      doc.fillColor('#475569').font('Helvetica').fontSize(11.5).text(spec.subtitle, {
        width: contentWidth,
        lineGap: 2,
      });
    }

    doc.moveDown(0.45);
    const formattedDate = new Date(spec.createdAtIso || Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const metaLine = [spec.author ? `Prepared by ${spec.author}` : null, formattedDate]
      .filter(Boolean)
      .join('  ·  ');
    doc.fillColor('#64748b').font('Helvetica').fontSize(9.5).text(metaLine, {
      width: contentWidth,
    });

    doc.moveDown(0.6);
    doc
      .strokeColor('#cbd5e1')
      .lineWidth(1)
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .stroke();
    doc.moveDown(0.9);

    if (spec.summary) {
      doc.font('Helvetica').fontSize(10.5);
      const summaryHeight = doc.heightOfString(spec.summary, {
        width: contentWidth - 28,
        lineGap: 3,
      });
      const boxHeight = summaryHeight + 36;
      ensureSpace(boxHeight + 12);

      const boxTop = doc.y;
      doc
        .roundedRect(left, boxTop, contentWidth, boxHeight, 6)
        .fillAndStroke('#f1f5f9', '#e2e8f0');

      doc
        .fillColor('#1e40af')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('EXECUTIVE SUMMARY', left + 14, boxTop + 10, {
          width: contentWidth - 28,
        });

      doc
        .fillColor('#1e293b')
        .font('Helvetica')
        .fontSize(10.5)
        .text(spec.summary, left + 14, boxTop + 25, {
          width: contentWidth - 28,
          lineGap: 3,
        });

      doc.y = boxTop + boxHeight + 16;
    }

    for (const section of spec.sections) {
      ensureSpace(48);

      doc
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(13.5)
        .text(section.heading, left, doc.y, {
          width: contentWidth,
        });

      doc.moveDown(0.25);
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.6)
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .stroke();
      doc.moveDown(0.45);

      if (section.body) {
        const paragraphs = section.body.split(/\n{2,}/).filter((p) => p.trim());
        for (const para of paragraphs) {
          doc.font('Helvetica').fontSize(10.5);
          const pHeight = doc.heightOfString(para.trim(), {
            width: contentWidth,
            lineGap: 3.5,
          });
          ensureSpace(Math.min(pHeight, 120));
          doc
            .fillColor('#1e293b')
            .font('Helvetica')
            .fontSize(10.5)
            .text(para.trim(), left, doc.y, {
              width: contentWidth,
              lineGap: 3.5,
              align: 'left',
            });
          doc.moveDown(0.5);
        }
      }

      if (section.bullets && section.bullets.length > 0) {
        for (const bullet of section.bullets) {
          doc.font('Helvetica').fontSize(10.2);
          const bHeight = doc.heightOfString(bullet, {
            width: contentWidth - 18,
            lineGap: 3,
          });
          ensureSpace(bHeight + 6);
          const startY = doc.y;
          doc
            .fillColor('#2563eb')
            .font('Helvetica-Bold')
            .fontSize(10.5)
            .text('•', left + 4, startY);
          doc
            .fillColor('#1e293b')
            .font('Helvetica')
            .fontSize(10.2)
            .text(bullet, left + 18, startY, {
              width: contentWidth - 18,
              lineGap: 3,
            });
          doc.moveDown(0.28);
        }
        doc.moveDown(0.35);
      }

      if (section.table && section.table.headers.length > 0) {
        const colCount = section.table.headers.length;
        const colWidth = contentWidth / colCount;
        const cellPadX = 6;
        const cellPadY = 6;

        const drawRow = (cells: string[], isHeader: boolean, rowIndex: number) => {
          doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.2);
          const cellHeights = cells.map((cell) =>
            doc.heightOfString(cell || ' ', {
              width: colWidth - cellPadX * 2,
              lineGap: 2,
            }),
          );
          const rowHeight = Math.max(...cellHeights, 14) + cellPadY * 2;
          ensureSpace(rowHeight + 4);
          const rowTop = doc.y;

          const fillColor = isHeader
            ? '#0f172a'
            : rowIndex % 2 === 1
              ? '#f8fafc'
              : '#ffffff';

          doc
            .rect(left, rowTop, contentWidth, rowHeight)
            .fillAndStroke(fillColor, '#cbd5e1');

          cells.forEach((cell, cIdx) => {
            const cellX = left + cIdx * colWidth;
            if (cIdx > 0) {
              doc
                .strokeColor('#cbd5e1')
                .lineWidth(0.5)
                .moveTo(cellX, rowTop)
                .lineTo(cellX, rowTop + rowHeight)
                .stroke();
            }
            doc
              .fillColor(isHeader ? '#ffffff' : '#1e293b')
              .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(9.2)
              .text(cell || '', cellX + cellPadX, rowTop + cellPadY, {
                width: colWidth - cellPadX * 2,
                lineGap: 2,
              });
          });

          doc.y = rowTop + rowHeight;
        };

        drawRow(section.table.headers, true, 0);
        section.table.rows.forEach((row, idx) => drawRow(row, false, idx));
        doc.moveDown(0.8);
      }

      doc.moveDown(0.4);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const pageNum = i - range.start + 1;

      if (pageNum > 1) {
        doc
          .fillColor('#94a3b8')
          .font('Helvetica')
          .fontSize(8.5)
          .text(spec.title, left, 28, {
            width: contentWidth,
            align: 'left',
            ellipsis: true,
            lineBreak: false,
          });
      }

      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .moveTo(left, pageHeight - 44)
        .lineTo(right, pageHeight - 44)
        .stroke();

      doc
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          `FolioMind  ·  Page ${pageNum} of ${range.count}`,
          left,
          pageHeight - 34,
          { width: contentWidth, align: 'right', lineBreak: false },
        );
    }

    doc.end();
  });
}

const openRouterPdfTool = {
  type: 'function',
  function: {
    name: 'create_pdf_document',
    description:
      'Generate a clean, structured, downloadable PDF document for the user whenever they ask to create, export, generate, or save a PDF from the conversation, uploaded PDFs, or newly drafted content.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Clear document title displayed at the top of the PDF.',
        },
        subtitle: {
          type: 'string',
          description: 'Optional concise subtitle or context line.',
        },
        fileName: {
          type: 'string',
          description: 'Clean filename ending with .pdf (e.g., quarterly-summary.pdf).',
        },
        summary: {
          type: 'string',
          description: 'Concise executive summary paragraph for the callout box.',
        },
        sections: {
          type: 'array',
          description: 'Ordered sections making up the full PDF body.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'Section heading.' },
              body: {
                type: 'string',
                description: 'Paragraph prose for this section (paragraphs separated by blank lines).',
              },
              bullets: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of concise bullet points.',
              },
              table: {
                type: 'object',
                description: 'Optional structured data table.',
                properties: {
                  headers: { type: 'array', items: { type: 'string' } },
                  rows: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'string' } },
                  },
                },
                required: ['headers', 'rows'],
              },
            },
            required: ['heading'],
          },
        },
      },
      required: ['title', 'fileName', 'sections'],
    },
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      provider: 'openrouter',
      model: PRIMARY_FREE_MODEL,
    });
  });

  // 1. Parse uploaded PDF (unpdf page-by-page extraction + OpenRouter file-parser OCR fallback for scanned PDFs)
  app.post('/api/pdf/parse', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No PDF file was uploaded.' });
        return;
      }
      const isPdf =
        file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        res.status(400).json({ error: 'Only PDF files are supported.' });
        return;
      }

      let pageCount = 1;
      let extractedText = '';
      let isScannedFallback = false;

      try {
        const result = await extractText(new Uint8Array(file.buffer), { mergePages: false });
        pageCount = result.totalPages || 1;
        const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
        extractedText = pages
          .map((pageText, idx) => `[Page ${idx + 1}]\n${pageText.trim()}`)
          .join('\n\n')
          .trim();
      } catch {
        extractedText = '';
      }

      // If PDF is scanned or image-based (< 80 alphanumeric chars), read via OpenRouter PDF parser/OCR
      const alphanumericCount = extractedText.replace(/[^a-zA-Z0-9]/g, '').length;
      if (alphanumericCount < 80 && process.env.OPENROUTER_API_KEY) {
        isScannedFallback = true;
        try {
          const ocrResult = await callOpenRouterCompletion({
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Transcribe the complete readable contents of this PDF page-by-page using [Page N] markers, preserving headings, tables (as Markdown tables), key numbers, and important details accurately.',
                  },
                  {
                    type: 'file',
                    file: {
                      filename: file.originalname,
                      file_data: `data:application/pdf;base64,${file.buffer.toString('base64')}`,
                    },
                  },
                ],
              },
            ],
            plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
            timeoutMs: 25000,
          });
          extractedText = ocrResult.text.trim();
        } catch {
          // Retain fallback notice if OCR fails
        }
      }

      if (!extractedText) {
        extractedText = `[Document: ${file.originalname} — ${pageCount} page(s), no extractable text found]`;
      }

      const clampedText =
        extractedText.length > 440000
          ? `${extractedText.slice(0, 439500)}\n\n[Truncated at 440,000 characters for storage]`
          : extractedText;

      const deterministicFallback = clampedText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);

      let summary = deterministicFallback || `Parsed ${pageCount} page(s) from ${file.originalname}.`;

      if (process.env.OPENROUTER_API_KEY) {
        try {
          const digestInput = clampedText.slice(0, 36000);
          const summaryRes = await callOpenRouterCompletion({
            messages: [
              {
                role: 'user',
                content: `Summarize the key facts, structure, and purpose of this PDF document ("${file.originalname}", ${pageCount} pages) in 3-4 concise bullet points:\n\n${digestInput}`,
              },
            ],
            timeoutMs: 8000,
          });
          if (summaryRes.text.trim()) {
            summary = summaryRes.text.trim().slice(0, 7500);
          }
        } catch {
          // Keep deterministic excerpt fallback if summary generation times out
        }
      }

      res.json({
        fileName: file.originalname,
        pageCount,
        fileSize: file.size,
        extractedText: clampedText,
        summary,
        isScannedFallback,
      });
    } catch (error) {
      const { status, message } = getFriendlyProviderError(error);
      res.status(status).json({ error: message });
    }
  });

  // 2. Stream full-memory chat turn via OpenRouter free models (Turn 1 -> end + all PDFs + create_pdf_document tool)
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const {
        history = [],
        documents = [],
        memorySummary = '',
        userMessage = '',
        userDisplayName = 'User',
      } = req.body as {
        history: Array<{
          role: 'user' | 'assistant';
          content: string;
          turnIndex: number;
          attachments?: Array<{ fileName: string; pageCount: number }>;
          generatedPdf?: { title: string; fileName: string };
        }>;
        documents: Array<{
          fileName: string;
          pageCount: number;
          extractedText: string;
          summary: string;
        }>;
        memorySummary?: string;
        userMessage: string;
        userDisplayName?: string;
      };

      if (!userMessage || !userMessage.trim()) {
        sendEvent({ type: 'error', error: 'Message cannot be empty.' });
        res.end();
        return;
      }

      const docContextBlock =
        documents.length > 0
          ? documents
              .map(
                (d, idx) =>
                  `=== ATTACHED PDF #${idx + 1}: "${d.fileName}" (${d.pageCount} pages) ===\nSummary:\n${d.summary}\n\nFull Extracted Text:\n${d.extractedText}`,
              )
              .join('\n\n')
          : 'No PDF documents have been uploaded in this thread yet.';

      const memoryAnchorBlock = memorySummary.trim()
        ? `\n\n=== THREAD MEMORY ANCHOR (DISTILLED FROM TURN 1 TO PREVIOUS TURN) ===\n${memorySummary.trim()}`
        : '';

      const systemPrompt = `You are FolioMind, a precise and helpful AI assistant with complete end-to-end conversation memory and PDF reading/generation capabilities.

CORE MEMORY MANDATE:
- You are provided the COMPLETE ordered conversation history starting from Turn 1 to the present turn, plus every PDF document uploaded anywhere in this chat.
- You MUST remember and honor details, names, constraints, numbers, facts, and decisions from the very beginning of the chat (Turn 1) through the latest turn.
- If the user asks what was discussed earlier, at the start of the chat, or across specific turns, recall accurately and cite the turn or context.
- When referencing uploaded PDFs, cite the exact document filename and [Page N] whenever available.

PDF GENERATION TOOL:
- Whenever the user asks to generate, create, export, build, or download a PDF (e.g., "make a PDF", "export our chat as PDF", "create a report PDF from this document"), you MUST call the \`create_pdf_document\` tool with rich, well-organized sections, clear headings, thorough prose, bullet points, and tables where helpful.
- After \`create_pdf_document\` executes, briefly summarize what you put inside the generated PDF and let the user know they can preview or download it from the attached PDF card.
${memoryAnchorBlock}

=== PERSISTENT PDF DOCUMENTS IN THIS CHAT ===
${docContextBlock}`;

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((msg): OpenRouterMessage => {
          const attachmentNote =
            msg.attachments && msg.attachments.length > 0
              ? `\n[Attached PDF(s): ${msg.attachments.map((a) => `${a.fileName} (${a.pageCount} pages)`).join(', ')}]`
              : '';
          const pdfNote = msg.generatedPdf
            ? `\n[Generated PDF: "${msg.generatedPdf.title}" (${msg.generatedPdf.fileName})]`
            : '';
          return {
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: `[Turn ${msg.turnIndex}] ${msg.content}${attachmentNote}${pdfNote}`,
          };
        }),
      ];

      const nextTurnIndex =
        history.length > 0 ? history[history.length - 1].turnIndex + 1 : 1;
      messages.push({
        role: 'user',
        content: `[Turn ${nextTurnIndex}] ${userMessage}`,
      });

      const pass1 = await streamOpenRouterPass(
        { messages, tools: [openRouterPdfTool] },
        (delta) => sendEvent({ type: 'delta', text: delta }),
      );

      let streamedText = pass1.text;
      const pdfCall = pass1.toolCalls.find((tc) => tc.name === 'create_pdf_document');

      if (pdfCall) {
        const parsedArgs = extractJsonObject(pdfCall.arguments);
        const spec = normalizePdfSpec(parsedArgs, userDisplayName);
        sendEvent({ type: 'pdf', generatedPdf: spec });

        const followUpMessages: OpenRouterMessage[] = [
          ...messages,
          {
            role: 'assistant',
            content: pass1.text || null,
            tool_calls: [
              {
                id: pdfCall.id,
                type: 'function',
                function: {
                  name: 'create_pdf_document',
                  arguments: pdfCall.arguments || '{}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: pdfCall.id,
            content: JSON.stringify({
              status: 'success',
              fileName: spec.fileName,
              title: spec.title,
              sectionCount: spec.sections.length,
            }),
          },
        ];

        try {
          const pass2 = await streamOpenRouterPass(
            { messages: followUpMessages },
            (delta) => sendEvent({ type: 'delta', text: delta }),
          );
          streamedText += pass2.text;
        } catch {
          const fallbackConfirm = `I have generated **${spec.title}** (\`${spec.fileName}\`) with ${spec.sections.length} sections. You can preview or download it using the card below.`;
          streamedText += fallbackConfirm;
          sendEvent({ type: 'delta', text: fallbackConfirm });
        }
      }

      if (!streamedText.trim() && !pdfCall) {
        sendEvent({
          type: 'delta',
          text: 'I processed your message, though no text output was returned. Could you clarify your request?',
        });
      }

      sendEvent({ type: 'done' });
      res.end();
    } catch (error) {
      const { message } = getFriendlyProviderError(error);
      sendEvent({ type: 'error', error: message });
      res.end();
    }
  });

  // 3. Distill / refresh full-thread memory ledger & smart title via OpenRouter free models
  app.post('/api/chat/memory', async (req: Request, res: Response) => {
    try {
      const {
        history = [],
        documents = [],
        currentTitle = 'New Conversation',
      } = req.body as {
        history: Array<{ role: string; content: string; turnIndex: number }>;
        documents: Array<{ fileName: string; pageCount: number; summary: string }>;
        currentTitle?: string;
      };

      if (history.length === 0) {
        res.json({ title: currentTitle, memorySummary: '' });
        return;
      }

      const transcript = history
        .map((m) => `Turn ${m.turnIndex} (${m.role.toUpperCase()}): ${m.content.slice(0, 4000)}`)
        .join('\n\n');
      const docsInfo =
        documents.length > 0
          ? `\nAttached PDFs:\n${documents.map((d) => `- ${d.fileName} (${d.pageCount} pages): ${d.summary}`).join('\n')}`
          : '';

      const needsTitle =
        !currentTitle ||
        currentTitle === 'New Conversation' ||
        currentTitle === 'Untitled Chat';

      const result = await callOpenRouterCompletion({
        messages: [
          {
            role: 'system',
            content:
              'You return strictly valid JSON with keys "title" (string) and "memorySummary" (string). No markdown fences or extra commentary.',
          },
          {
            role: 'user',
            content: `Analyze this complete conversation from Turn 1 to the latest turn and return a JSON object with:
- "title": A concise, descriptive conversation title (3-7 words) ${needsTitle ? '(generate a fresh title)' : `(keep or refine "${currentTitle}")`}.
- "memorySummary": A chronological Memory Ledger summarizing every important fact, user preference, entity, question, answer, and PDF finding from Turn 1 through the final turn so nothing from the start or middle is ever forgotten.

${transcript}
${docsInfo}`,
          },
        ],
        responseFormatJson: true,
        timeoutMs: 25000,
      });

      const parsed = extractJsonObject(result.text) as {
        title?: string;
        memorySummary?: string;
      };

      res.json({
        title: (typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : currentTitle
        ).slice(0, 150),
        memorySummary: (typeof parsed.memorySummary === 'string'
          ? parsed.memorySummary.trim()
          : result.text.trim()
        ).slice(0, 11500),
      });
    } catch (error) {
      const { status, message } = getFriendlyProviderError(error);
      res.status(status).json({ error: message });
    }
  });

  // 4. Compose structured PDF spec on demand via OpenRouter free models
  app.post('/api/pdf/compose', async (req: Request, res: Response) => {
    try {
      const {
        mode = 'chat',
        title = 'Conversation Export',
        history = [],
        documents = [],
        targetContent = '',
        instruction = '',
        userDisplayName = 'User',
      } = req.body as {
        mode?: 'chat' | 'message';
        title?: string;
        history?: Array<{ role: string; content: string; turnIndex: number }>;
        documents?: Array<{ fileName: string; pageCount: number; summary: string }>;
        targetContent?: string;
        instruction?: string;
        userDisplayName?: string;
      };

      const schemaInstructions = `Return strictly valid JSON (no markdown fences) matching this structure:
{
  "title": "Document Title",
  "subtitle": "Optional concise subtitle",
  "fileName": "clean-file-name.pdf",
  "summary": "Executive summary paragraph",
  "sections": [
    {
      "heading": "Section Heading",
      "body": "Paragraph prose separated by blank lines",
      "bullets": ["Optional bullet 1", "Optional bullet 2"],
      "table": {
        "headers": ["Col 1", "Col 2"],
        "rows": [["Val 1", "Val 2"]]
      }
    }
  ]
}`;

      const prompt =
        mode === 'message'
          ? `${schemaInstructions}\n\nTransform the following assistant response into a clean, publication-ready PDF document specification:\n\n${targetContent}`
          : `${schemaInstructions}\n\nCompile a comprehensive, well-structured PDF report capturing this entire conversation ("${title}") from Turn 1 to the end, including key conclusions, decisions, Q&A takeaways, and referenced PDF insights.${
              instruction ? `\n\nSpecial instruction: ${instruction}` : ''
            }\n\nConversation Transcript:\n${history
              .map((m) => `Turn ${m.turnIndex} (${m.role.toUpperCase()}): ${m.content}`)
              .join('\n\n')}${
              documents.length > 0
                ? `\n\nReferenced PDFs:\n${documents.map((d) => `- ${d.fileName} (${d.pageCount} pages): ${d.summary}`).join('\n')}`
                : ''
            }`;

      const result = await callOpenRouterCompletion({
        messages: [
          {
            role: 'system',
            content:
              'You are a technical document architect. Output strictly valid JSON conforming to the requested PDF schema.',
          },
          { role: 'user', content: prompt },
        ],
        responseFormatJson: true,
        timeoutMs: 35000,
      });

      const rawSpec = extractJsonObject(result.text);
      const spec = normalizePdfSpec(rawSpec, userDisplayName);
      res.json({ spec });
    } catch (error) {
      const { status, message } = getFriendlyProviderError(error);
      res.status(status).json({ error: message });
    }
  });

  // 5. Render real binary PDF file via pdfkit
  app.post('/api/pdf/render', async (req: Request, res: Response) => {
    try {
      const rawSpec = req.body?.spec as Record<string, unknown> | undefined;
      if (!rawSpec || typeof rawSpec !== 'object') {
        res.status(400).json({ error: 'Missing PDF specification payload.' });
        return;
      }

      const spec = normalizePdfSpec(rawSpec);
      const buffer = await renderPdfBuffer(spec);
      const inlinePreview = req.query.preview === '1';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${inlinePreview ? 'inline' : 'attachment'}; filename="${spec.fileName}"`,
      );
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to render PDF.';
      res.status(500).json({ error: message });
    }
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FolioMind server listening on http://0.0.0.0:${PORT} (OpenRouter: ${PRIMARY_FREE_MODEL})`);
  });
}

void startServer();
