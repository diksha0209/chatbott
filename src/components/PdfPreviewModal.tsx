import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, X } from 'lucide-react';
import { downloadGeneratedPdf, renderPdfBlob } from '../services/apiClient';
import type { GeneratedPdfSpec } from '../types/chat';

interface PdfPreviewModalProps {
  spec: GeneratedPdfSpec | null;
  onClose: () => void;
}

export function PdfPreviewModal({ spec, onClose }: PdfPreviewModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'outline'>('rendered');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spec) {
      setBlobUrl(null);
      return;
    }

    let cancelled = false;
    let currentUrl: string | null = null;
    setLoading(true);
    setError(null);
    setViewMode('rendered');

    renderPdfBlob(spec, true)
      .then((blob) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setBlobUrl(currentUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to render PDF preview.');
        setViewMode('outline');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [spec]);

  if (!spec) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadGeneratedPdf(spec);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`PDF Preview: ${spec.title}`}
    >
      <div className="w-full max-w-5xl h-[88vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {spec.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                {spec.fileName} · {spec.sections.length} sections
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('rendered')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'rendered'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                PDF View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('outline')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'outline'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Structured Text
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {downloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Download PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 overflow-y-auto">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <p className="text-sm">Compiling PDF document...</p>
            </div>
          ) : viewMode === 'rendered' && blobUrl && !error ? (
            <iframe
              src={blobUrl}
              title={spec.title}
              className="w-full h-full border-0 bg-white"
            />
          ) : (
            <div className="max-w-3xl mx-auto my-8 p-8 sm:p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
              {error && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <header className="space-y-2 pb-5 border-b border-slate-200 dark:border-slate-800">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {spec.title}
                </h1>
                {spec.subtitle && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">{spec.subtitle}</p>
                )}
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {spec.author ? `Prepared by ${spec.author} · ` : ''}
                  {new Date(spec.createdAtIso).toLocaleDateString()}
                </p>
              </header>

              {spec.summary && (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Executive Summary
                  </p>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                    {spec.summary}
                  </p>
                </div>
              )}

              {spec.sections.map((section, idx) => (
                <section key={idx} className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 pb-1 border-b border-slate-200 dark:border-slate-800">
                    {section.heading}
                  </h2>
                  {section.body && (
                    <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {section.body}
                    </div>
                  )}
                  {section.bullets && section.bullets.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                      {section.bullets.map((b, bIdx) => (
                        <li key={bIdx}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {section.table && section.table.headers.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse border border-slate-200 dark:border-slate-700 tabular-nums">
                        <thead>
                          <tr className="bg-slate-900 text-white">
                            {section.table.headers.map((h, hIdx) => (
                              <th key={hIdx} className="px-3 py-2 text-left font-semibold border border-slate-700">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={
                                rIdx % 2 === 1
                                  ? 'bg-slate-50 dark:bg-slate-800/40'
                                  : 'bg-white dark:bg-slate-900'
                              }
                            >
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="px-3 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
