import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { deniedPermissions, dismissDenied, onDeniedPermissions, openPermissionSettings } from '../permission-notice';
import { deniedText } from '../permission-notice-model';
import { ActionLink, Icon, IconButton } from './ui';
import { styles } from '../styles';
import { t } from '../i18n';

/** "No access to the camera" with a button straight to the app's page in the phone settings. */
export function PermissionNotice({ dark = false }: { dark?: boolean }) {
  const denied = useSyncExternalStore(onDeniedPermissions, deniedPermissions);
  if (!denied.length) return null;
  const color = dark ? '#FFFFFF' : '#7B5924';
  return <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 15, paddingRight: 4, paddingVertical: 8, backgroundColor: dark ? 'rgba(0,0,0,0.55)' : '#FFF2D8', borderRadius: dark ? 14 : 0 }}>
    <Icon name="lock-closed-outline" size={18} color={color} />
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={[styles.info, { color }]}>{deniedText(denied)}</Text>
      <ActionLink icon="settings-outline" title={t('Open access settings')} onPress={() => void openPermissionSettings()} />
    </View>
    <IconButton name="close" color={color} label={t('Hide')} onPress={dismissDenied} />
  </View>;
}
