import { useLocalSearchParams } from 'expo-router';

import { TaskDetailScreen } from '../../../features/tasks/TaskDetailScreen';

/** Task details (read view), or one occurrence of a series with `?occ=<seriesId_YYYYMMDD>`. */
export default function TaskDetailsRoute() {
  const { id, occ } = useLocalSearchParams<{ id: string; occ?: string }>();
  return <TaskDetailScreen key={`${id}-${occ ?? ''}`} taskId={String(id)} occurrenceId={occ ?? null} />;
}
