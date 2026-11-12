/**
 * Risk check 3: the Firebase Auth React Native build must provide AsyncStorage persistence. Jest's resolver applies
 * the `node` export condition before `react-native` (Metro does the opposite), so `firebase/auth` is pointed at the
 * React Native build that Metro resolves. Metro bundling itself is verified with
 * `npx expo export --platform android --no-bytecode` (see docs/AGENT_HANDOFF.md).
 */
import { deleteApp, initializeApp } from 'firebase/app';

import { authPersistenceKind, createAuth } from '../auth';

jest.mock('firebase/auth', () => {
  // jest.mock factories cannot use imports from the module scope.
  const path = jest.requireActual<typeof import('path')>('path');
  return jest.requireActual(
    path.join(path.dirname(require.resolve('@firebase/auth/package.json')), 'dist/rn/index.js'),
  );
});

describe('Firebase Auth persistence (native)', () => {
  it('resolves the React Native entry and initialises with AsyncStorage persistence', async () => {
    expect(authPersistenceKind).toBe('react-native-async-storage');
    const app = initializeApp({ apiKey: 'demo-api-key', projectId: 'demo-ticktack', appId: 'demo-app' }, 'rn-test');
    const auth = createAuth(app);
    expect(auth.currentUser).toBeNull();
    await deleteApp(app);
  });
});
