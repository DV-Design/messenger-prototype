import { Linking, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { colors } from '../styles';
import { mapsUrl, type ParsedContact, type ParsedLocation } from '../location-contact';
import { Avatar, Icon } from './ui';

const CARD = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 2, minWidth: 190, maxWidth: 230 };

export function LocationCard({ location, onError }: { location: ParsedLocation; onError: (message: string) => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={t('Open in Google Maps')} style={CARD}
    onPress={() => void Linking.openURL(mapsUrl(location.lat, location.lng)).catch(() => onError(t('Could not open the link.')))}>
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: location.live ? '#FDECEF' : '#E3F3EC', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={location.live ? 'radio' : 'location'} size={21} color={location.live ? '#CF4552' : colors.accent} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{location.live ? t('Live location') : t('Location')}</Text>
      <Text style={{ color: colors.blue, fontSize: 12.5 }}>{t('Open in Google Maps')}</Text>
    </View>
  </Pressable>;
}

export function ContactCard({ contact }: { contact: ParsedContact }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={t('Call {name}', { name: contact.name })} style={CARD}
    onPress={() => void Linking.openURL(`tel:${contact.phones[0]}`)}>
    <Avatar name={contact.name} size={40} />
    <View style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{contact.name}</Text>
      <Text numberOfLines={1} style={{ color: colors.secondary, fontSize: 12.5 }}>{contact.phones[0]}</Text>
    </View>
    <Icon name="call-outline" size={19} color={colors.accent} />
  </Pressable>;
}
