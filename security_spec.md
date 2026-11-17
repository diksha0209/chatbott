# Security Specification & Invariants (Auth-Free Workspace Model)

## 1. Data Invariants
1. **Workspace Scoping & Path Validation**: Every chat thread (`/workspaces/{workspaceId}/chats/{chatId}`), message (`/workspaces/{workspaceId}/chats/{chatId}/messages/{messageId}`), and PDF document (`/workspaces/{workspaceId}/chats/{chatId}/documents/{docId}`) enforces strict `^[a-zA-Z0-9_-]{1,128}$` ID formatting and matching `workspaceId`/`chatId` fields.
2. **Relational Parent Existence**: A `ChatMessage` or `ChatDocument` cannot be created or updated unless its parent `ChatThread` at `/workspaces/{workspaceId}/chats/{chatId}` exists and belongs to `workspaceId`.
3. **Immutable Ownership & Temporal Integrity**: `workspaceId`, `chatId`, `messageId`, `docId`, and `createdAt` are immutable after creation. Every `createdAt` on create and `updatedAt` on update must equal `request.time`.
4. **No Shadow Fields or Oversized Payloads**: Every write enforces `keys().hasAll(...)` and `keys().hasOnly(...)` on create, `diff(existing()).affectedKeys().hasOnly(...)` on update, and strict `.size()` bounds on every string and array.
5. **Safe List Queries**: `allow list` rules explicitly enforce `resource.data.workspaceId == workspaceId` without `get()` or `exists()` lookups.
6. **No Client-Side Authentication Required**: Access is scoped by an unguessable browser-persisted `workspaceId` (`ws_...`) per the user's explicit request to remove authentication. Note that without Firebase Auth, anyone who obtains a `workspaceId` can read/write that workspace's documents within schema limits.
