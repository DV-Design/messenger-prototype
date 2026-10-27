import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { ComponentProps, ReactNode } from 'react';
import { colors, styles } from '../styles';
export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 24, color = colors.accent }: { name: IconName; size?: number; color?: ComponentProps<typeof Ionicons>['color'] | null }) { return <Ionicons name={name} size={size} color={color ?? colors.accent} />; }
export function IconButton({ name, label, onPress, disabled, color }: { name: IconName; label: string; onPress: () => void; disabled?: boolean; color?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}><Icon name={name} color={color} /></Pressable>;
}
export function Button({ title, onPress, disabled, busy, secondary, danger }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, danger && styles.dangerButton, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy && <ActivityIndicator color={secondary ? colors.accent : colors.white} />}<Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></Pressable>;
}
const palette = ['#5B9E8D', '#548FBD', '#A385B6', '#C88F69', '#BC7D8B', '#7DA27A'];
export function Avatar({ name, id = name, size = 54, online = false, group = false }: { name: string; id?: string; size?: number; online?: boolean; group?: boolean }) {
  const value = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('ru-RU');
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette[value % palette.length] }]}>
    {group ? <Icon name="people" color={colors.white} size={size * 0.43} /> : <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>}
    {online && <View style={styles.avatarOnline} />}</View>;
}
export function Empty({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Icon name={icon} size={37} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text>{children}</View>;
}
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>{action}</View>;
}
export const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const lastSeen = (online: boolean, timestamp: number) => online ? 'в сети' : timestamp ? `был(а) ${new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${time(timestamp)}` : 'не в сети';
export const connectionLabel = { idle: 'Подключение…', connecting: 'Соединяемся…', online: 'Подключено', offline: 'Ожидание сети', error: 'Нет соединения' };
export const fileSize = (size: number) => size < 1024 ? `${size} Б` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / 1024 / 1024).toFixed(1)} МБ`;
