import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

const ALL: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
const side = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' } as const;

/**
 * Pads by the insets of the surrounding context instead of measuring the window natively, so a screen
 * under the minimized-call bar does not add the status bar's height a second time.
 */
export function SafeAreaView({ edges = ALL, style, ...rest }: ViewProps & { edges?: readonly Edge[] }) {
  const insets = useSafeAreaInsets();
  const flat = StyleSheet.flatten(style) ?? {};
  const padding: Record<string, number> = {};
  for (const edge of edges) {
    const axis = edge === 'top' || edge === 'bottom' ? flat.paddingVertical : flat.paddingHorizontal;
    const own = flat[`padding${side[edge]}`] ?? axis ?? flat.padding;
    padding[`padding${side[edge]}`] = (typeof own === 'number' ? own : 0) + insets[edge];
  }
  return <View {...rest} style={[style, padding]} />;
}
