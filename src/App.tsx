import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { BookOpen, FileDown, FileText, Loader2 } from 'lucide-react';
import { ChatWorkspace } from './components/ChatWorkspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MemoryInspectorDrawer } from './components/MemoryInspectorDrawer';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { Sidebar } from './components/Sidebar';
import { auth, googleProvider } from './firebase';
import { refreshThreadMemory } from './services/apiClient';
import {
  createChatThread,
  deleteChatThread,
  ensureUserProfile,
  renameChatThread,
  subscribeToChats,
  subscribeToDocuments,
  subscribeToMessages,
  updateChatMetadata,
} from './services/firestoreService';
import type {
  ChatDocument,
  ChatMessage,
  ChatThread,
  GeneratedPdfSpec,
} from './types/chat';

function FolioMindApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [chats, setChats] = useState<ChatThread[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<ChatDocument[]>([]);

  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [refreshingMemory, setRefreshingMemory] = useState(false);
  const [previewSpec, setPreviewSpec] = useState<GeneratedPdfSpec | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('foliomind-theme') === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('foliomind-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('foliomind-theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      if (nextUser) {
        try {
          await ensureUserProfile(nextUser);
        } catch (err) {
          console.error('Failed to sync profile:', err);
        }
      } else {
        setChats([]);
        setMessages([]);
        setDocuments([]);
        setActiveChatId(null);
      }
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Subscribe to user's saved chats
  useEffect(() => {
    if (!user) return;
    setLoadingChats(true);
    const unsub = subscribeToChats(
      user.uid,
      (nextChats) => {
        setChats(nextChats);
        setLoadingChats(false);
        setActiveChatId((prev) => {
          if (prev && nextChats.some((c) => c.chatId === prev)) return prev;
          return nextChats[0]?.chatId ?? null;
        });
      },
      (err) => {
        console.error(err);
        setLoadingChats(false);
      },
    );
    return () => unsub();
  }, [user]);

  // Subscribe to active chat's ordered messages (Turn 1 -> latest) and attached PDFs
  useEffect(() => {
    if (!user || !activeChatId) {
      setMessages([]);
      setDocuments([]);
      return;
    }

    const unsubMsgs = subscribeToMessages(
      user.uid,
      activeChatId,
      (nextMsgs) => setMessages(nextMsgs),
      (err) => console.error(err),
    );

    const unsubDocs = subscribeToDocuments(
      user.uid,
      activeChatId,
      (nextDocs) => setDocuments(nextDocs),
      (err) => console.error(err),
    );

    return () => {
      unsubMsgs();
      unsubDocs();
    };
  }, [user, activeChatId]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to sign in with Google.',
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleCreateChat = useCallback(async () => {
    if (!user) return '';
    const newId = await createChatThread(user.uid, 'New Conversation');
    setActiveChatId(newId);
    return newId;
  }, [user]);

  const handleEnsureActiveChat = useCallback(async () => {
    if (activeChatId) return activeChatId;
    return await handleCreateChat();
  }, [activeChatId, handleCreateChat]);

  const handleRenameChat = async (chatId: string, newTitle: string) => {
    if (!user) return;
    await renameChatThread(user.uid, chatId, newTitle);
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!user) return;
    await deleteChatThread(user.uid, chatId);
    if (activeChatId === chatId) {
      const remaining = chats.filter((c) => c.chatId !== chatId);
      setActiveChatId(remaining[0]?.chatId ?? null);
    }
  };

  const activeChat = chats.find((c) => c.chatId === activeChatId) || null;

  const handleRefreshMemory = async () => {
    if (!user || !activeChat || messages.length === 0) return;
    setRefreshingMemory(true);
    try {
      const mem = await refreshThreadMemory({
        history: messages,
        documents,
        currentTitle: activeChat.title,
      });
      await updateChatMetadata(user.uid, activeChat.chatId, {
        title: mem.title,
        memorySummary: mem.memorySummary,
        lastMessagePreview: activeChat.lastMessagePreview,
        messageCount: messages.length,
        pdfCount: documents.length,
      });
    } finally {
      setRefreshingMemory(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span>Loading FolioMind...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
          <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
            FolioMind
          </span>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {darkMode ? 'Light theme' : 'Dark theme'}
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-3xl w-full grid md:grid-cols-5 gap-8 items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-10">
            <div className="md:col-span-3 space-y-5">
              <div className="space-y-2.5">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Persistent memory for every chat and PDF.
                </h1>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Sign in to save your conversations permanently, recall every detail from Turn 1
                  to the final message, read PDFs, and export formatted PDF documents.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3">
                  <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      Start-to-end recall:
                    </strong>{' '}
                    Full ordered turn history and chronological memory ledger preserved across reloads.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      PDF reader:
                    </strong>{' '}
                    Parses digital and scanned PDFs page-by-page into permanent thread context.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <FileDown className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      PDF generator:
                    </strong>{' '}
                    Creates, previews, and downloads multi-page PDF reports straight from chat.
                  </p>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col justify-center space-y-4 md:border-l md:border-slate-200 md:dark:border-slate-800 md:pl-8">
              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={signingIn}
                className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 min-h-[44px] text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {signingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                <span>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
              </button>

              {authError && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                  {authError}
                </p>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Your chats and PDF extracts are stored privately under your Google account.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        openMobile={sidebarOpenMobile}
        onCloseMobile={() => setSidebarOpenMobile(false)}
        user={user}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => setActiveChatId(id)}
        onCreateChat={() => void handleCreateChat()}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        onSignOut={handleSignOut}
        loadingChats={loadingChats}
      />

      <ChatWorkspace
        user={user}
        chat={activeChat}
        messages={messages}
        documents={documents}
        onEnsureActiveChat={handleEnsureActiveChat}
        onOpenSidebar={() => setSidebarOpenMobile(true)}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onPreviewPdf={(spec) => setPreviewSpec(spec)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        refreshingMemory={refreshingMemory}
        onRefreshMemory={handleRefreshMemory}
        setRefreshingMemory={setRefreshingMemory}
      />

      <MemoryInspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        chat={activeChat}
        messages={messages}
        documents={documents}
        onRefreshMemory={handleRefreshMemory}
        refreshingMemory={refreshingMemory}
        onPreviewPdf={(spec) => setPreviewSpec(spec)}
      />

      <PdfPreviewModal
        spec={previewSpec}
        onClose={() => setPreviewSpec(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FolioMindApp />
    </ErrorBoundary>
  );
}
