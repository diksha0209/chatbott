import { useCallback, useEffect, useState } from 'react';
import { ChatWorkspace } from './components/ChatWorkspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MemoryInspectorDrawer } from './components/MemoryInspectorDrawer';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { Sidebar } from './components/Sidebar';
import { refreshThreadMemory } from './services/apiClient';
import {
  createChatThread,
  deleteChatThread,
  getOrCreateWorkspaceId,
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
  const [workspaceId] = useState<string>(() => getOrCreateWorkspaceId());

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

  // Subscribe to workspace's saved chats immediately without authentication
  useEffect(() => {
    setLoadingChats(true);
    const unsub = subscribeToChats(
      workspaceId,
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
  }, [workspaceId]);

  // Subscribe to active chat's ordered messages (Turn 1 -> latest) and attached PDFs
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setDocuments([]);
      return;
    }

    const unsubMsgs = subscribeToMessages(
      workspaceId,
      activeChatId,
      (nextMsgs) => setMessages(nextMsgs),
      (err) => console.error(err),
    );

    const unsubDocs = subscribeToDocuments(
      workspaceId,
      activeChatId,
      (nextDocs) => setDocuments(nextDocs),
      (err) => console.error(err),
    );

    return () => {
      unsubMsgs();
      unsubDocs();
    };
  }, [workspaceId, activeChatId]);

  const handleCreateChat = useCallback(async () => {
    const newId = await createChatThread(workspaceId, 'New Conversation');
    setActiveChatId(newId);
    return newId;
  }, [workspaceId]);

  const handleEnsureActiveChat = useCallback(async () => {
    if (activeChatId) return activeChatId;
    return await handleCreateChat();
  }, [activeChatId, handleCreateChat]);

  const handleRenameChat = async (chatId: string, newTitle: string) => {
    await renameChatThread(workspaceId, chatId, newTitle);
  };

  const handleDeleteChat = async (chatId: string) => {
    await deleteChatThread(workspaceId, chatId);
    if (activeChatId === chatId) {
      const remaining = chats.filter((c) => c.chatId !== chatId);
      setActiveChatId(remaining[0]?.chatId ?? null);
    }
  };

  const activeChat = chats.find((c) => c.chatId === activeChatId) || null;

  const handleRefreshMemory = async () => {
    if (!activeChat || messages.length === 0) return;
    setRefreshingMemory(true);
    try {
      const mem = await refreshThreadMemory({
        history: messages,
        documents,
        currentTitle: activeChat.title,
      });
      await updateChatMetadata(workspaceId, activeChat.chatId, {
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

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        openMobile={sidebarOpenMobile}
        onCloseMobile={() => setSidebarOpenMobile(false)}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => setActiveChatId(id)}
        onCreateChat={() => void handleCreateChat()}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        loadingChats={loadingChats}
      />

      <ChatWorkspace
        workspaceId={workspaceId}
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
