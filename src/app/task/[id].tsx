import { useLocalSearchParams } from 'expo-router';

import { TaskEditorScreen } from '../../features/tasks/TaskEditorScreen';

/** Edit a task, or one occurrence of a series with `?occ=<seriesId_YYYYMMDD>` (modal). */
export default function EditTaskRoute() {
  const { id, occ } = useLocalSearchParams<{ id: string; occ?: string }>();
  return <TaskEditorScreen key={`${id}-${occ ?? ''}`} taskId={id} occurrenceId={occ ?? null} />;
}
