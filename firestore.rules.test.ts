/**
 * Security Rules Verification Suite (Dirty Dozen Adversarial Payloads)
 * Maps each of the 12 adversarial payloads in security_spec.md to expected PERMISSION_DENIED behavior.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenPayloads: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Profile Read',
    operation: 'get',
    path: '/users/alice',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof Write',
    operation: 'create',
    path: '/users/alice',
    auth: { uid: 'alice', emailVerified: false },
    payload: { uid: 'alice', displayName: 'Alice', email: 'alice@example.com' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User PII Read',
    operation: 'get',
    path: '/users/alice',
    auth: { uid: 'bob', emailVerified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User Chat Creation Spoof',
    operation: 'create',
    path: '/users/alice/chats/chat_1',
    auth: { uid: 'bob', emailVerified: true },
    payload: { chatId: 'chat_1', userId: 'bob', title: 'Hijack' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection (isAdmin)',
    operation: 'create',
    path: '/users/alice',
    auth: { uid: 'alice', emailVerified: true },
    payload: { uid: 'alice', displayName: 'Alice', email: 'alice@example.com', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path Variable ID Poisoning',
    operation: 'create',
    path: '/users/alice/chats/bad$chat..id',
    auth: { uid: 'alice', emailVerified: true },
    payload: { chatId: 'bad$chat..id', userId: 'alice', title: 'Test' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    path: '/users/alice/chats/chat_1',
    auth: { uid: 'alice', emailVerified: true },
    payload: { chatId: 'chat_1', userId: 'alice', title: 'Test', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable Owner Mutation on Update',
    operation: 'update',
    path: '/users/alice/chats/chat_1',
    auth: { uid: 'alice', emailVerified: true },
    payload: { userId: 'bob' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Orphaned Message Creation Without Parent Chat',
    operation: 'create',
    path: '/users/alice/chats/missing_chat/messages/msg_1',
    auth: { uid: 'alice', emailVerified: true },
    payload: { messageId: 'msg_1', chatId: 'missing_chat', userId: 'alice', role: 'user', content: 'Hi', turnIndex: 1 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Oversized Message Content Denial-of-Wallet',
    operation: 'create',
    path: '/users/alice/chats/chat_1/messages/msg_1',
    auth: { uid: 'alice', emailVerified: true },
    payload: { messageId: 'msg_1', chatId: 'chat_1', userId: 'alice', role: 'user', content: 'x'.repeat(100001), turnIndex: 1 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded Attachments Array Overflow',
    operation: 'create',
    path: '/users/alice/chats/chat_1/messages/msg_1',
    auth: { uid: 'alice', emailVerified: true },
    payload: {
      messageId: 'msg_1',
      chatId: 'chat_1',
      userId: 'alice',
      role: 'user',
      content: 'Hi',
      turnIndex: 1,
      attachments: [{}, {}, {}, {}, {}, {}],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Cross-User List Scraping',
    operation: 'list',
    path: '/users/alice/chats',
    auth: { uid: 'bob', emailVerified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
