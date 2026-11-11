import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from './SafeArea';
import type { ComponentProps, ReactNode } from 'react';
import { colors, styles } from '../styles';
import { intlLocale, t } from '../i18n';
export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 24, color = colors.accent }: { name: IconName; size?: number; color?: ComponentProps<typeof Ionicons>['color'] | null }) { return <Ionicons name={name} size={size} color={color ?? colors.accent} />; }
export function IconButton({ name, label, onPress, disabled, color, active }: { name: IconName; label: string; onPress: () => void; disabled?: boolean; color?: string; active?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, active && { backgroundColor: colors.accent }, pressed && styles.pressed, disabled && styles.disabled]}><Icon name={name} color={active ? colors.white : color} /></Pressable>;
}
export function Button({ title, onPress, disabled, busy, secondary, danger }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, danger && styles.dangerButton, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy && <ActivityIndicator color={secondary ? colors.accent : colors.white} />}<Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text></Pressable>;
}
/** A Telegram-style menu row: icon, label, optional hint and chevron. No filled button. */
export function MenuRow({ icon, title, subtitle, onPress, danger, chevron, value, disabled, busy, accessibilityRole = 'button' }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; danger?: boolean; chevron?: boolean; value?: string; disabled?: boolean; busy?: boolean; accessibilityRole?: 'button' | 'link' }) {
  const tint = danger ? colors.danger : colors.accent;
  return <Pressable accessibilityRole={accessibilityRole} accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy || !onPress} onPress={onPress}
    style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: '#EEF3F1' }, (disabled || busy) && styles.disabled]}>
    {busy ? <ActivityIndicator color={tint} style={{ width: 24 }} /> : <Icon name={icon} size={23} color={tint} />}
    <View style={styles.rowBody}><Text style={[styles.menuText, danger && { color: colors.danger }]}>{title}</Text>{!!subtitle && <Text style={styles.rowText}>{subtitle}</Text>}</View>
    {!!value && <Text numberOfLines={1} style={[styles.rowText, { maxWidth: '40%' }]}>{value}</Text>}
    {chevron && <Icon name="chevron-forward" size={18} color={colors.secondary} />}
  </Pressable>;
}
/** Rows in one rounded block, separated by hairlines. Falsy children are skipped. */
export function MenuGroup({ title, children }: { title?: string; children: ReactNode }) {
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  if (!rows.length) return null;
  return <>{!!title && <Text style={styles.sectionTitle}>{title}</Text>}
    <View style={[styles.section, title ? { marginTop: 0 } : undefined]}>{rows.map((row, index) => <View key={index}>{index > 0 && <View style={styles.menuSeparator} />}{row}</View>)}</View></>;
}
/** A compact inline action: icon and text in the accent colour, for actions inside a settings card. */
export function ActionLink({ icon, title, onPress, danger, disabled, busy }: { icon: IconName; title: string; onPress: () => void; danger?: boolean; disabled?: boolean; busy?: boolean }) {
  const tint = danger ? colors.danger : colors.accent;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} hitSlop={6}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, alignSelf: 'flex-start' }, pressed && styles.pressed, (disabled || busy) && styles.disabled]}>
    {busy ? <ActivityIndicator color={tint} /> : <Icon name={icon} size={20} color={tint} />}<Text style={{ color: tint, fontSize: 15, fontWeight: '600' }}>{title}</Text>
  </Pressable>;
}
/** A settings sub-page: back arrow, title and scrolling content. */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return <SafeAreaView style={styles.screen} edges={['top']}>
    <View style={styles.chatHeader}>
      <IconButton name="chevron-back" label={t('Back')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/settings')} />
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.chatName, styles.flex, { fontSize: 19 }]}>{title}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 35 }}>{children}</ScrollView>
  </SafeAreaView>;
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
export const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
export const lastSeen = (online: boolean, timestamp: number) => online
  ? t('online')
  : timestamp
    ? t('last seen {date} at {time}', { date: new Date(timestamp).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' }), time: time(timestamp) })
    : t('offline');
export const connectionLabel = {
  idle: t('Connecting…'),
  connecting: t('Connecting to peer…'),
  online: t('Connected'),
  offline: t('Reconnecting…'),
  error: t('Reconnecting…'),
};
export const fileSize = (size: number) => size < 1024
  ? `${size} ${t('B')}`
  : size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} ${t('KB')}`
    : size < 1024 * 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)} ${t('MB')}`
      : `${(size / 1024 / 1024 / 1024).toFixed(1)} ${t('GB')}`;
