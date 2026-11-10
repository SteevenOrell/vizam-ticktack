import { EMULATOR_PROJECT_ID, resolveFirebaseSetup } from '../config';

describe('resolveFirebaseSetup', () => {
  it('is disabled (guest only) when no config is present', () => {
    expect(resolveFirebaseSetup({})).toEqual({ mode: 'disabled', reason: 'missing-config' });
  });

  it('is disabled when a required value is blank', () => {
    expect(resolveFirebaseSetup({ apiKey: ' ', authDomain: 'a', projectId: 'p', appId: 'x' })).toMatchObject({
      mode: 'disabled',
    });
  });

  it('uses cloud config when every required value is set', () => {
    const setup = resolveFirebaseSetup({ apiKey: 'k', authDomain: 'd', projectId: 'p', appId: 'a' });
    expect(setup).toMatchObject({ mode: 'cloud', options: { projectId: 'p' } });
  });

  it('forces a demo- project for the emulator so it can never reach a real project', () => {
    const setup = resolveFirebaseSetup({ useEmulator: 'true', projectId: 'real-project', emulatorHost: '10.0.2.2' });
    expect(setup).toMatchObject({ mode: 'emulator', host: '10.0.2.2', options: { projectId: EMULATOR_PROJECT_ID } });
  });

  it('rejects an emulator host with a scheme or path', () => {
    const setup = resolveFirebaseSetup({ useEmulator: 'true', emulatorHost: 'http://evil.example/x' });
    expect(setup).toMatchObject({ mode: 'emulator', host: '127.0.0.1' });
  });
});
