import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  ChatDocument,
  ChatMessage,
  ChatThread,
  GeneratedPdfSpec,
  PdfAttachmentMeta,
} from '../types/chat';

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (val && typeof val === 'object' && 'seconds' in val) {
    const secs = Number((val as { seconds: number }).seconds);
    return Number.isFinite(secs) ? secs * 1000 : Date.now();
  }
  return Date.now();
}

export function makeSafeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function getOrCreateWorkspaceId(): string {
  const storageKey = 'foliomind-workspace-id';
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing && /^[a-zA-Z0-9_-]{8,120}$/.test(existing)) {
      return existing;
    }
    const created = makeSafeId('ws');
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return makeSafeId('ws');
  }
}

function clampString(value: string, maxLen: number): string {
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function sanitizePdfSpec(spec: GeneratedPdfSpec): GeneratedPdfSpec {
  return {
    title: clampString(spec.title || 'Generated Document', 200),
    ...(spec.subtitle ? { subtitle: clampString(spec.subtitle, 300) } : {}),
    ...(spec.author ? { author: clampString(spec.author, 120) } : {}),
    fileName: clampString(spec.fileName || 'document.pdf', 200),
    createdAtIso: clampString(spec.createdAtIso || new Date().toISOString(), 64),
    ...(spec.summary ? { summary: clampString(spec.summary, 4000) } : {}),
    sections: (spec.sections || []).slice(0, 40).map((section) => ({
      heading: clampString(section.heading || 'Section', 200),
      ...(section.body ? { body: clampString(section.body, 8000) } : {}),
      ...(section.bullets && section.bullets.length > 0
        ? { bullets: section.bullets.slice(0, 40).map((b) => clampString(String(b), 1000)) }
        : {}),
      ...(section.table && section.table.headers?.length
        ? {
            table: {
              headers: section.table.headers.slice(0, 12).map((h) => clampString(String(h), 120)),
              rows: (section.table.rows || [])
                .slice(0, 50)
                .map((row) => row.slice(0, 12).map((cell) => clampString(String(cell), 300))),
            },
          }
        : {}),
    })),
  };
}

export function subscribeToChats(
  workspaceId: string,
  onData: (chats: ChatThread[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const path = `workspaces/${workspaceId}/chats`;
  const q = query(
    collection(db, 'workspaces', workspaceId, 'chats'),
    where('workspaceId', '==', workspaceId),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: ChatThread[] = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            chatId: String(raw.chatId || d.id),
            workspaceId: String(raw.workspaceId || workspaceId),
            title: String(raw.title || 'Untitled Chat'),
            memorySummary: String(raw.memorySummary || ''),
            lastMessagePreview: String(raw.lastMessagePreview || ''),
            messageCount: Number(raw.messageCount || 0),
            pdfCount: Number(raw.pdfCount || 0),
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            createdAtMs: toMillis(raw.createdAt),
            updatedAtMs: toMillis(raw.updatedAt),
          };
        })
        .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToMessages(
  workspaceId: string,
  chatId: string,
  onData: (messages: ChatMessage[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const path = `workspaces/${workspaceId}/chats/${chatId}/messages`;
  const q = query(
    collection(db, 'workspaces', workspaceId, 'chats', chatId, 'messages'),
    where('workspaceId', '==', workspaceId),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: ChatMessage[] = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            messageId: String(raw.messageId || d.id),
            chatId: String(raw.chatId || chatId),
            workspaceId: String(raw.workspaceId || workspaceId),
            role: (raw.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: String(raw.content || ''),
            turnIndex: Number(raw.turnIndex || 1),
            attachments: Array.isArray(raw.attachments)
              ? (raw.attachments as PdfAttachmentMeta[])
              : undefined,
            generatedPdf: raw.generatedPdf
              ? (raw.generatedPdf as GeneratedPdfSpec)
              : undefined,
            createdAt: raw.createdAt,
            createdAtMs: toMillis(raw.createdAt),
          };
        })
        .sort((a, b) => a.turnIndex - b.turnIndex);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToDocuments(
  workspaceId: string,
  chatId: string,
  onData: (docs: ChatDocument[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const path = `workspaces/${workspaceId}/chats/${chatId}/documents`;
  const q = query(
    collection(db, 'workspaces', workspaceId, 'chats', chatId, 'documents'),
    where('workspaceId', '==', workspaceId),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: ChatDocument[] = snapshot.docs
        .map((d) => {
          const raw = d.data();
          return {
            docId: String(raw.docId || d.id),
            chatId: String(raw.chatId || chatId),
            workspaceId: String(raw.workspaceId || workspaceId),
            fileName: String(raw.fileName || 'document.pdf'),
            pageCount: Number(raw.pageCount || 1),
            fileSize: Number(raw.fileSize || 0),
            extractedText: String(raw.extractedText || ''),
            summary: String(raw.summary || ''),
            createdAt: raw.createdAt,
            createdAtMs: toMillis(raw.createdAt),
          };
        })
        .sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function createChatThread(
  workspaceId: string,
  title = 'New Conversation',
): Promise<string> {
  const chatId = makeSafeId('chat');
  const path = `workspaces/${workspaceId}/chats/${chatId}`;
  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId), {
      chatId,
      workspaceId,
      title: clampString(title.trim() || 'New Conversation', 160),
      memorySummary: '',
      lastMessagePreview: '',
      messageCount: 0,
      pdfCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return chatId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function renameChatThread(
  workspaceId: string,
  chatId: string,
  title: string,
): Promise<void> {
  const path = `workspaces/${workspaceId}/chats/${chatId}`;
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId), {
      title: clampString(title.trim() || 'Untitled Chat', 160),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateChatMetadata(
  workspaceId: string,
  chatId: string,
  updates: {
    title?: string;
    memorySummary: string;
    lastMessagePreview: string;
    messageCount: number;
    pdfCount: number;
  },
): Promise<void> {
  const path = `workspaces/${workspaceId}/chats/${chatId}`;
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId), {
      ...(updates.title ? { title: clampString(updates.title, 160) } : {}),
      memorySummary: clampString(updates.memorySummary, 12000),
      lastMessagePreview: clampString(updates.lastMessagePreview, 300),
      messageCount: Math.max(0, Math.min(50000, Math.floor(updates.messageCount))),
      pdfCount: Math.max(0, Math.min(200, Math.floor(updates.pdfCount))),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveChatMessage(
  workspaceId: string,
  chatId: string,
  input: {
    role: 'user' | 'assistant';
    content: string;
    turnIndex: number;
    attachments?: PdfAttachmentMeta[];
    generatedPdf?: GeneratedPdfSpec;
  },
): Promise<string> {
  const messageId = makeSafeId('msg');
  const path = `workspaces/${workspaceId}/chats/${chatId}/messages/${messageId}`;
  const cleanAttachments = input.attachments?.slice(0, 5).map((a) => ({
    docId: a.docId,
    fileName: clampString(a.fileName, 255),
    pageCount: Math.max(0, Math.floor(a.pageCount)),
    fileSize: Math.max(0, Math.floor(a.fileSize)),
  }));

  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId, 'messages', messageId), {
      messageId,
      chatId,
      workspaceId,
      role: input.role,
      content: clampString(input.content, 100000),
      turnIndex: Math.max(1, Math.floor(input.turnIndex)),
      ...(cleanAttachments && cleanAttachments.length > 0
        ? { attachments: cleanAttachments }
        : {}),
      ...(input.generatedPdf
        ? { generatedPdf: sanitizePdfSpec(input.generatedPdf) }
        : {}),
      createdAt: serverTimestamp(),
    });
    return messageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function attachGeneratedPdfToMessage(
  workspaceId: string,
  chatId: string,
  messageId: string,
  generatedPdf: GeneratedPdfSpec,
): Promise<void> {
  const path = `workspaces/${workspaceId}/chats/${chatId}/messages/${messageId}`;
  try {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId, 'messages', messageId), {
      generatedPdf: sanitizePdfSpec(generatedPdf),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveChatDocument(
  workspaceId: string,
  chatId: string,
  input: {
    docId?: string;
    fileName: string;
    pageCount: number;
    fileSize: number;
    extractedText: string;
    summary: string;
  },
): Promise<ChatDocument> {
  const docId = input.docId || makeSafeId('doc');
  const path = `workspaces/${workspaceId}/chats/${chatId}/documents/${docId}`;
  const cleanFileName = clampString(input.fileName, 255);
  const cleanText = clampString(input.extractedText, 450000);
  const cleanSummary = clampString(input.summary, 8000);
  const pageCount = Math.max(0, Math.min(5000, Math.floor(input.pageCount)));
  const fileSize = Math.max(0, Math.min(52428800, Math.floor(input.fileSize)));

  try {
    await setDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId, 'documents', docId), {
      docId,
      chatId,
      workspaceId,
      fileName: cleanFileName,
      pageCount,
      fileSize,
      extractedText: cleanText,
      summary: cleanSummary,
      createdAt: serverTimestamp(),
    });
    return {
      docId,
      chatId,
      workspaceId,
      fileName: cleanFileName,
      pageCount,
      fileSize,
      extractedText: cleanText,
      summary: cleanSummary,
      createdAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteChatThread(
  workspaceId: string,
  chatId: string,
): Promise<void> {
  const chatPath = `workspaces/${workspaceId}/chats/${chatId}`;
  try {
    const msgsSnap = await getDocs(
      query(
        collection(db, 'workspaces', workspaceId, 'chats', chatId, 'messages'),
        where('workspaceId', '==', workspaceId),
      ),
    );
    const docsSnap = await getDocs(
      query(
        collection(db, 'workspaces', workspaceId, 'chats', chatId, 'documents'),
        where('workspaceId', '==', workspaceId),
      ),
    );

    const allRefs = [...msgsSnap.docs.map((d) => d.ref), ...docsSnap.docs.map((d) => d.ref)];
    for (let i = 0; i < allRefs.length; i += 400) {
      const batch = writeBatch(db);
      allRefs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'workspaces', workspaceId, 'chats', chatId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, chatPath);
  }
}
