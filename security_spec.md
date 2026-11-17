# Security Specification & Invariants

## 1. Data Invariants
1. **Strict Owner Isolation**: Every user profile (`/users/{userId}`), chat thread (`/users/{userId}/chats/{chatId}`), message (`/users/{userId}/chats/{chatId}/messages/{messageId}`), and PDF document (`/users/{userId}/chats/{chatId}/documents/{docId}`) is strictly readable and writable only by the verified authenticated user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. **Relational Parent Existence**: A `ChatMessage` or `ChatDocument` cannot be created or updated unless its parent `ChatThread` at `/users/{userId}/chats/{chatId}` exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Temporal Integrity**: `uid`, `userId`, `chatId`, `messageId`, `docId`, and `createdAt` are immutable after creation. Every `createdAt` on create and `updatedAt` on update must equal `request.time`.
4. **No Shadow Fields or Oversized Payloads**: Every write enforces `keys().hasAll(...)` and `keys().hasOnly(...)` on create, `diff(existing()).affectedKeys().hasOnly(...)` on update, and strict `.size()` bounds on every string and array.
5. **Safe List Queries**: `allow list` rules explicitly enforce `resource.data.userId == request.auth.uid` without `get()` or `exists()` lookups.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `get(/users/alice)` with `auth = null`.
2. **Unverified Email Token**: `set(/users/alice, ...)` with `auth = { uid: 'alice', token: { email_verified: false } }`.
3. **Cross-User PII Read**: `get(/users/alice)` signed in as `bob`.
4. **Cross-User Chat Hijack**: `create(/users/alice/chats/c1, { userId: 'bob', ... })` signed in as `bob`.
5. **Shadow Field Injection on Profile**: `create(/users/alice, { ..., isAdmin: true })` signed in as `alice`.
6. **ID Poisoning**: `create(/users/alice/chats/invalid$id..123, ...)` containing illegal characters.
7. **Timestamp Forgery**: `create(/users/alice/chats/c1, { ..., createdAt: '2020-01-01T00:00:00Z' })` instead of server `request.time`.
8. **Immutable Field Mutation**: `update(/users/alice/chats/c1, { userId: 'bob' })` or mutating `createdAt`.
9. **Orphaned Message Write**: `create(/users/alice/chats/nonexistent/messages/m1, ...)` where parent chat does not exist.
10. **Oversized String Exhaustion**: `create(/users/alice/chats/c1/messages/m1, { content: '<150KB string>' })` exceeding `maxLength: 100000`.
11. **Unbounded Attachments Array**: `create(/users/alice/chats/c1/messages/m1, { attachments: [/* 6 items */] })` exceeding limit of 5.
12. **Blanket List Scraping**: `list(/users/alice/chats)` signed in as `bob`.
