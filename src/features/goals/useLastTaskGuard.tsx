import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { goalLeftEmptyBy, type GoalOption } from '../../data/goals';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useDataContext } from '../session/SessionProvider';

/**
 * Before deleting a task that is the last one linked to a goal: warn that the goal would have no tasks and offer
 * "delete, keep the goal" or "delete and archive the goal" (or cancel). `proceed(archiveGoalId)` runs the delete.
 */
export function useLastTaskGuard() {
  const { t } = useTranslation();
  const ctx = useDataContext();
  const [pending, setPending] = useState<{ goal: GoalOption; proceed: (archiveGoalId: string | null) => void } | null>(
    null,
  );

  const check = useCallback(
    async (taskId: string, proceed: (archiveGoalId: string | null) => void) => {
      const goal = ctx ? await goalLeftEmptyBy(ctx.db, ctx.ownerId, taskId).catch(() => null) : null;
      if (goal) setPending({ goal, proceed });
      else proceed(null);
    },
    [ctx],
  );

  const run = (archive: boolean) => {
    const p = pending;
    setPending(null);
    p?.proceed(archive ? p.goal.id : null);
  };

  const dialog = (
    <ConfirmDialog
      visible={pending !== null}
      title={t('goals.lastTaskTitle', { title: pending?.goal.title ?? '' })}
      body={t('goals.lastTaskBody')}
      actions={[
        {
          label: t('goals.deleteArchiveGoal'),
          variant: 'destructive',
          onPress: () => run(true),
          testID: 'last-task-archive',
        },
        { label: t('goals.deleteKeepGoal'), variant: 'secondary', onPress: () => run(false), testID: 'last-task-keep' },
      ]}
      onCancel={() => setPending(null)}
      cancelLabel={t('editor.cancel')}
    />
  );
  return { check, dialog };
}
