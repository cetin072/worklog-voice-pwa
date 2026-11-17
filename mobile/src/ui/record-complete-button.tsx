import { Pressable, Text } from 'react-native';
import { recordRowStyles } from './record-row-styles';

/** One completion affordance for Home tasks, notes and the Work list. */
export function RecordCompleteButton({ label, disabled = false, pending = false, onPress }: {
  label: string; disabled?: boolean; pending?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || pending}
    style={[recordRowStyles.complete, (disabled || pending) && { opacity: 0.5 }]} onPress={onPress}>
    <Text style={recordRowStyles.completeText}>{pending ? '처리 중' : '완료'}</Text>
  </Pressable>;
}
