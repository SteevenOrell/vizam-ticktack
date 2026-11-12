import { useLocalSearchParams } from 'expo-router';

import { RoutineEditorScreen } from '../../../features/routines/RoutineEditorScreen';

/** Edit a routine (modal). */
export default function EditRoutineRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoutineEditorScreen routineId={String(id)} />;
}
