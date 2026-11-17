import type {
  ChatDocument,
  ChatMessage,
  GeneratedPdfSpec,
  ParsedPdfResult,
} from '../types/chat';

export async function parsePdfFile(file: File): Promise<ParsedPdfResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/pdf/parse', {
    method: 'POST',
    body: formData,
  });

  const data = (await response.json()) as ParsedPdfResult & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Failed to parse ${file.name}`);
  }
  return data;
}

export async function streamChatReply(
  params: {
    history: ChatMessage[];
    documents: ChatDocument[];
    memorySummary: string;
    userMessage: string;
    userDisplayName: string;
  },
  callbacks: {
    onDelta: (text: string) => void;
    onPdf: (spec: GeneratedPdfSpec) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      history: params.history.map((m) => ({
        role: m.role,
        content: m.content,
        turnIndex: m.turnIndex,
        attachments: m.attachments?.map((a) => ({
          fileName: a.fileName,
          pageCount: a.pageCount,
        })),
        generatedPdf: m.generatedPdf
          ? { title: m.generatedPdf.title, fileName: m.generatedPdf.fileName }
          : undefined,
      })),
      documents: params.documents.map((d) => ({
        fileName: d.fileName,
        pageCount: d.pageCount,
        extractedText: d.extractedText,
        summary: d.summary,
      })),
      memorySummary: params.memorySummary,
      userMessage: params.userMessage,
      userDisplayName: params.userDisplayName,
    }),
  });

  if (!response.ok || !response.body) {
    let errorMessage = `Request failed (${response.status})`;
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) errorMessage = json.error;
    } catch {
      // ignore json parse failure
    }
    callbacks.onError(errorMessage);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const evt of events) {
      const lines = evt.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const payload = JSON.parse(jsonStr) as {
            type: 'delta' | 'pdf' | 'done' | 'error';
            text?: string;
            generatedPdf?: GeneratedPdfSpec;
            error?: string;
          };
          if (payload.type === 'delta' && payload.text) {
            callbacks.onDelta(payload.text);
          } else if (payload.type === 'pdf' && payload.generatedPdf) {
            callbacks.onPdf(payload.generatedPdf);
          } else if (payload.type === 'error') {
            callbacks.onError(payload.error || 'Chat streaming failed.');
            return;
          } else if (payload.type === 'done') {
            callbacks.onDone();
            return;
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }
  }

  callbacks.onDone();
}

export async function refreshThreadMemory(params: {
  history: ChatMessage[];
  documents: ChatDocument[];
  currentTitle: string;
}): Promise<{ title: string; memorySummary: string }> {
  const response = await fetch('/api/chat/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      history: params.history.map((m) => ({
        role: m.role,
        content: m.content,
        turnIndex: m.turnIndex,
      })),
      documents: params.documents.map((d) => ({
        fileName: d.fileName,
        pageCount: d.pageCount,
        summary: d.summary,
      })),
      currentTitle: params.currentTitle,
    }),
  });

  const data = (await response.json()) as {
    title?: string;
    memorySummary?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update memory ledger.');
  }
  return {
    title: data.title || params.currentTitle,
    memorySummary: data.memorySummary || '',
  };
}

export async function composePdfSpec(params: {
  mode: 'chat' | 'message';
  title?: string;
  history?: ChatMessage[];
  documents?: ChatDocument[];
  targetContent?: string;
  instruction?: string;
  userDisplayName?: string;
}): Promise<GeneratedPdfSpec> {
  const response = await fetch('/api/pdf/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: params.mode,
      title: params.title,
      history: params.history?.map((m) => ({
        role: m.role,
        content: m.content,
        turnIndex: m.turnIndex,
      })),
      documents: params.documents?.map((d) => ({
        fileName: d.fileName,
        pageCount: d.pageCount,
        summary: d.summary,
      })),
      targetContent: params.targetContent,
      instruction: params.instruction,
      userDisplayName: params.userDisplayName,
    }),
  });

  const data = (await response.json()) as { spec?: GeneratedPdfSpec; error?: string };
  if (!response.ok || !data.spec) {
    throw new Error(data.error || 'Failed to compose PDF.');
  }
  return data.spec;
}

export async function renderPdfBlob(
  spec: GeneratedPdfSpec,
  preview = false,
): Promise<Blob> {
  const response = await fetch(`/api/pdf/render${preview ? '?preview=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec }),
  });

  if (!response.ok) {
    let message = 'Failed to render PDF file.';
    try {
      const err = (await response.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return await response.blob();
}

export async function downloadGeneratedPdf(spec: GeneratedPdfSpec): Promise<void> {
  const blob = await renderPdfBlob(spec, false);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = spec.fileName || 'document.pdf';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
