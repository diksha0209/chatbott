export interface PdfAttachmentMeta {
  docId: string;
  fileName: string;
  pageCount: number;
  fileSize: number;
}

export interface PdfTableData {
  headers: string[];
  rows: string[][];
}

export interface PdfSection {
  heading: string;
  body?: string;
  bullets?: string[];
  table?: PdfTableData;
}

export interface GeneratedPdfSpec {
  title: string;
  subtitle?: string;
  author?: string;
  fileName: string;
  createdAtIso: string;
  summary?: string;
  sections: PdfSection[];
}

export interface ChatThread {
  chatId: string;
  userId: string;
  title: string;
  memorySummary: string;
  lastMessagePreview: string;
  messageCount: number;
  pdfCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface ChatMessage {
  messageId: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  turnIndex: number;
  attachments?: PdfAttachmentMeta[];
  generatedPdf?: GeneratedPdfSpec;
  createdAt?: unknown;
  createdAtMs?: number;
}

export interface ChatDocument {
  docId: string;
  chatId: string;
  userId: string;
  fileName: string;
  pageCount: number;
  fileSize: number;
  extractedText: string;
  summary: string;
  createdAt?: unknown;
  createdAtMs?: number;
}

export interface ParsedPdfResult {
  fileName: string;
  pageCount: number;
  fileSize: number;
  extractedText: string;
  summary: string;
  isScannedFallback: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
