import { useLocalSearchParams } from 'expo-router';

import { isLocalDate } from '../../domain/localDate';
import { TaskEditorScreen } from '../../features/tasks/TaskEditorScreen';

/** New task (modal). Optional `?date=YYYY-MM-DD` preselects the day. */
export default function NewTaskRoute() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  return <TaskEditorScreen initialDate={isLocalDate(date) ? date : null} />;
}
