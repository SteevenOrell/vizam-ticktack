import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryNameError } from '../../data/categories';
import {
  addCategory,
  CategoryProblemError,
  deleteCategory,
  listCategoryUsage,
  updateCategory,
  type CategoryUsage,
} from '../../data/settings';
import { useQuery } from '../../data/useQuery';
import { CATEGORY_NAME_MAX, CATEGORY_PALETTE } from '../../domain/categoryName';
import type { CategoryColor } from '../../domain/models';
import { Button } from '../../ui/Button';
import { CategoryDot } from '../../ui/Checkbox';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { categoryColors } from '../../ui/theme/colors';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useDataContext } from '../session/SessionProvider';

type Editing = { mode: 'new' } | { mode: 'edit'; usage: CategoryUsage };

function ColorChoice({
  color,
  selected,
  label,
  onPress,
}: {
  color: CategoryColor;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <Pressable
      {...focusHandlers}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      testID={`category-color-${color}`}
      style={[styles.swatchHit, { borderColor: focused ? colors.focus : 'transparent' }]}
    >
      <View style={[styles.swatch, { backgroundColor: categoryColors[color], borderColor: colors.text }]}>
        {selected ? <Icon name="check" size={18} color="#17191B" /> : null}
      </View>
    </Pressable>
  );
}

function CategoryRow({ usage, onPress }: { usage: CategoryUsage; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const { category, usedBy } = usage;
  const used = t('categoriesScreen.usedBy', { count: usedBy });
  return (
    <Pressable
      {...focusHandlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${used}`}
      accessibilityHint={t('categoriesScreen.editHint')}
      testID={`category-row-${category.id}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: focused ? colors.focus : 'transparent' }]}
    >
      <CategoryDot color={category.color} size={14} />
      <View style={styles.flex}>
        <Text variant="title3" numberOfLines={2}>
          {category.name}
        </Text>
        <Text variant="caption" color={colors.textSecondary}>
          {used}
        </Text>
      </View>
      <Icon name="chevronRight" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Me > Categories: add, rename, recolour and delete (with a new home for the items that used it). */
export function CategoriesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const ctx = useDataContext();
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback((db: Parameters<typeof listCategoryUsage>[0]) => listCategoryUsage(db, ownerId), [ownerId]);
  const state = useQuery(query);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<CategoryColor>('ember');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<CategoryUsage | null>(null);
  const [failed, setFailed] = useState(false);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  }, [router]);

  const open = (next: Editing, all: readonly CategoryUsage[]) => {
    setError(null);
    if (next.mode === 'edit') {
      setName(next.usage.category.name);
      setColor(next.usage.category.color);
    } else {
      setName('');
      // The least-used colour, the same rule the task editor applies to a new category.
      const used = all.map((u) => u.category.color);
      setColor(CATEGORY_PALETTE.find((c) => !used.includes(c)) ?? 'ember');
    }
    setEditing(next);
  };

  const save = async () => {
    if (!ctx || !editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.mode === 'new') await addCategory(ctx, name, color);
      else await updateCategory(ctx, editing.usage.category.id, { name, color });
      setEditing(null);
    } catch (e) {
      if (e instanceof CategoryProblemError) {
        setError(e.problem === 'duplicate' ? t('categoriesScreen.duplicate') : t('categoriesScreen.nameRequired'));
      } else if (e instanceof CategoryNameError) {
        setError(t('categoriesScreen.tooLong', { max: CATEGORY_NAME_MAX }));
      } else {
        setError(t('categoriesScreen.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: CategoryUsage, reassignTo: string | null) => {
    if (!ctx) return;
    setDeleting(null);
    try {
      await deleteCategory(ctx, target.category.id, reassignTo);
      setEditing(null);
    } catch {
      setFailed(true);
    }
  };

  const colorLabel = (c: CategoryColor) => t(`categoriesScreen.colors.${c}`);

  return (
    <StackScreen
      testID="screen-categories"
      title={t('categoriesScreen.title')}
      backLabel={t('details.back')}
      onBack={back}
      action={
        <Button
          label={t('categoriesScreen.add')}
          size="compact"
          icon="plus"
          onPress={() => open({ mode: 'new' }, state.status === 'success' ? state.data : [])}
          disabled={state.status !== 'success'}
          testID="category-add"
        />
      }
    >
      <Text variant="bodySm" color={colors.textSecondary} style={styles.intro}>
        {t('categoriesScreen.intro')}
      </Text>
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon="plus"
            title={t('categoriesScreen.emptyTitle')}
            body={t('categoriesScreen.emptyBody')}
            action={{ label: t('categoriesScreen.add'), onPress: () => open({ mode: 'new' }, []) }}
          />
        }
      >
        {(all) => (
          <View style={styles.list}>
            {all.map((u) => (
              <CategoryRow key={u.category.id} usage={u} onPress={() => open({ mode: 'edit', usage: u }, all)} />
            ))}
            {editing ? (
              <Sheet
                visible
                scroll
                title={editing.mode === 'new' ? t('categoriesScreen.newTitle') : t('categoriesScreen.editTitle')}
                closeLabel={t('editor.cancel')}
                onClose={() => setEditing(null)}
                testID="category-sheet"
                footer={
                  <View style={styles.actions}>
                    <Button
                      label={t('categoriesScreen.save')}
                      onPress={() => void save()}
                      disabled={saving}
                      fullWidth
                      testID="category-save"
                    />
                    {editing.mode === 'edit' ? (
                      <Button
                        label={t('categoriesScreen.delete')}
                        variant="destructive"
                        icon="trash"
                        onPress={() => setDeleting(editing.usage)}
                        fullWidth
                        testID="category-delete"
                      />
                    ) : null}
                  </View>
                }
              >
                <TextField
                  label={t('categoriesScreen.nameLabel')}
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    setError(null);
                  }}
                  maxLength={CATEGORY_NAME_MAX}
                  error={error}
                  autoFocus={editing.mode === 'new'}
                  returnKeyType="done"
                  onSubmitEditing={() => void save()}
                  testID="category-name"
                />
                <Text variant="label" color={colors.textSecondary}>
                  {t('categoriesScreen.colorLabel')}
                </Text>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel={t('categoriesScreen.colorLabel')}
                  style={styles.swatches}
                >
                  {CATEGORY_PALETTE.map((c) => (
                    <ColorChoice
                      key={c}
                      color={c}
                      label={colorLabel(c)}
                      selected={color === c}
                      onPress={() => setColor(c)}
                    />
                  ))}
                </View>
              </Sheet>
            ) : null}
            {deleting ? (
              <DeleteSheet
                usage={deleting}
                others={all.filter((u) => u.category.id !== deleting.category.id)}
                onCancel={() => setDeleting(null)}
                onChoose={(target) => void remove(deleting, target)}
              />
            ) : null}
          </View>
        )}
      </AsyncContent>
      <ConfirmDialog
        visible={failed}
        title={t('categoriesScreen.deleteFailedTitle')}
        body={t('categoriesScreen.deleteFailedBody')}
        actions={[]}
        onCancel={() => setFailed(false)}
        cancelLabel={t('categoriesScreen.ok')}
      />
    </StackScreen>
  );
}

