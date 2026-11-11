/**
 * Side-effect module imported at the top of src/app/_layout.tsx: defines the background maintenance task at module
 * scope, which TaskManager needs so a run started by the OS finds it. Does nothing in Expo Go and on web.
 */
import { randomUUID } from 'expo-crypto';

import { migrate } from '../../data/db/migrate';
import i18n, { initI18n, resolveLanguage } from '../../i18n';
import { usePreferences } from '../../state/preferences';
import { syncNow } from '../../sync/controller';
import { maintainGoals } from '../notifications/maintenance';
import { defineMaintenanceTask, liveMaintenanceContext, runMaintenance } from './maintenanceTask';

defineMaintenanceTask(() =>
  runMaintenance({
    live: liveMaintenanceContext,
    openDb: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { openExpoDriver } = require('../../data/db/expoDriver') as typeof import('../../data/db/expoDriver');
      const db = await openExpoDriver();
      await migrate(db);
      return db;
    },
    newId: randomUUID,
    sync: syncNow,
    maintain: async (ctx) => {
      // A cold run has no UI tree: make sure notification texts are translated.
      if (!i18n.isInitialized) initI18n(resolveLanguage(usePreferences.getState().language));
      await maintainGoals(ctx);
    },
  }),
);
