import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  FileDown,
  FileText,
  Loader2,
  Menu,
  Moon,
  Paperclip,
  Square,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  composePdfSpec,
  parsePdfFile,
  refreshThreadMemory,
  streamChatReply,
} from '../services/apiClient';
import {
  attachGeneratedPdfToMessage,
  saveChatDocument,
  saveChatMessage,
  updateChatMetadata,
} from '../services/firestoreService';
import type {
  ChatDocument,
  ChatMessage,
  ChatThread,
  GeneratedPdfSpec,
  PdfAttachmentMeta,
} from '../types/chat';
import { GeneratedPdfCard } from './GeneratedPdfCard';

interface ChatWorkspaceProps {
  user: User;
  chat: ChatThread | null;
  messages: ChatMessage[];
  documents: ChatDocument[];
  onEnsureActiveChat: () => Promise<string>;
  onOpenSidebar: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onPreviewPdf: (spec: GeneratedPdfSpec) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  refreshingMemory: boolean;
  onRefreshMemory: () => Promise<void>;
  setRefreshingMemory: (v: boolean) => void;
}

interface PendingAttachment extends PdfAttachmentMeta {
  isUploading?: boolean;
}

export function ChatWorkspace({
  user,
  chat,
  messages,
  documents,
  onEnsureActiveChat,
  onOpenSidebar,
  inspectorOpen,
  onToggleInspector,
  onPreviewPdf,
  darkMode,
  onToggleDarkMode,
  setRefreshingMemory,
}: ChatWorkspaceProps) {
  const [input, setInput] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingPdf, setStreamingPdf] = useState<GeneratedPdfSpec | undefined>(undefined);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingPdfMsgId, setSavingPdfMsgId] = useState<string | null>(null);
  const [exportingChatPdf, setExportingChatPdf] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const newlyUploadedDocsRef = useRef<Map<string, ChatDocument>>(new Map());
  const prevChatIdRef = useRef<string | undefined>(chat?.chatId);

  const getMergedDocuments = (targetChatId?: string): ChatDocument[] => {
    const byId = new Map<string, ChatDocument>();
    for (const d of documents) byId.set(d.docId, d);
    const idToMatch = targetChatId || chat?.chatId;
    for (const [id, d] of newlyUploadedDocsRef.current.entries()) {
      if (d.chatId === idToMatch && !byId.has(id)) {
        byId.set(id, d);
      }
    }
    return Array.from(byId.values());
  };

  // Clear pending attachments only when switching between different existing chats
  useEffect(() => {
    const prev = prevChatIdRef.current;
    const next = chat?.chatId;
    if (prev && next && prev !== next) {
      setPendingAttachments([]);
      setErrorBanner(null);
    }
    prevChatIdRef.current = next;
  }, [chat?.chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, streamingPdf]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const handlePdfFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (files.length === 0) {
      setErrorBanner('Please select valid PDF (.pdf) files.');
      return;
    }

    setErrorBanner(null);
    let targetChatId = chat?.chatId;
    if (!targetChatId) {
      targetChatId = await onEnsureActiveChat();
    }

    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setErrorBanner(`${file.name} exceeds the 25 MB upload limit.`);
        continue;
      }
      setUploadingFiles((prev) => [...prev, file.name]);
      try {
        const parsed = await parsePdfFile(file);
        const savedDoc = await saveChatDocument(user.uid, targetChatId, {
          fileName: parsed.fileName,
          pageCount: parsed.pageCount,
          fileSize: parsed.fileSize,
          extractedText: parsed.extractedText,
          summary: parsed.summary,
        });
        newlyUploadedDocsRef.current.set(savedDoc.docId, savedDoc);

        setPendingAttachments((prev) => [
          ...prev,
          {
            docId: savedDoc.docId,
            fileName: savedDoc.fileName,
            pageCount: savedDoc.pageCount,
            fileSize: savedDoc.fileSize,
          },
        ]);

        // Update chat pdfCount immediately in Firestore
        const mergedDocs = getMergedDocuments(targetChatId);
        await updateChatMetadata(user.uid, targetChatId, {
          memorySummary: chat?.memorySummary || '',
          lastMessagePreview:
            chat?.lastMessagePreview || `Uploaded ${savedDoc.fileName}`,
          messageCount: messages.length,
          pdfCount: Math.max(mergedDocs.length, documents.length + 1),
        });
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : `Could not read ${file.name}.`,
        );
      } finally {
        setUploadingFiles((prev) => prev.filter((n) => n !== file.name));
      }
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handlePdfFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handlePdfFiles(e.dataTransfer.files);
    }
  };

  const handleSend = async (overrideText?: string) => {
    if (isStreaming) return;
    const rawText = typeof overrideText === 'string' ? overrideText : input;
    const trimmed = rawText.trim();
    const attachmentsToSend = [...pendingAttachments];

    if (!trimmed && attachmentsToSend.length === 0) return;
    if (uploadingFiles.length > 0) {
      setErrorBanner('Please wait for your PDF upload to finish parsing.');
      return;
    }

    const messageContent =
      trimmed ||
      `Please read and summarize the attached PDF document${attachmentsToSend.length > 1 ? 's' : ''}: ${attachmentsToSend.map((a) => a.fileName).join(', ')}.`;

    setErrorBanner(null);
    if (typeof overrideText !== 'string') setInput('');
    setPendingAttachments([]);

    let targetChatId = chat?.chatId;
    if (!targetChatId) {
      targetChatId = await onEnsureActiveChat();
    }

    const userTurnIndex = messages.length + 1;
    const assistantTurnIndex = userTurnIndex + 1;

    await saveChatMessage(user.uid, targetChatId, {
      role: 'user',
      content: messageContent,
      turnIndex: userTurnIndex,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);
    setStreamingText('');
    setStreamingPdf(undefined);

    let finalReply = '';
    let finalPdf: GeneratedPdfSpec | undefined;

    const activeDocuments = getMergedDocuments(targetChatId);

    await streamChatReply(
      {
        history: messages,
        documents: activeDocuments,
        memorySummary: chat?.memorySummary || '',
        userMessage: messageContent,
        userDisplayName: user.displayName || user.email?.split('@')[0] || 'User',
      },
      {
        onDelta: (delta) => {
          finalReply += delta;
          setStreamingText(finalReply);
        },
        onPdf: (spec) => {
          finalPdf = spec;
          setStreamingPdf(spec);
        },
        onDone: async () => {
          setIsStreaming(false);
          setStreamingText('');
          setStreamingPdf(undefined);

          const textToSave =
            finalReply.trim() ||
            (finalPdf
              ? `Generated "${finalPdf.title}" (${finalPdf.fileName}).`
              : 'Response completed.');

          await saveChatMessage(user.uid, targetChatId!, {
            role: 'assistant',
            content: textToSave,
            turnIndex: assistantTurnIndex,
            generatedPdf: finalPdf,
          });

          const nextHistoryForMemory: ChatMessage[] = [
            ...messages,
            {
              messageId: 'temp_u',
              chatId: targetChatId!,
              userId: user.uid,
              role: 'user',
              content: messageContent,
              turnIndex: userTurnIndex,
            },
            {
              messageId: 'temp_a',
              chatId: targetChatId!,
              userId: user.uid,
              role: 'assistant',
              content: textToSave,
              turnIndex: assistantTurnIndex,
              generatedPdf: finalPdf,
            },
          ];

          await updateChatMetadata(user.uid, targetChatId!, {
            memorySummary: chat?.memorySummary || '',
            lastMessagePreview: textToSave.slice(0, 280),
            messageCount: assistantTurnIndex,
            pdfCount: activeDocuments.length,
          });

          // Distill updated chronological memory ledger & title in background
          setRefreshingMemory(true);
          try {
            const mem = await refreshThreadMemory({
              history: nextHistoryForMemory,
              documents: activeDocuments,
              currentTitle: chat?.title || 'New Conversation',
            });
            await updateChatMetadata(user.uid, targetChatId!, {
              title: mem.title,
              memorySummary: mem.memorySummary,
              lastMessagePreview: textToSave.slice(0, 280),
              messageCount: assistantTurnIndex,
              pdfCount: activeDocuments.length,
            });
          } catch {
            // Non-blocking background memory refresh
          } finally {
            setRefreshingMemory(false);
          }
        },
        onError: (errMsg) => {
          setIsStreaming(false);
          setStreamingText('');
          setStreamingPdf(undefined);
          setErrorBanner(errMsg);
        },
      },
      controller.signal,
    ).catch((err) => {
      if ((err as Error)?.name !== 'AbortError') {
        setIsStreaming(false);
        setErrorBanner(err instanceof Error ? err.message : 'Streaming failed.');
      }
    });
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleCopy = async (messageId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleSaveMessageAsPdf = async (msg: ChatMessage) => {
    if (!chat) return;
    setSavingPdfMsgId(msg.messageId);
    setErrorBanner(null);
    try {
      const spec = await composePdfSpec({
        mode: 'message',
        title: chat.title,
        targetContent: msg.content,
        userDisplayName: user.displayName || 'User',
      });
      await attachGeneratedPdfToMessage(user.uid, chat.chatId, msg.messageId, spec);
      onPreviewPdf(spec);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not create PDF.');
    } finally {
      setSavingPdfMsgId(null);
    }
  };

  const handleExportChatPdf = async () => {
    if (messages.length === 0) return;
    setExportingChatPdf(true);
    setErrorBanner(null);
    try {
      const spec = await composePdfSpec({
        mode: 'chat',
        title: chat?.title || 'Conversation Export',
        history: messages,
        documents,
        userDisplayName: user.displayName || 'User',
      });
      onPreviewPdf(spec);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not export chat PDF.');
    } finally {
      setExportingChatPdf(false);
    }
  };

  return (
    <div
      className="relative flex-1 flex flex-col min-w-0 h-full bg-white dark:bg-slate-950"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      {/* Drag & Drop PDF Overlay */}
      {dragActive && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-blue-50/90 dark:bg-slate-900/90 border-2 border-dashed border-blue-500 m-3 rounded-2xl pointer-events-none">
          <div className="text-center space-y-2 p-6">
            <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400 mx-auto" />
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Drop PDF files to read into chat memory
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports text-based and scanned PDFs up to 25 MB
            </p>
          </div>
        </div>
      )}

      {/* Top Bar (3-zone contract) */}
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open conversations sidebar"
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {chat?.title || 'New Conversation'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {messages.length} {messages.length === 1 ? 'turn' : 'turns'} · {documents.length}{' '}
              {documents.length === 1 ? 'PDF' : 'PDFs'} memorized
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleInspector}
            className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              inspectorOpen
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Memory</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportChatPdf()}
            disabled={messages.length === 0 || exportingChatPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {exportingChatPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">
              {exportingChatPdf ? 'Compiling...' : 'Export Chat PDF'}
            </span>
            <span className="sm:hidden">PDF</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Messages Viewport */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && !isStreaming ? (
            <div className="py-10 sm:py-16 space-y-8">
              <div className="space-y-3 max-w-xl">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Every turn remembered. Any PDF read or generated.
                </h2>
                <p className="text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-400">
                  Start a conversation or drop a PDF below. FolioMind retains your full
                  discussion from Turn 1 to the final message across sessions and compiles
                  publication-ready PDFs on request.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 hover:border-blue-500/60 hover:bg-white dark:hover:bg-slate-900 transition-colors space-y-1.5 cursor-pointer"
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Read a PDF Document
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Upload reports, contracts, or scanned PDFs for page-cited Q&A.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void handleSend(
                      'Remember these project constraints from the start: budget is $45,000, launch date is October 15, and primary region is Europe. Confirm you have memorized them.',
                    )
                  }
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 hover:border-blue-500/60 hover:bg-white dark:hover:bg-slate-900 transition-colors space-y-1.5 cursor-pointer"
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Test Start-to-End Memory
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Store early facts in Turn 1 and recall them accurately dozens of turns later.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void handleSend(
                      'Generate a clean 1-page project kickoff checklist PDF covering scope, milestones, owners, and risk mitigation.',
                    )
                  }
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 hover:border-blue-500/60 hover:bg-white dark:hover:bg-slate-900 transition-colors space-y-1.5 cursor-pointer"
                >
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Generate a PDF Report
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Ask in plain English to create, preview, and download formatted PDFs.
                  </p>
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <article
                  key={msg.messageId}
                  className={`space-y-2.5 ${
                    isUser
                      ? 'ml-auto max-w-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5'
                      : 'py-2'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2 font-mono tabular-nums">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 font-sans">
                        {isUser ? user.displayName?.split(' ')[0] || 'You' : 'FolioMind'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Turn {String(msg.turnIndex).padStart(2, '0')}</span>
                    </div>

                    {!isUser && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleCopy(msg.messageId, msg.content)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedId === msg.messageId ? (
                            <Check className="w-3 h-3 text-green-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedId === msg.messageId ? 'Copied' : 'Copy'}</span>
                        </button>

                        {!msg.generatedPdf && (
                          <button
                            type="button"
                            onClick={() => void handleSaveMessageAsPdf(msg)}
                            disabled={savingPdfMsgId === msg.messageId}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {savingPdfMsgId === msg.messageId ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <FileDown className="w-3 h-3" />
                            )}
                            <span>Save as PDF</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Attached PDFs on user turn */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {msg.attachments.map((att) => (
                        <div
                          key={att.docId}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200"
                        >
                          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span className="font-medium truncate max-w-[200px]">
                            {att.fileName}
                          </span>
                          <span className="text-slate-400 font-mono tabular-nums">
                            {att.pageCount}p
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Content */}
                  {isUser ? (
                    <p className="text-sm sm:text-[15px] leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  ) : (
                    <div className="prose-chat text-slate-800 dark:text-slate-200">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Generated PDF Artifact Card */}
                  {msg.generatedPdf && (
                    <div className="pt-2">
                      <GeneratedPdfCard
                        spec={msg.generatedPdf}
                        onPreview={onPreviewPdf}
                      />
                    </div>
                  )}
                </article>
              );
            })
          )}

          {/* Live Streaming Assistant Turn */}
          {isStreaming && (
            <article className="py-2 space-y-2.5">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-300 font-sans">
                  FolioMind
                </span>
                <span aria-hidden="true">·</span>
                <span>Turn {String(messages.length + 2).padStart(2, '0')}</span>
              </div>

              {streamingText ? (
                <div className="prose-chat text-slate-800 dark:text-slate-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Reading thread memory and composing response...</span>
                </div>
              )}

              {streamingPdf && (
                <div className="pt-2">
                  <GeneratedPdfCard spec={streamingPdf} onPreview={onPreviewPdf} />
                </div>
              )}
            </article>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error Alert */}
      {errorBanner && (
        <div className="px-4 sm:px-6 pb-2">
          <div
            role="alert"
            className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="Dismiss error"
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Composer Dock */}
      <div className="px-4 sm:px-6 pb-4 pt-2 border-t border-slate-200/70 dark:border-slate-800/80 bg-white dark:bg-slate-950 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 rounded-2xl p-2.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
            {/* Pending / Uploading PDFs */}
            {(pendingAttachments.length > 0 || uploadingFiles.length > 0) && (
              <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2.5 border-b border-slate-200/80 dark:border-slate-800 mb-2">
                {uploadingFiles.map((fileName) => (
                  <div
                    key={`up_${fileName}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
                    <span className="truncate max-w-[180px]">Reading {fileName}...</span>
                  </div>
                ))}

                {pendingAttachments.map((att) => (
                  <div
                    key={att.docId}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="font-medium truncate max-w-[180px]">
                      {att.fileName}
                    </span>
                    <span className="text-slate-400 font-mono tabular-nums">
                      {att.pageCount}p
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) =>
                          prev.filter((item) => item.docId !== att.docId),
                        )
                      }
                      aria-label={`Remove ${att.fileName}`}
                      className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything, reference an earlier turn, or ask to generate a PDF..."
              aria-label="Message FolioMind"
              className="w-full resize-none bg-transparent px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2 pt-1.5 px-1">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>Attach PDF</span>
                </button>
              </div>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStreaming}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={
                    (!input.trim() && pendingAttachments.length === 0) ||
                    uploadingFiles.length > 0
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Send</span>
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
