import { Redirect, Tabs } from 'expo-router';
import { Icon } from '../../components/ui';
import { useMessenger } from '../../runtime';
import { colors } from '../../styles';
export default function TabsLayout() {
  const { profile, snapshot } = useMessenger();
  if (!profile) return <Redirect href="/onboarding" />;
  const unread = snapshot.conversations.reduce((sum, item) => sum + item.unread, 0);
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: '#84939D', tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: 11, fontWeight: '500' } }}>
    <Tabs.Screen name="index" options={{ title: 'Чаты', tabBarBadge: unread || undefined, tabBarIcon: ({ focused }) => <Icon name="chatbubbles-outline" color={focused ? colors.accent : '#84939D'} /> }} />
    <Tabs.Screen name="contacts" options={{ title: 'Контакты', tabBarIcon: ({ focused }) => <Icon name="people-outline" color={focused ? colors.accent : '#84939D'} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Настройки', tabBarIcon: ({ focused }) => <Icon name="settings-outline" color={focused ? colors.accent : '#84939D'} /> }} />
  </Tabs>;
}
