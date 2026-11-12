import { useLocalSearchParams } from 'expo-router';

import { GoalDetailScreen } from '../../features/goals/GoalDetailScreen';

/** Goal details. Also opened by tapping a goal reminder. */
export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GoalDetailScreen goalId={String(id)} />;
}