/** Where the items of a deleted category go: another category or none. Unused categories only ask to confirm. */
function DeleteSheet({
  usage,
  others,
  onCancel,
  onChoose,
}: {
  usage: CategoryUsage;
  others: readonly CategoryUsage[];
  onCancel: () => void;
  onChoose: (target: string | null) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (usage.usedBy === 0) {
    return (
      <ConfirmDialog
        visible
        title={t('categoriesScreen.deleteTitle', { name: usage.category.name })}
        body={t('categoriesScreen.deleteUnused')}
        actions={[
          {
            label: t('categoriesScreen.delete'),
            variant: 'destructive',
            onPress: () => onChoose(null),
            testID: 'category-delete-confirm',
          },
        ]}
        onCancel={onCancel}
        cancelLabel={t('editor.cancel')}
      />
    );
  }
  return (
    <Sheet
      visible
      scroll
      title={t('categoriesScreen.deleteTitle', { name: usage.category.name })}
      closeLabel={t('editor.cancel')}
      onClose={onCancel}
      testID="category-delete-sheet"
    >
      <Text variant="body" color={colors.textSecondary}>
        {t('categoriesScreen.deleteBody', { count: usage.usedBy })}
      </Text>
      {others.map((o) => (
        <Button
          key={o.category.id}
          label={t('categoriesScreen.moveTo', { name: o.category.name })}
          variant="secondary"
          onPress={() => onChoose(o.category.id)}
          fullWidth
          testID={`category-move-${o.category.id}`}
        />
      ))}
      <Button
        label={t('categoriesScreen.moveToNone')}
        variant="destructive"
        onPress={() => onChoose(null)}
        fullWidth
        testID="category-move-none"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  intro: { marginBottom: space.md },
  list: { gap: space.xs },
  row: {
    minHeight: sizes.touch + space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radii.card,
    borderWidth: 2,
  },
  actions: { gap: space.xs },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  swatchHit: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 2,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
});
