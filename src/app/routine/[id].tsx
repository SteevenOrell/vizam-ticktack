import { useLocalSearchParams } from 'expo-router';

import { RoutineScreen } from '../../features/routines/RoutineScreen';

/** One routine: overview and runner. Also opened by tapping a routine reminder or a routine row. */
export default function RoutineRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoutineScreen routineId={String(id)} />;
}
