import { useLocalSearchParams } from 'expo-router';

import { GoalEditorScreen } from '../../../features/goals/GoalEditorScreen';

/** Edit a goal (modal). */
export default function EditGoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GoalEditorScreen goalId={String(id)} />;
}
