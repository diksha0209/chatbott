import { useState } from 'react';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import { downloadGeneratedPdf } from '../services/apiClient';
import type { GeneratedPdfSpec } from '../types/chat';

interface GeneratedPdfCardProps {
  spec: GeneratedPdfSpec;
  onPreview: (spec: GeneratedPdfSpec) => void;
  compact?: boolean;
}

export function GeneratedPdfCard({ spec, onPreview, compact = false }: GeneratedPdfCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadGeneratedPdf(spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={`border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 rounded-xl ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {spec.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
              <span className="truncate max-w-[180px]">{spec.fileName}</span>
              <span aria-hidden="true">·</span>
              <span>{spec.sections.length} sections</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onPreview(spec)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{downloading ? 'Rendering...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {!compact && spec.summary && (
        <p className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 text-xs leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-2">
          {spec.summary}
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
