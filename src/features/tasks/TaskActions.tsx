import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import type { AgendaItem } from '../../data/queries/agenda';
import { archiveGoal } from '../../data/goals';
import { deleteTask, setDone, setSubtaskDone } from '../../data/tasks';
import type { EditScope } from '../../domain/recurrence/seriesEdit';
import { Button } from '../../ui/Button';
import { ConfirmDialog, type DialogAction } from '../../ui/ConfirmDialog';
import { Sheet } from '../../ui/Sheet';
import { space } from '../../ui/theme/layout';
import { useLastTaskGuard } from '../goals/useLastTaskGuard';
import { useDataContext } from '../session/SessionProvider';
import { scheduleDelete, type HideMatch } from './pendingDeletes';
import { QuickEditSheet } from './QuickEditSheet';

/** Opens the full editor for a task or one occurrence (`?occ=`). Routines open in phase 4. */
export function openItem(router: ReturnType<typeof useRouter>, item: AgendaItem) {
  if (item.kind === 'routine') return;
  router.push({
    pathname: '/task/[id]',
    params: item.occurrenceId ? { id: item.taskId, occ: item.occurrenceId } : { id: item.taskId },
  });
}

export interface TaskActionsApi {
  toggle: (item: AgendaItem, done: boolean) => void;
  open: (item: AgendaItem) => void;
  menu: (item: AgendaItem) => void;
  quickEdit: (item: AgendaItem) => void;
  remove: (item: AgendaItem) => void;
  tickSubtask: (item: AgendaItem, subtaskId: string, done: boolean) => void;
}

const noop = () => undefined;
const fallback: TaskActionsApi = {
  toggle: noop,
  open: noop,
  menu: noop,
  quickEdit: noop,
  remove: noop,
  tickSubtask: noop,
};
const Ctx = createContext<TaskActionsApi>(fallback);
export const useTaskActions = () => useContext(Ctx);

/**
 * Row actions shared by Today and Calendar: complete, open, "⋯" menu, quick edit, delete (series ask
 * this / following / all; every delete can be undone for 5 s) and ticking subtasks from the row preview.
 */
export function TaskActionsProvider({
  children,
  now,
  onError,
}: {
  children: ReactNode;
  now: Date;
  /** Called when a write fails, so the screen can reload. */
  onError?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const ctx = useDataContext();
  const [menuItem, setMenuItem] = useState<AgendaItem | null>(null);
  const [scopeItem, setScopeItem] = useState<AgendaItem | null>(null);
  const [editItem, setEditItem] = useState<AgendaItem | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      console.warn('Task action failed', e instanceof Error ? e.name : 'unknown');
      onError?.();
    },
    [onError],
  );

  const guard = useLastTaskGuard();
  const scheduleNow = useCallback(
    (item: AgendaItem, scope: EditScope, archiveGoalId: string | null) => {
      if (!ctx) return;
      const hide: HideMatch =
        scope === 'this' || !item.recurring
          ? { key: item.key }
          : scope === 'following'
            ? { taskId: item.taskId, fromDate: item.date }
            : { taskId: item.taskId };
      scheduleDelete(
        {
          label: item.title,
          hide,
          run: async () => {
            await deleteTask(ctx, { taskId: item.taskId, occurrenceId: item.occurrenceId }, scope);
            if (archiveGoalId) await archiveGoal(ctx, archiveGoalId);
          },
        },
        fail,
      );
    },
    [ctx, fail],
  );
  // Deleting the last task of a goal asks first (keep the empty goal, archive it, or cancel).
  const { check } = guard;
  const schedule = useCallback(
    (item: AgendaItem, scope: EditScope) => {
      if (scope === 'all' || !item.recurring) void check(item.taskId, (archive) => scheduleNow(item, scope, archive));
      else scheduleNow(item, scope, null);
    },
    [check, scheduleNow],
  );

  const api = useMemo<TaskActionsApi>(
    () => ({
      toggle: (item, done) => {
        if (ctx) void setDone(ctx, { taskId: item.taskId, occurrenceId: item.occurrenceId }, done).catch(fail);
      },
      open: (item) => openItem(router, item),
      menu: (item) => setMenuItem(item),
      quickEdit: (item) => {
        if (item.kind !== 'routine') setEditItem(item);
      },
      remove: (item) => {
        if (item.kind === 'routine') return;
        if (item.recurring && item.occurrenceId) setScopeItem(item);
        else schedule(item, 'all');
      },
      tickSubtask: (item, subtaskId, done) => {
        if (!ctx) return;
        void setSubtaskDone(ctx, { taskId: item.taskId, occurrenceId: item.occurrenceId }, subtaskId, done).catch(fail);
      },
    }),
    [ctx, fail, router, schedule],
  );

  const closeMenu = () => setMenuItem(null);
  const fromMenu = (fn: (item: AgendaItem) => void) => () => {
    const item = menuItem;
    setMenuItem(null);
    if (!item) return;
    // iOS cannot present a modal while the previous one is still dismissing.
    if (Platform.OS === 'ios') setTimeout(() => fn(item), 450);
    else fn(item);
  };

  const scopeActions: DialogAction[] = scopeItem
    ? [
        { label: t('editor.scopeThis'), onPress: () => pickScope('this'), testID: 'delete-scope-this' },
        { label: t('editor.scopeFollowing'), onPress: () => pickScope('following'), testID: 'delete-scope-following' },
        {
          label: t('editor.scopeAll'),
          onPress: () => pickScope('all'),
          variant: 'destructive',
          testID: 'delete-scope-all',
        },
      ]
    : [];
  function pickScope(scope: EditScope) {
    const item = scopeItem;
    setScopeItem(null);
    if (item) schedule(item, scope);
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet
        visible={menuItem !== null}
        title={menuItem?.title ?? ''}
        onClose={closeMenu}
        closeLabel={t('modal.close')}
        testID="task-menu"
      >
        <View style={styles.menu}>
          <Button
            testID="menu-toggle"
            label={menuItem?.done ? t('tasks.menuReopen') : t('tasks.menuDone')}
            variant="secondary"
            icon="check"
            fullWidth
            onPress={fromMenu((item) => api.toggle(item, !item.done))}
          />
          {menuItem?.kind !== 'routine' ? (
            <>
              <Button
                testID="menu-quick-edit"
                label={t('tasks.quickEdit')}
                variant="secondary"
                icon="edit"
                fullWidth
                onPress={fromMenu(api.quickEdit)}
              />
              <Button
                testID="menu-open"
                label={t('tasks.openEditor')}
                variant="secondary"
                icon="chevronRight"
                fullWidth
                onPress={fromMenu(api.open)}
              />
              <Button
                testID="menu-delete"
                label={t('tasks.delete')}
                variant="destructive"
                icon="trash"
                fullWidth
                onPress={fromMenu(api.remove)}
              />
            </>
          ) : null}
        </View>
      </Sheet>
      {guard.dialog}
      <ConfirmDialog
        visible={scopeItem !== null}
        title={t('editor.deleteSeriesTitle')}
        actions={scopeActions}
        onCancel={() => setScopeItem(null)}
        cancelLabel={t('editor.cancel')}
      />
      {editItem ? (
        <QuickEditSheet
          item={editItem}
          now={now}
          onClose={() => setEditItem(null)}
          onOpenFull={() => {
            const item = editItem;
            setEditItem(null);
            openItem(router, item);
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({ menu: { gap: space.xs, paddingBottom: space.sm } });
