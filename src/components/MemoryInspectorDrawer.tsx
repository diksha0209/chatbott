import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { GeneratedPdfCard } from './GeneratedPdfCard';
import type {
  ChatDocument,
  ChatMessage,
  ChatThread,
  GeneratedPdfSpec,
} from '../types/chat';

interface MemoryInspectorDrawerProps {
  open: boolean;
  onClose: () => void;
  chat: ChatThread | null;
  messages: ChatMessage[];
  documents: ChatDocument[];
  onRefreshMemory: () => Promise<void>;
  refreshingMemory: boolean;
  onPreviewPdf: (spec: GeneratedPdfSpec) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MemoryInspectorDrawer({
  open,
  onClose,
  chat,
  messages,
  documents,
  onRefreshMemory,
  refreshingMemory,
  onPreviewPdf,
}: MemoryInspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<'memory' | 'pdfs'>('memory');
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  if (!open) return null;

  const generatedPdfs = messages
    .filter((m): m is ChatMessage & { generatedPdf: GeneratedPdfSpec } => Boolean(m.generatedPdf))
    .map((m) => ({
      turnIndex: m.turnIndex,
      messageId: m.messageId,
      spec: m.generatedPdf,
    }));

  const turnCount = messages.length;
  const firstMessage = messages[0];

  return (
    <aside
      aria-label="Conversation memory and PDF library"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[360px] lg:static lg:w-[340px] shrink-0 flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            Thread Memory & PDFs
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Segmented Control Tabs */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'memory'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Memory Ledger
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pdfs')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'pdfs'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Chat PDFs ({documents.length + generatedPdfs.length})
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeTab === 'memory' ? (
          <>
            {/* Memory Coverage Stats */}
            <div className="grid grid-cols-2 gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Active Window</p>
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                  {turnCount > 0 ? `Turn 1 – ${turnCount}` : 'Turn 0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">PDFs Retained</p>
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
                  {documents.length} {documents.length === 1 ? 'file' : 'files'}
                </p>
              </div>
            </div>

            {firstMessage && (
              <div className="space-y-1.5 pb-4 border-b border-slate-200 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Opening Turn Anchor (Turn 01)
                </p>
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 line-clamp-3">
                  {firstMessage.content}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Memorized Conversation Ledger
                </h3>
                <button
                  type="button"
                  onClick={onRefreshMemory}
                  disabled={refreshingMemory || turnCount === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {refreshingMemory ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Refresh</span>
                </button>
              </div>

              {chat?.memorySummary ? (
                <div className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
                  {chat.memorySummary}
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  {turnCount === 0
                    ? 'Send your first message or upload a PDF to start building persistent thread memory.'
                    : 'Memory ledger updates automatically after each exchange. Click Refresh to synthesize now.'}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-6">
            {/* Uploaded PDFs */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Uploaded PDFs in Memory ({documents.length})
              </h3>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  No PDFs attached to this conversation yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((docItem) => {
                    const isExpanded = expandedDocId === docItem.docId;
                    return (
                      <div
                        key={docItem.docId}
                        className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDocId(isExpanded ? null : docItem.docId)
                          }
                          className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                {docItem.fileName}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                {docItem.pageCount} pages · {formatBytes(docItem.fileSize)}
                              </p>
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              Retained Digest
                            </p>
                            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                              {docItem.summary}
                            </p>
                            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 pt-1">
                              Extracted Excerpt
                            </p>
                            <p className="text-[11px] leading-relaxed font-mono text-slate-600 dark:text-slate-400 max-h-36 overflow-y-auto whitespace-pre-wrap bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2">
                              {docItem.extractedText.slice(0, 1500)}
                              {docItem.extractedText.length > 1500 ? '...' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Generated PDFs */}
            <section className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Generated PDFs ({generatedPdfs.length})
              </h3>
              {generatedPdfs.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  Ask the chatbot to generate a PDF report or click Export Chat PDF in the header.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {generatedPdfs.map((item) => (
                    <div key={item.messageId} className="space-y-1">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        Turn {String(item.turnIndex).padStart(2, '0')}
                      </p>
                      <GeneratedPdfCard
                        spec={item.spec}
                        onPreview={onPreviewPdf}
                        compact
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
